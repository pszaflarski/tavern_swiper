package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
)

const (
	SWIPES_COLLECTION  = "swipes"
	MATCHES_COLLECTION = "matches"
	PROFILES_CACHE     = "profiles_profiles_cache"
)

// handleHealth godoc
// @Summary      Health check
// @Description  Returns the health status of the discovery service.
// @Tags         health
// @Produce      json
// @Success      200  {object}  map[string]string
// @Router       /health [get]
func handleHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"service": "discovery", "status": "ok"})
}

// handleGetFeed godoc
// @Summary      Get discovery feed
// @Description  Returns a curated list of profiles the caller hasn't swiped on yet.
// @Tags         feed
// @Accept       json
// @Produce      json
// @Param        profile_id  path   string  true  "Caller's Profile ID"
// @Param        limit       query  int     false "Max profiles to return" default(10)
// @Success      200  {object}  FeedResponse
// @Failure      403  {object}  map[string]string
// @Failure      404  {object}  map[string]string
// @Failure      500  {object}  map[string]string
// @Security     BearerAuth
// @Router       /feed/{profile_id} [get]
func handleGetFeed(c *gin.Context) {
	profileID := c.Param("profile_id")
	auth := GetAuth(c)

	ctx := context.Background()
	client, err := getDBFunc(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Internal discovery error"})
		return
	}

	// 0. Verify ownership
	pDoc, err := client.Collection(PROFILES_CACHE).Doc(profileID).Get(ctx)
	if err != nil || !pDoc.Exists() {
		c.JSON(http.StatusNotFound, gin.H{"detail": "Profile not found in discovery cache"})
		return
	}
	if pDoc.Data()["user_id"] != auth.UID {
		c.JSON(http.StatusForbidden, gin.H{"detail": "Not authorized for this profile"})
		return
	}

	// 1. Get swipe history (M1: Optimization - Use Pipeline projection)
	pipeline := client.Pipeline().
		Collection(SWIPES_COLLECTION).
		Where(firestore.Equal("swiper_profile_id", profileID)).
		Select([]any{"swiped_profile_id"})

	pSnapshot := pipeline.Execute(ctx)
	pIter := pSnapshot.Results()
	defer pIter.Stop()

	// Build exclusion list: self + already-swiped profile IDs
	excludeSet := make(map[string]bool)
	excludeSet[profileID] = true // Exclude self
	for {
		res, err := pIter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			log.Printf("[ERROR] Swipe history pipeline failed: %v", err)
			break
		}
		if sid, ok := res.Data()["swiped_profile_id"].(string); ok {
			excludeSet[sid] = true
		}
	}
	excludeIDs := make([]string, 0, len(excludeSet))
	for id := range excludeSet {
		excludeIDs = append(excludeIDs, id)
	}

	// 2. Fetch candidates via Pipeline (server-side filtering + projection)
	limitStr := c.DefaultQuery("limit", "10")
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 {
		log.Printf("[DEBUG] Using default limit 10 (err or <=0: %v, str: %s)", err, limitStr)
		limit = 10
	}
	log.Printf("[DEBUG] Profile %s requested feed with limit=%d, excluding %d profiles", profileID, limit, len(excludeIDs))

	candidates, err := getFeedCandidatesFunc(ctx, PROFILES_CACHE, excludeIDs, limit)
	if err != nil {
		log.Printf("[ERROR] Pipeline feed query failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Internal discovery error"})
		return
	}

	// 3. Hydrate response from pipeline results
	var profiles []DiscoveryProfile
	for _, candidate := range candidates {
		var p DiscoveryProfile
		data := candidate.Data
		pID, ok := data["profile_id"].(string)
		if !ok || pID == "" {
			log.Printf("[WARN] Skipping malformed profile in pipeline result: missing profile_id")
			continue
		}

		p.ProfileID = pID
		p.DisplayName, _ = data["display_name"].(string)

		if val, ok := data["bio"].(string); ok {
			p.Bio = &val
		}
		if val, ok := data["tagline"].(string); ok {
			p.Tagline = &val
		}
		if val, ok := data["gender"].(string); ok {
			p.Gender = &val
		}
		if val, ok := data["character_class"].(string); ok {
			p.CharacterClass = &val
		}
		if val, ok := data["realm"].(string); ok {
			p.Realm = &val
		}

		p.IsActive, _ = data["is_active"].(bool)

		// Handle image_urls (coerce null to empty list if needed)
		if val, ok := data["image_urls"].([]interface{}); ok {
			p.ImageURLs = []string{}
			for _, v := range val {
				if s, ok := v.(string); ok {
					p.ImageURLs = append(p.ImageURLs, s)
				}
			}
		} else {
			p.ImageURLs = []string{}
		}

		if val, ok := data["talents"].([]interface{}); ok {
			p.Talents = []string{}
			for _, v := range val {
				if s, ok := v.(string); ok {
					p.Talents = append(p.Talents, s)
				}
			}
		} else {
			p.Talents = []string{}
		}

		profiles = append(profiles, p)
	}

	log.Printf("[DEBUG] Returning %d profiles for %s", len(profiles), profileID)
	c.JSON(http.StatusOK, FeedResponse{Profiles: profiles})
}

