package main

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const CHARACTERS_COLLECTION = "characters"

func handleHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "healthy"})
}

// handleListAllCharacters godoc
// @Summary      List and search predefined characters
// @Tags         characters
// @Param        fandom  query  string  false  "Fandom tag slug or ID"
// @Param        race    query  string  false  "Race tag slug or ID"
// @Param        gender  query  string  false  "Gender tag slug or ID"
// @Success      200  {array}  CharacterOut
// @Router       /characters/ [get]
func handleListAllCharacters(c *gin.Context) {
	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	var q Query = client.Collection(CHARACTERS_COLLECTION)

	// Helper to resolve tag slug/ID to CharTag
	resolveCharTag := func(category, filterVal string) (*CharTag, error) {
		// Try by ID first
		doc, err := client.Collection(TAGS_COLLECTION).Doc(filterVal).Get(c.Request.Context())
		if err == nil && doc.Exists() {
			t, err := docToTag(doc)
			if err == nil && t.Category == category {
				return &CharTag{ID: t.ID, Category: t.Category, Name: t.Name, Slug: t.Slug}, nil
			}
		}
		// Try by slug
		docs, err := client.Collection(TAGS_COLLECTION).Where("slug", "==", filterVal).Limit(1).Documents(c.Request.Context()).GetAll()
		if err == nil && len(docs) > 0 {
			t, err := docToTag(docs[0])
			if err == nil && t.Category == category {
				return &CharTag{ID: t.ID, Category: t.Category, Name: t.Name, Slug: t.Slug}, nil
			}
		}
		return nil, fmt.Errorf("Tag not found")
	}

	// Firestore only allows ONE array-contains clause per query.
	// Count how many tag filters were requested and reject if > 1.
	var tagFilterCount int
	if c.Query("fandom") != "" {
		tagFilterCount++
	}
	if c.Query("race") != "" {
		tagFilterCount++
	}
	if c.Query("gender") != "" {
		tagFilterCount++
	}
	if tagFilterCount > 1 {
		send400(c, "Only one tag filter (fandom, race, or gender) may be used per query")
		return
	}

	// Apply fandom filter
	if f := c.Query("fandom"); f != "" {
		ct, err := resolveCharTag("fandom", f)
		if err != nil {
			send400(c, "Invalid fandom tag filter: "+err.Error())
			return
		}
		q = q.Where("fandom", "array-contains", *ct)
	}

	// Apply race filter
	if r := c.Query("race"); r != "" {
		ct, err := resolveCharTag("race", r)
		if err != nil {
			send400(c, "Invalid race tag filter: "+err.Error())
			return
		}
		q = q.Where("race", "array-contains", *ct)
	}

	// Apply gender filter
	if g := c.Query("gender"); g != "" {
		ct, err := resolveCharTag("gender", g)
		if err != nil {
			send400(c, "Invalid gender tag filter: "+err.Error())
			return
		}
		q = q.Where("gender", "array-contains", *ct)
	}

	docs, err := q.Documents(c.Request.Context()).GetAll()
	if err != nil {
		send500(c, "Failed to query characters: "+err.Error())
		return
	}

	results := make([]CharacterOut, 0)
	for _, doc := range docs {
		charOut, err := resolveCharacterOut(c.Request.Context(), client, doc)
		if err != nil {
			log.Printf("[WARN] Failed to resolve character %s: %v", doc.ID(), err)
			continue
		}
		results = append(results, charOut)
	}

	c.JSON(http.StatusOK, results)
}

// handleGetCharacter godoc
// @Summary      Get a character by ID
// @Tags         characters
// @Param        id  path  string  true  "Character ID"
// @Success      200  {object}  CharacterOut
// @Router       /characters/{id} [get]
func handleGetCharacter(c *gin.Context) {
	id := c.Param("id")
	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	doc, err := client.Collection(CHARACTERS_COLLECTION).Doc(id).Get(c.Request.Context())
	if err != nil || !doc.Exists() {
		send404(c, "Character not found")
		return
	}

	charOut, err := resolveCharacterOut(c.Request.Context(), client, doc)
	if err != nil {
		send500(c, err.Error())
		return
	}

	c.JSON(http.StatusOK, charOut)
}

// handleGetRandomCharacter godoc
// @Summary      Get a random character
// @Tags         characters
// @Success      200  {object}  CharacterOut
// @Router       /characters/random [get]
func handleGetRandomCharacter(c *gin.Context) {
	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	docs, err := client.Collection(CHARACTERS_COLLECTION).Documents(c.Request.Context()).GetAll()
	if err != nil || len(docs) == 0 {
		send404(c, "No characters found")
		return
	}

	randomDoc := docs[rand.Intn(len(docs))]

	charOut, err := resolveCharacterOut(c.Request.Context(), client, randomDoc)
	if err != nil {
		send500(c, err.Error())
		return
	}

	c.JSON(http.StatusOK, charOut)
}

