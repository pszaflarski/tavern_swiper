package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"cloud.google.com/go/firestore"
)

const COLLECTION = "profiles"

// handleHealth matches Python: @app.get("/profiles/health")
func handleHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"service": "profiles",
		"status":  "ok",
	})
}

// handleListAllProfiles matches Python: @app.get("/profiles/all")
func handleListAllProfiles(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdmin(auth.Role) {
		send403(c, "Admin or Root Admin authorization required")
		return
	}

	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	docs, err := client.Collection(COLLECTION).Documents(c.Request.Context()).GetAll()
	if err != nil {
		send500(c, fmt.Sprintf("Failed to fetch profiles: %v", err))
		return
	}

	results := make([]ProfileOut, 0)
	for _, doc := range docs {
		p, err := docToProfile(doc)
		if err == nil {
			results = append(results, p)
		}
	}

	c.JSON(http.StatusOK, results)
}

// handleCreateProfile matches Python: @app.post("/profiles/")
func handleCreateProfile(c *gin.Context) {
	var body ProfileCreate
	if err := c.ShouldBindJSON(&body); err != nil {
		// Manual parity for missing fields
		if strings.Contains(err.Error(), "required") {
			field := "display_name" // Simplification for now
			sendValidationError(c, map[string]interface{}{}, field, "Field required", "missing")
			return
		}
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": err.Error()})
		return
	}

	auth := GetAuth(c)
	targetUID := auth.UID
	if body.UserID != nil {
		if IsAdmin(auth.Role) {
			targetUID = *body.UserID
		} else {
			send403(c, "Only admins or root admins can specify a target user_id")
			return
		}
	}

	profileID := uuid.New().String()
	
	// Validation Ritual: Firestore Limits
	if err := validateDataForFirestore(body); err != nil {
		sendGenericError(c, http.StatusBadRequest, err.Error())
		return
	}

	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	// Logic: Set active and deactivate others
	
	data := map[string]interface{}{
		"user_id":      targetUID,
		"display_name": body.DisplayName,
		"tagline":      body.Tagline,
		"bio":          body.Bio,
		"gender":       body.Gender,
		"image_urls":   body.ImageURLs,
		"is_active":    true,
	}

	ref := client.Collection(COLLECTION).Doc(profileID)
	// We use Set here. Note: Batch.Set isn't in our interface but client.Collection().Doc().Set is.
	// Wait, our interface has Batch().Delete() but not Batch().Set().
	// I should update the interface to include Set or just do it sequentially.
	// The Python code does doc.set() then _deactivate_other_profiles (which is sequential updates).
	
	if _, err := ref.Set(c.Request.Context(), data); err != nil {
		send500(c, fmt.Sprintf("Failed to create profile: %v", err))
		return
	}

	deactivateOtherProfiles(c.Request.Context(), client, targetUID, profileID)

	// Refetch to return ProfileOut
	doc, err := ref.Get(c.Request.Context())
	if err != nil {
		send500(c, "Failed to refetch created profile")
		return
	}

	p, _ := docToProfile(doc)
	PublishUpserted(c.Request.Context(), p)
	c.JSON(http.StatusCreated, p)
}