// handleRecordSwipe godoc
// @Summary      Record a swipe
// @Description  Records a left/right swipe. If mutual right-swipe is detected, creates a match.
// @Tags         swipes
// @Accept       json
// @Produce      json
// @Param        body  body      SwipeCreate  true  "Swipe payload"
// @Success      201   {object}  SwipeOut
// @Failure      400   {object}  map[string]string
// @Failure      403   {object}  map[string]string
// @Failure      404   {object}  map[string]string
// @Failure      422   {object}  map[string]string
// @Security     BearerAuth
// @Router       /swipe/ [post]
func handleRecordSwipe(c *gin.Context, publisher Publisher) {
	var body SwipeCreate
	if err := c.ShouldBindJSON(&body); err != nil {
		// Matching user's request: default errors are fine
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": err.Error(), "body": body})
		return
	}

	auth := GetAuth(c)
	ctx := context.Background()
	client, err := getDBFunc(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Database error"})
		return
	}

	// 0. Verify ownership
	pDoc, err := client.Collection(PROFILES_CACHE).Doc(body.SwiperProfileID).Get(ctx)
	if err != nil || !pDoc.Exists() {
		c.JSON(http.StatusNotFound, gin.H{"detail": "Swiper profile not found in discovery cache"})
		return
	}
	if pDoc.Data()["user_id"] != auth.UID {
		c.JSON(http.StatusForbidden, gin.H{"detail": "Not authorized for this profile"})
		return
	}

	if body.SwiperProfileID == body.SwipedProfileID {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "Cannot swipe on your own profile."})
		return
	}

	swipeID := uuid.New().String()
	now := _now().UTC()
	
	swipeData := map[string]interface{}{
		"swiper_profile_id": body.SwiperProfileID,
		"swiped_profile_id": body.SwipedProfileID,
		"direction":         body.Direction,
		"created_at":        firestore.ServerTimestamp,
		"modified_at":       firestore.ServerTimestamp,
		"is_deleted":        false,
	}
	_, _ = client.Collection(SWIPES_COLLECTION).Doc(swipeID).Set(ctx, swipeData)

	var matchID *string
	if body.Direction == "right" {
		// Check for mutual match
		reciprocalIter := client.Collection(SWIPES_COLLECTION).
			Where("swiper_profile_id", "==", body.SwipedProfileID).
			Where("swiped_profile_id", "==", body.SwiperProfileID).
			Where("direction", "==", "right").
			Limit(1).
			Documents(ctx)
		
		reciprocalDocs, err := reciprocalIter.GetAll()
		if err != nil {
			log.Printf("[ERROR] Failed to query reciprocal swipes: %v", err)
		} else if len(reciprocalDocs) > 0 {
			ids := []string{body.SwiperProfileID, body.SwipedProfileID}
			sort.Strings(ids)
			mID := fmt.Sprintf("match_%s_%s", ids[0], ids[1])
			matchID = &mID

			matchData := map[string]interface{}{
				"id":         mID,
				"profiles":   ids,
				"created_at": firestore.ServerTimestamp,
			}
			_, _ = client.Collection(MATCHES_COLLECTION).Doc(mID).Set(ctx, matchData)

			// Publish Event
			if publisher != nil {
				publisher.PublishMatchCreated(mID, ids, now)
			}
		}
	}

	log.Printf("[DEBUG] Swipe recorded: swiper=%s, swiped=%s, match_id=%v", body.SwiperProfileID, body.SwipedProfileID, matchID)
 
 	c.JSON(http.StatusCreated, SwipeOut{
 		SwipeID:         swipeID,
 		SwiperProfileID: body.SwiperProfileID,
 		SwipedProfileID: body.SwipedProfileID,
 		Direction:       body.Direction,
 		CreatedAt:       now.Format("2006-01-02T15:04:05-07:00"),
 		ID:              matchID,
 		MatchID:         matchID,
 	})
 }