// handleCreateCharacter godoc
// @Summary      Create a character (Admin only)
// @Tags         characters
// @Accept       json
// @Produce      json
// @Param        body  body  CharacterCreate  true  "Character creation payload"
// @Success      201  {object}  CharacterOut
// @Security     BearerAuth
// @Router       /characters/ [post]
func handleCreateCharacter(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdmin(auth.Role) {
		send403(c, "Admin or Root Admin authorization required")
		return
	}

	var body CharacterCreate
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": err.Error()})
		return
	}

	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	// Validate tags
	allTags := append(body.Fandom, body.Race...)
	allTags = append(allTags, body.Gender...)
	if err := validateCharacterTags(c.Request.Context(), client, allTags); err != nil {
		send400(c, "Tag validation failed: "+err.Error())
		return
	}

	id := uuid.New().String()
	data := map[string]interface{}{
		"display_name": body.DisplayName,
		"fandom":       charTagsToInterface(body.Fandom),
		"race":         charTagsToInterface(body.Race),
		"gender":       charTagsToInterface(body.Gender),
		"image_ids":    body.ImageIDs,
		"created_at":   firestore.ServerTimestamp,
		"updated_at":   firestore.ServerTimestamp,
	}
	if body.Tagline != nil {
		data["tagline"] = *body.Tagline
	}
	if body.Bio != nil {
		data["bio"] = *body.Bio
	}

	ref := client.Collection(CHARACTERS_COLLECTION).Doc(id)
	if _, err := ref.Set(c.Request.Context(), data); err != nil {
		send500(c, "Failed to create character")
		return
	}

	doc, err := ref.Get(c.Request.Context())
	if err != nil {
		send500(c, "Failed to refetch created character")
		return
	}

	charOut, err := resolveCharacterOut(c.Request.Context(), client, doc)
	if err != nil {
		send500(c, err.Error())
		return
	}

	c.JSON(http.StatusCreated, charOut)
}

// handleUpdateCharacter godoc
// @Summary      Update a character (Admin only)
// @Tags         characters
// @Param        id    path  string           true  "Character ID"
// @Param        body  body  CharacterUpdate  true  "Fields to update"
// @Success      200  {object}  CharacterOut
// @Security     BearerAuth
// @Router       /characters/{id} [put]
func handleUpdateCharacter(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdmin(auth.Role) {
		send403(c, "Admin or Root Admin authorization required")
		return
	}

	id := c.Param("id")
	var body CharacterUpdate
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": err.Error()})
		return
	}

	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	ref := client.Collection(CHARACTERS_COLLECTION).Doc(id)
	doc, err := ref.Get(c.Request.Context())
	if err != nil || !doc.Exists() {
		send404(c, "Character not found")
		return
	}

	updates := []firestore.Update{
		{Path: "updated_at", Value: firestore.ServerTimestamp},
	}
	if body.DisplayName != nil {
		updates = append(updates, firestore.Update{Path: "display_name", Value: *body.DisplayName})
	}
	if body.Tagline != nil {
		updates = append(updates, firestore.Update{Path: "tagline", Value: *body.Tagline})
	}
	if body.Bio != nil {
		updates = append(updates, firestore.Update{Path: "bio", Value: *body.Bio})
	}
	if body.ImageIDs != nil {
		updates = append(updates, firestore.Update{Path: "image_ids", Value: *body.ImageIDs})
	}

	// Validate and update tags if provided
	var newTags []CharTag
	if body.Fandom != nil {
		newTags = append(newTags, *body.Fandom...)
		updates = append(updates, firestore.Update{Path: "fandom", Value: charTagsToInterface(*body.Fandom)})
	} else {
		// load existing
		var existingFandom []CharTag
		if raw, ok := doc.Data()["fandom"]; ok {
			existingFandom = convertToCharTags(raw)
		}
		newTags = append(newTags, existingFandom...)
	}
	if body.Race != nil {
		newTags = append(newTags, *body.Race...)
		updates = append(updates, firestore.Update{Path: "race", Value: charTagsToInterface(*body.Race)})
	} else {
		var existingRace []CharTag
		if raw, ok := doc.Data()["race"]; ok {
			existingRace = convertToCharTags(raw)
		}
		newTags = append(newTags, existingRace...)
	}
	if body.Gender != nil {
		newTags = append(newTags, *body.Gender...)
		updates = append(updates, firestore.Update{Path: "gender", Value: charTagsToInterface(*body.Gender)})
	} else {
		var existingGender []CharTag
		if raw, ok := doc.Data()["gender"]; ok {
			existingGender = convertToCharTags(raw)
		}
		newTags = append(newTags, existingGender...)
	}

	if len(newTags) > 0 {
		if err := validateCharacterTags(c.Request.Context(), client, newTags); err != nil {
			send400(c, "Tag validation failed: "+err.Error())
			return
		}
	}

	if len(updates) > 1 {
		if _, err := ref.Update(c.Request.Context(), updates); err != nil {
			send500(c, "Failed to update character: "+err.Error())
			return
		}
	}

	newDoc, err := ref.Get(c.Request.Context())
	if err != nil {
		send500(c, "Failed to refetch updated character")
		return
	}

	charOut, err := resolveCharacterOut(c.Request.Context(), client, newDoc)
	if err != nil {
		send500(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, charOut)
}

