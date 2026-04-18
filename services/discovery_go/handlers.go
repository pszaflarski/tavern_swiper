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
	"google.golang.org/api/iterator"
)

const (
	SWIPES_COLLECTION  = "swipes"
	MATCHES_COLLECTION = "matches"
	PROFILES_CACHE     = "profiles_profiles_cache"
)

func handleHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"service": "discovery", "status": "ok"})
}

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

	// 1. Get swipe history
	iter := client.Collection(SWIPES_COLLECTION).Where("swiper_profile_id", "==", profileID).Documents(ctx)
	swipedDocs, _ := iter.GetAll()
	alreadySwiped := make(map[string]bool)
	for _, doc := range swipedDocs {
		if sid, ok := doc.Data()["swiped_profile_id"].(string); ok {
			alreadySwiped[sid] = true
		}
	}

	// 2. Fetch candidates
	limitStr := c.DefaultQuery("limit", "10")
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 {
		log.Printf("[DEBUG] Using default limit 10 (err or <=0: %v, str: %s)", err, limitStr)
		limit = 10
	}
	log.Printf("[DEBUG] Profile %s requested feed with limit=%d", profileID, limit)

	// Overfetch as in Python (limit * 5) to account for alreadySwiped and self
	overfetchLimit := limit * 5
	if overfetchLimit < 50 {
		overfetchLimit = 50
	}

	candidatesIter := client.Collection(PROFILES_CACHE).Where("is_active", "==", true).Limit(overfetchLimit).Documents(ctx)
	candidateDocs, err := candidatesIter.GetAll()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Internal discovery error"})
		return
	}

	var profiles []DiscoveryProfile
	for _, doc := range candidateDocs {
		var p DiscoveryProfile
		data := doc.Data()
		pID := data["profile_id"].(string)

		if pID == profileID || alreadySwiped[pID] {
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
			p.ImageURLs = make([]string, len(val))
			for i, v := range val {
				p.ImageURLs[i] = v.(string)
			}
		} else {
			p.ImageURLs = []string{}
		}

		if val, ok := data["talents"].([]interface{}); ok {
			p.Talents = make([]string, len(val))
			for i, v := range val {
				p.Talents[i] = v.(string)
			}
		} else {
			p.Talents = []string{}
		}

		profiles = append(profiles, p)
		if len(profiles) >= limit {
			log.Printf("[DEBUG] Reached limit %d, stopping candidate collection", limit)
			break
		}
	}

	log.Printf("[DEBUG] Returning %d profiles for %s", len(profiles), profileID)
	c.JSON(http.StatusOK, FeedResponse{Profiles: profiles})
}

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
		"created_at":        now,
		"modified_at":       now,
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
				"created_at": now,
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
	var profiles []string
	if p, ok := data["profiles"].([]interface{}); ok {
		for _, v := range p {
			profiles = append(profiles, v.(string))
		}
	}

	var createdAt string
	if t, ok := data["created_at"].(time.Time); ok {
		createdAt = t.Format("2006-01-02T15:04:05-07:00")
	} else if s, ok := data["created_at"].(string); ok {
		createdAt = s
	}

	c.JSON(http.StatusOK, MatchOut{
		ID:        data["id"].(string),
		Profiles:  profiles,
		CreatedAt: createdAt,
	})
}

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
	iter := client.Collection(MATCHES_COLLECTION).Where("profiles", "array_contains", profileID).Documents(ctx)
	docs, err := iter.GetAll()
	if err != nil {
		log.Printf("[ERROR] Failed to list matches for profile %s: %v", profileID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"detail": fmt.Sprintf("Failed to query matches: %v", err)})
		return
	}

	results := []MatchOut{}
	for _, doc := range docs {
		data := doc.Data()
		var profiles []string
		if p, ok := data["profiles"].([]interface{}); ok {
			for _, v := range p {
				profiles = append(profiles, v.(string))
			}
		}
		var createdAt string
		if t, ok := data["created_at"].(time.Time); ok {
			createdAt = t.Format("2006-01-02T15:04:05-07:00")
		} else if s, ok := data["created_at"].(string); ok {
			createdAt = s
		}

		results = append(results, MatchOut{
			ID:        data["id"].(string),
			Profiles:  profiles,
			CreatedAt: createdAt,
		})
	}
	c.JSON(http.StatusOK, results)
}

func handleDeleteAll(c *gin.Context) {
	ctx := context.Background()
	client, err := getDBFunc(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Database error"})
		return
	}

	// Purge both cache and real swipes/matches for local tests
	colls := []string{PROFILES_CACHE, SWIPES_COLLECTION, MATCHES_COLLECTION}
	for _, coll := range colls {
		iter := client.Collection(coll).Documents(ctx)
		for {
			doc, err := iter.Next()
			if err == iterator.Done {
				break
			}
			if err != nil {
				continue
			}
			doc.Ref().Delete(ctx)
		}
	}

	c.Status(http.StatusNoContent)
}