// handleGetProfile matches Python: @app.get("/profiles/{profile_id}")
func handleGetProfile(c *gin.Context) {
	id := c.Param("id")
	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	doc, err := client.Collection(COLLECTION).Doc(id).Get(c.Request.Context())
	if err != nil || !doc.Exists() {
		send404(c, "Profile not found")
		return
	}

	p, err := docToProfile(doc)
	if err != nil {
		send500(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, p)
}

// Helper: docToProfile
func docToProfile(doc DocumentSnapshot) (ProfileOut, error) {
	d := doc.Data()
	if d == nil {
		return ProfileOut{}, fmt.Errorf("Document %s contains no data", doc.ID())
	}
	
	// Helper to safely get string or nil
	getStr := func(key string) *string {
		if val, ok := d[key].(string); ok {
			return &val
		}
		return nil
	}

	// Helper to get slice of strings
	getURLs := func(key string) []string {
		if val, ok := d[key].([]interface{}); ok {
			res := make([]string, len(val))
			for i, v := range val {
				if s, ok := v.(string); ok {
					res[i] = s
				}
			}
			return res
		}
		return []string{}
	}

	return ProfileOut{
		ProfileID:   doc.ID(),
		UserID:      d["user_id"].(string),
		DisplayName: d["display_name"].(string),
		Tagline:     getStr("tagline"),
		Bio:         getStr("bio"),
		Gender:      getStr("gender"),
		ImageURLs:   getURLs("image_urls"),
		IsActive:    d["is_active"].(bool),
	}, nil
}

// Helper: deactivateOtherProfiles
func deactivateOtherProfiles(ctx context.Context, client FirestoreClient, userID string, activeProfileID string) {
	iter := client.Collection(COLLECTION).
		Where("user_id", "==", userID).
		Where("is_active", "==", true).
		Documents(ctx)
	
	snaps, err := iter.GetAll()
	if err != nil {
		return
	}
	
	for _, snap := range snaps {
		if snap.ID() != activeProfileID {
			snap.Ref().Update(ctx, []firestore.Update{
				{Path: "is_active", Value: false},
			})
		}
	}
}

// handleListProfilesForUser matches Python: @app.get("/profiles/user/{user_id}")
func handleListProfilesForUser(c *gin.Context) {
	userID := c.Param("user_id")
	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	docs, err := client.Collection(COLLECTION).Where("user_id", "==", userID).Documents(c.Request.Context()).GetAll()
	if err != nil {
		send500(c, "Failed to list profiles")
		return
	}

	results := make([]ProfileOut, 0)
	for _, doc := range docs {
		p, err := docToProfile(doc)
		if err == nil {
			results = append(results, p)
		}
	}
	c.JSON(http.StatusOK, results)
}

// handleUpdateProfile matches Python: @app.put("/profiles/{profile_id}")
func handleUpdateProfile(c *gin.Context) {
	id := c.Param("id")
	var body ProfileUpdate
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": err.Error()})
		return
	}

	auth := GetAuth(c)
	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	ref := client.Collection(COLLECTION).Doc(id)
	doc, err := ref.Get(c.Request.Context())
	if err != nil || !doc.Exists() {
		send404(c, "Profile not found")
		return
	}

	profileData := doc.Data()
	if profileData["user_id"] != auth.UID && !IsAdmin(auth.Role) {
		send403(c, "Not authorized to update this profile")
		return
	}

	updates := make([]firestore.Update, 0)
	if body.DisplayName != nil {
		updates = append(updates, firestore.Update{Path: "display_name", Value: *body.DisplayName})
	}
	if body.Tagline != nil {
		updates = append(updates, firestore.Update{Path: "tagline", Value: *body.Tagline})
	}
	if body.Bio != nil {
		updates = append(updates, firestore.Update{Path: "bio", Value: *body.Bio})
	}
	if body.Gender != nil {
		updates = append(updates, firestore.Update{Path: "gender", Value: *body.Gender})
	}
	if body.ImageURLs != nil {
		updates = append(updates, firestore.Update{Path: "image_urls", Value: *body.ImageURLs})
	}
	if body.IsActive != nil {
		updates = append(updates, firestore.Update{Path: "is_active", Value: *body.IsActive})
	}

	if len(updates) > 0 {
		if _, err := ref.Update(c.Request.Context(), updates); err != nil {
			send500(c, "Failed to update profile")
			return
		}

		if body.IsActive != nil && *body.IsActive {
			deactivateOtherProfiles(c.Request.Context(), client, profileData["user_id"].(string), id)
		}
	}

	newDoc, _ := ref.Get(c.Request.Context())
	p, _ := docToProfile(newDoc)
	PublishUpserted(c.Request.Context(), p)
	c.JSON(http.StatusOK, p)
}

// handleDeleteProfile matches Python: @app.delete("/profiles/{profile_id}")
func handleDeleteProfile(c *gin.Context) {
	id := c.Param("id")
	auth := GetAuth(c)
	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	ref := client.Collection(COLLECTION).Doc(id)
	doc, err := ref.Get(c.Request.Context())
	if err != nil || !doc.Exists() {
		send404(c, "Profile not found")
		return
	}

	if doc.Data()["user_id"] != auth.UID && !IsAdmin(auth.Role) {
		send403(c, "Not authorized to delete this profile")
		return
	}

	// TODO: Delete GCS images
	
	if _, err := ref.Delete(c.Request.Context()); err != nil {
		send500(c, "Failed to delete profile")
		return
	}

	PublishDeleted(c.Request.Context(), id)
	c.Status(http.StatusNoContent)
}