// handleDeleteCharacter godoc
// @Summary      Delete a character (Admin only)
// @Tags         characters
// @Param        id  path  string  true  "Character ID"
// @Success      204  "No Content"
// @Security     BearerAuth
// @Router       /characters/{id} [delete]
func handleDeleteCharacter(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdmin(auth.Role) {
		send403(c, "Admin or Root Admin authorization required")
		return
	}

	id := c.Param("id")
	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	ref := client.Collection(CHARACTERS_COLLECTION).Doc(id)
	doc, err := ref.Get(c.Request.Context())
	if err != nil || !doc.Exists() {
		send404(c, "Character not found")
		return
	}

	// 1. Delete associated GCS files
	if err := deleteCharacterImagesFunc(c.Request.Context(), id); err != nil {
		log.Printf("[WARN] Failed to delete character GCS files: %v", err)
	}

	// 2. Delete associated Firestore image documents
	imgDocs, err := client.Collection(IMAGES_COLLECTION).Where("character_id", "==", id).Documents(c.Request.Context()).GetAll()
	if err == nil {
		batch := client.Batch()
		for _, imgDoc := range imgDocs {
			batch.Delete(imgDoc.Ref())
		}
		if _, err := batch.Commit(c.Request.Context()); err != nil {
			log.Printf("[WARN] Failed to batch-delete associated image documents: %v", err)
		}
	}

	// 3. Delete the character itself
	if _, err := ref.Delete(c.Request.Context()); err != nil {
		send500(c, "Failed to delete character")
		return
	}

	c.Status(http.StatusNoContent)
}

// Helper: resolveCharacterOut matches models.go
func resolveCharacterOut(ctx context.Context, client FirestoreClient, doc DocumentSnapshot) (CharacterOut, error) {
	d := doc.Data()
	if d == nil {
		return CharacterOut{}, fmt.Errorf("Character document %s empty", doc.ID())
	}

	getStr := func(key string) *string {
		if val, ok := d[key].(string); ok {
			return &val
		}
		return nil
	}

	reqStr := func(key string) string {
		if val, ok := d[key].(string); ok {
			return val
		}
		return ""
	}

	getTimestamp := func(key string) *time.Time {
		if val, ok := d[key].(time.Time); ok {
			return &val
		}
		return nil
	}

	// Parse denormalized tags
	fandom := convertToCharTags(d["fandom"])
	race := convertToCharTags(d["race"])
	gender := convertToCharTags(d["gender"])

	// Parse image_ids
	var imageIDs []string
	if rawIDs, ok := d["image_ids"].([]interface{}); ok {
		for _, idVal := range rawIDs {
			if s, ok := idVal.(string); ok {
				imageIDs = append(imageIDs, s)
			}
		}
	}

	// Resolve images
	images := make([]ImageOut, 0)
	if len(imageIDs) > 0 {
		refs := make([]DocumentRef, len(imageIDs))
		for i, id := range imageIDs {
			refs[i] = client.Collection(IMAGES_COLLECTION).Doc(id)
		}
		snaps, err := client.GetAll(ctx, refs)
		if err == nil {
			for _, snap := range snaps {
				if snap.Exists() {
					img, err := docToImage(snap)
					if err == nil {
						images = append(images, img)
					}
				}
			}
		} else {
			log.Printf("[WARN] Failed to resolve images for character %s: %v", doc.ID(), err)
		}
	}

	return CharacterOut{
		CharacterID: doc.ID(),
		DisplayName: reqStr("display_name"),
		Tagline:     getStr("tagline"),
		Bio:         getStr("bio"),
		Fandom:      fandom,
		Race:        race,
		Gender:      gender,
		Images:      images,
		CreatedAt:   getTimestamp("created_at"),
		UpdatedAt:   getTimestamp("updated_at"),
	}, nil
}

// Helper: safe cast array of interface/maps to CharTag
func convertToCharTags(raw interface{}) []CharTag {
	res := make([]CharTag, 0)
	if raw == nil {
		return res
	}
	if typedList, ok := raw.([]CharTag); ok {
		return typedList
	}
	if list, ok := raw.([]interface{}); ok {
		for _, item := range list {
			if m, ok := item.(map[string]interface{}); ok {
				res = append(res, CharTag{
					ID:       safeStr(m["id"]),
					Category: safeStr(m["category"]),
					Name:     safeStr(m["name"]),
					Slug:     safeStr(m["slug"]),
				})
			} else if ct, ok := item.(CharTag); ok {
				res = append(res, ct)
			}
		}
	}
	return res
}

func charTagsToInterface(tags []CharTag) []interface{} {
	if tags == nil {
		return []interface{}{}
	}
	res := make([]interface{}, len(tags))
	for i, t := range tags {
		res[i] = map[string]interface{}{
			"id":       t.ID,
			"category": t.Category,
			"name":     t.Name,
			"slug":     t.Slug,
		}
	}
	return res
}

func safeStr(val interface{}) string {
	if s, ok := val.(string); ok {
		return s
	}
	return ""
}