// handleGetMatch godoc
// @Summary      Get a match by ID
// @Description  Returns the details of a specific match.
// @Tags         matches
// @Produce      json
// @Param        id  path      string  true  "Match ID"
// @Success      200  {object}  MatchOut
// @Failure      404  {object}  map[string]string
// @Failure      500  {object}  map[string]string
// @Security     BearerAuth
// @Router       /matches/{id} [get]
func handleGetMatch(c *gin.Context) {
	id := c.Param("id")
	ctx := context.Background()
	client, err := getDBFunc(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Database error"})
		return
	}

	doc, err := client.Collection(MATCHES_COLLECTION).Doc(id).Get(ctx)
	if err != nil || !doc.Exists() {
		c.JSON(http.StatusNotFound, gin.H{"detail": "Match not found"})
		return
	}

	data := doc.Data()
	profiles := parseProfiles(data["profiles"])

	var createdAt string
	if t, ok := data["created_at"].(time.Time); ok {
		createdAt = t.Format("2006-01-02T15:04:05-07:00")
	} else if s, ok := data["created_at"].(string); ok {
		createdAt = s
	}

	mID, _ := data["id"].(string)
	c.JSON(http.StatusOK, MatchOut{
		ID:        mID,
		Profiles:  profiles,
		CreatedAt: createdAt,
	})
}

// handleListMatchesForProfile godoc
// @Summary      List matches for a profile
// @Description  Returns all matches that include the given profile ID.
// @Tags         matches
// @Produce      json
// @Param        profile_id  path      string  true  "Profile ID"
// @Success      200  {array}   MatchOut
// @Failure      500  {object}  map[string]string
// @Security     BearerAuth
// @Router       /matches/profile/{profile_id} [get]
func handleListMatchesForProfile(c *gin.Context) {
	profileID := c.Param("profile_id")
	ctx := context.Background()
	client, err := getDBFunc(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Database error"})
		return
	}

	// FIXME: In production, we should verify the user owns the profile_id. 
	// For now, it's open to all logged-in users to allow for discovery.
	iter := client.Collection(MATCHES_COLLECTION).Where("profiles", "array-contains", profileID).Documents(ctx)
	docs, err := iter.GetAll()
	if err != nil {
		log.Printf("[ERROR] Failed to list matches for profile %s: %v", profileID, err)
		// Include the exact error message to help diagnose missing indexes or permission issues in CI/CD
		c.JSON(http.StatusInternalServerError, gin.H{
			"detail": fmt.Sprintf("Failed to query matches: %v", err),
			"error_type": "firestore_query_error",
		})
		return
	}

	results := []MatchOut{}
	for _, doc := range docs {
		data := doc.Data()
		profiles := parseProfiles(data["profiles"])
		var createdAt string
		if t, ok := data["created_at"].(time.Time); ok {
			createdAt = t.Format("2006-01-02T15:04:05-07:00")
		} else if s, ok := data["created_at"].(string); ok {
			createdAt = s
		}

		mID, _ := data["id"].(string)
		results = append(results, MatchOut{
			ID:        mID,
			Profiles:  profiles,
			CreatedAt: createdAt,
		})
	}
	c.JSON(http.StatusOK, results)
}

// handleDeleteAll godoc
// @Summary      Purge all discovery data
// @Description  Deletes all swipes and matches. Admin/test use only.
// @Tags         admin
// @Produce      json
// @Success      200  {object}  map[string]string
// @Failure      500  {object}  map[string]string
// @Security     BearerAuth
// @Router       /all [delete]
func handleDeleteAll(c *gin.Context) {
	ctx := context.Background()
	client, err := getDBFunc(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Database error"})
		return
	}

	// Delete swipes (L2: Paginated purge)
	if err := client.DeleteCollection(ctx, client.Collection(SWIPES_COLLECTION), 500); err != nil {
		log.Printf("[ERROR] Swipe purge failed: %v", err)
	}
	
	// Delete matches (L2: Paginated purge)
	if err := client.DeleteCollection(ctx, client.Collection(MATCHES_COLLECTION), 500); err != nil {
		log.Printf("[ERROR] Match purge failed: %v", err)
	}
	c.JSON(http.StatusOK, gin.H{"status": "purged"})
}

// Helper: Safely parse profiles array from Firestore
func parseProfiles(val interface{}) []string {
	if val == nil {
		return []string{}
	}
	// Try []string (often returned by Firestore Go client if saved as such)
	if s, ok := val.([]string); ok {
		return s
	}
	// Try []interface{} (standard Firestore response for arrays)
	if i, ok := val.([]interface{}); ok {
		res := make([]string, 0, len(i))
		for _, v := range i {
			if s, ok := v.(string); ok {
				res = append(res, s)
			}
		}
		return res
	}
	return []string{}
}