// handleSetProfileActive matches Python: @app.post("/profiles/{profile_id}/set_active")
func handleSetProfileActive(c *gin.Context) {
	id := c.Param("id")
	auth := GetAuth(c)
	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	ref := client.Collection(COLLECTION).Doc(id)
	doc, err := ref.Get(c.Request.Context())
	if err != nil || !doc.Exists() {
		send404(c, "Profile not found")
		return
	}

	profileData := doc.Data()
	if profileData["user_id"] != auth.UID && !IsAdmin(auth.Role) {
		send403(c, "Not authorized to set this profile as active")
		return
	}

	_, err = ref.Update(c.Request.Context(), []firestore.Update{
		{Path: "is_active", Value: true},
	})
	if err != nil {
		send500(c, "Failed to set profile active")
		return
	}

	deactivateOtherProfiles(c.Request.Context(), client, profileData["user_id"].(string), id)

	newDoc, _ := ref.Get(c.Request.Context())
	p, _ := docToProfile(newDoc)
	PublishUpserted(c.Request.Context(), p)
	c.JSON(http.StatusOK, p)
}

// handleGetProfilesBatch matches Python: @app.post("/profiles/batch")
func handleGetProfilesBatch(c *gin.Context) {
	var body ProfileBatchRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": err.Error()})
		return
	}

	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	results := make([]ProfileOut, 0)
	// Firestore doesn't support batch get by ID in a single query easily without 'in' operator 
	// but there's a limit of 30 for 'in'.
	// Python uses a chunking strategy or just sequential gets in parallel.
	// We'll follow the Python implementation's resilience: handle missing docs gracefully.
	
	for _, id := range body.ProfileIDs {
		doc, err := client.Collection(COLLECTION).Doc(id).Get(c.Request.Context())
		if err == nil && doc.Exists() {
			p, err := docToProfile(doc)
			if err == nil {
				results = append(results, p)
			}
		}
	}

	c.JSON(http.StatusOK, results)
}

// handleGetMyActiveProfile matches Python: @app.get("/profiles/user/me/active")
func handleGetMyActiveProfile(c *gin.Context) {
	auth := GetAuth(c)
	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	// 1. Try to find an active profile
	iter := client.Collection(COLLECTION).
		Where("user_id", "==", auth.UID).
		Where("is_active", "==", true).
		Limit(1).
		Documents(c.Request.Context())
	
	doc, err := iter.Next()
	if err == nil {
		p, _ := docToProfile(doc)
		c.JSON(http.StatusOK, p)
		return
	}

	// 2. Auto-activation fallback: find any profile and activate it
	iterAny := client.Collection(COLLECTION).
		Where("user_id", "==", auth.UID).
		Limit(1).
		Documents(c.Request.Context())
	
	docAny, err := iterAny.Next()
	if err != nil {
		send404(c, "Profile not found")
		return
	}

	// Activate this one
	docAny.Ref().Update(c.Request.Context(), []firestore.Update{
		{Path: "is_active", Value: true},
	})
	
	p, _ := docToProfile(docAny)
	p.IsActive = true // Update the local copy for response
	c.JSON(http.StatusOK, p)
}

// handleDeleteAllProfiles matches Python: @app.delete("/profiles/")
func handleDeleteAllProfiles(c *gin.Context) {
	auth := GetAuth(c)
	if auth.Role != "root_admin" {
		send403(c, "Root Admin authorization required")
		return
	}

	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	// Purge all profiles
	docs, err := client.Collection(COLLECTION).Documents(c.Request.Context()).GetAll()
	if err != nil {
		send500(c, "Failed to fetch profiles for purge")
		return
	}

	// sequential delete for simplicity in purge
	for _, doc := range docs {
		doc.Ref().Delete(c.Request.Context())
	}

	PublishAllDeleted(c.Request.Context(), auth.UID)
	c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("Purged %d profiles", len(docs))})
}

// handleUploadProfileImage matches Python: @app.post("/profiles/{id}/image")
func handleUploadProfileImage(c *gin.Context) {
	id := c.Param("id")
	auth := GetAuth(c)

	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	// 1. Ownership check
	ref := client.Collection(COLLECTION).Doc(id)
	doc, err := ref.Get(c.Request.Context())
	if err != nil || !doc.Exists() {
		send404(c, "Profile not found")
		return
	}

	profileData := doc.Data()
	if profileData["user_id"] != auth.UID && !IsAdmin(auth.Role) {
		send403(c, "Not authorized to upload images for this profile")
		return
	}

	// 2. Extract file from request
	file, err := c.FormFile("file")
	if err != nil {
		send400(c, "No file uploaded")
		return
	}

	src, err := file.Open()
	if err != nil {
		send500(c, "Failed to open uploaded file")
		return
	}
	defer src.Close()

	data, err := io.ReadAll(src)
	if err != nil {
		send500(c, "Failed to read uploaded file")
		return
	}

	// 3. Normalization Ritual
	isAdmin := IsAdmin(auth.Role)
	normalizedData, err := normalizeImageRitual(data, isAdmin)
	if err != nil {
		send400(c, err.Error())
		return
	}

	// 4. Upload to GCS
	log.Printf("[INFO] Normalizing image for profile %s (isAdmin: %v)", id, isAdmin)
	startTime := time.Now()

	filename := fmt.Sprintf("%v.jpg", uuid.New().String())

	// Create a context with timeout for GCP operations
	gcpCtx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
	defer cancel()

	publicURL, err := uploadToGCS(gcpCtx, id, filename, "image/jpeg", bytes.NewReader(normalizedData))
	if err != nil {
		log.Printf("[ERROR] GCS upload failed for profile %s: %v (took %v)", id, err, time.Since(startTime))
		send503(c, fmt.Sprintf("Storage error: %v", err))
		return
	}
	log.Printf("[INFO] Image uploaded to GCS for profile %s: %s (took %v)", id, publicURL, time.Since(startTime))

	// 5. Update Profile
	imageURLs := docToProfileImageURLs(doc)
	imageURLs = append(imageURLs, publicURL)

	updateCtx, updateCancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer updateCancel()

	_, err = ref.Update(updateCtx, []firestore.Update{
		{Path: "image_urls", Value: imageURLs},
	})
	if err != nil {
		log.Printf("[ERROR] Firestore update failed for profile %s: %v", id, err)
		send500(c, "Failed to update profile with new image URL")
		return
	}

	// Refetch and return
	newDoc, _ := ref.Get(c.Request.Context())
	p, _ := docToProfile(newDoc)
	PublishUpserted(c.Request.Context(), p)
	c.JSON(http.StatusOK, p)
}

// Helper: docToProfileImageURLs
func docToProfileImageURLs(doc DocumentSnapshot) []string {
	d := doc.Data()
	if val, ok := d["image_urls"].([]interface{}); ok {
		res := make([]string, len(val))
		for i, v := range val {
			if s, ok := v.(string); ok {
				res[i] = s
			}
		}
		return res
	}
	return []string{}
}

// validateDataForFirestore replicates logic from Python's _validate_data_for_firestore
func validateDataForFirestore(v interface{}) error {
	// Simplified validation for now, matching Python's string length and array limits.
	// We'll use reflection or just check the fields we know.
	const MAX_STRING_LENGTH = 15360
	const MAX_ARRAY_LENGTH = 100

	if body, ok := v.(ProfileCreate); ok {
		if body.Bio != nil && len(*body.Bio) > MAX_STRING_LENGTH {
			return fmt.Errorf("String at path 'bio' is too long (%d chars). Max is %d. (Likely unintended base64 image data).", len(*body.Bio), MAX_STRING_LENGTH)
		}
		if len(body.ImageURLs) > MAX_ARRAY_LENGTH {
			return fmt.Errorf("Array at path 'image_urls' is too large (%d items). Max is %d.", len(body.ImageURLs), MAX_ARRAY_LENGTH)
		}
	}
	return nil
}
