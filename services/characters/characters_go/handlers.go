package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"strings"
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
// @Param        class   query  string  false  "Class tag slug or ID"
// @Success      200  {array}  CharacterOut
// @Router       /characters/ [get]
func handleListAllCharacters(c *gin.Context) {
	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	auth := GetAuth(c)

	// Resolve tag filters — collect slugs to filter on (hierarchical format)
	var fandomFilterSlug string
	var childFilterSlugs []string

	if val := c.Query("fandom"); val != "" {
		tag, err := resolveTagFilter(c.Request.Context(), client, "fandom", val)
		if err != nil {
			send400(c, "Invalid fandom tag filter: "+err.Error())
			return
		}
		fandomFilterSlug = tag.Slug
	}

	childCategories := []string{"race", "gender", "class"}
	for _, cat := range childCategories {
		if val := c.Query(cat); val != "" {
			tag, err := resolveTagFilter(c.Request.Context(), client, cat, val)
			if err != nil {
				send400(c, "Invalid "+cat+" tag filter: "+err.Error())
				return
			}
			childFilterSlugs = append(childFilterSlugs, tag.Slug)
		}
	}

	// Build hierarchical filter slugs
	var filterSlugs []string
	if fandomFilterSlug != "" {
		filterSlugs = append(filterSlugs, fandomFilterSlug)
		// Prefix child slugs with fandom
		for _, cs := range childFilterSlugs {
			filterSlugs = append(filterSlugs, fandomFilterSlug+"."+cs)
		}
	} else {
		// No fandom filter — use child slugs as-is
		filterSlugs = append(filterSlugs, childFilterSlugs...)
	}

	var docs []DocumentSnapshot
	if !IsAdmin(auth.Role) {
		if auth.UID == "" {
			send401(c, "Unauthorized")
			return
		}
		// Non-admins only retrieve adopted characters
		var err error
		docs, err = client.Collection(CHARACTERS_COLLECTION).Where("status", "==", "adopted").Documents(c.Request.Context()).GetAll()
		if err != nil {
			send500(c, "Failed to query adopted characters: "+err.Error())
			return
		}
	} else {
		// Admins: use array-contains for a single tag filter at Firestore level
		var q Query = client.Collection(CHARACTERS_COLLECTION)
		if len(filterSlugs) == 1 {
			q = q.Where("character_tags", "array-contains", filterSlugs[0])
		}
		var err error
		docs, err = q.Documents(c.Request.Context()).GetAll()
		if err != nil {
			send500(c, "Failed to query characters: "+err.Error())
			return
		}
	}

	// Collect all unique slugs across all characters for batch resolution
	allSlugs := make(map[string]bool)
	type docWithSlugs struct {
		doc   DocumentSnapshot
		slugs []string
	}
	var docSlugs []docWithSlugs
	for _, doc := range docs {
		slugs := extractCharacterTagSlugs(doc.Data())
		for _, s := range slugs {
			allSlugs[s] = true
		}
		docSlugs = append(docSlugs, docWithSlugs{doc: doc, slugs: slugs})
	}

	// Batch resolve all slugs → CharTag
	var slugList []string
	for s := range allSlugs {
		slugList = append(slugList, s)
	}
	tagCache, err := resolveSlugsToCharTags(c.Request.Context(), client, slugList)
	if err != nil {
		log.Printf("[WARN] Failed to batch resolve tag slugs: %v", err)
		tagCache = make(map[string]CharTag)
	}

	// Resolve and filter
	results := make([]CharacterOut, 0)
	for _, ds := range docSlugs {
		charOut, err := resolveCharacterOutWithCache(c.Request.Context(), client, ds.doc, ds.slugs, tagCache)
		if err != nil {
			log.Printf("[WARN] Failed to resolve character %s: %v", ds.doc.ID(), err)
			continue
		}

		// Non-admins: filter adopted only + in-memory tag checks
		if !IsAdmin(auth.Role) {
			if charOut.Status != "adopted" {
				continue
			}
		}

		// In-memory multi-tag filter: character must contain ALL filter slugs
		if len(filterSlugs) > 0 {
			slugSet := make(map[string]bool, len(ds.slugs))
			for _, s := range ds.slugs {
				slugSet[s] = true
			}
			match := true
			for _, fs := range filterSlugs {
				if !slugSet[fs] {
					match = false
					break
				}
			}
			if !match {
				continue
			}
		}

		results = append(results, charOut)
	}

	c.JSON(http.StatusOK, results)
}

// resolveTagFilter resolves a tag slug or ID to a CharTag for filtering.
func resolveTagFilter(ctx context.Context, client FirestoreClient, category, filterVal string) (*CharTag, error) {
	// Try by ID first
	doc, err := client.Collection(TAGS_COLLECTION).Doc(filterVal).Get(ctx)
	if err == nil && doc.Exists() {
		t, err := docToTag(doc)
		if err == nil && t.Category == category {
			return &CharTag{ID: t.ID, Category: t.Category, Name: t.Name, Slug: t.Slug}, nil
		}
	}
	// Try by slug
	docs, err := client.Collection(TAGS_COLLECTION).Where("slug", "==", filterVal).Limit(1).Documents(ctx).GetAll()
	if err == nil && len(docs) > 0 {
		t, err := docToTag(docs[0])
		if err == nil && t.Category == category {
			return &CharTag{ID: t.ID, Category: t.Category, Name: t.Name, Slug: t.Slug}, nil
		}
	}
	return nil, fmt.Errorf("Tag not found")
}

func hasTag(tags []CharTag, tagID string) bool {
	for _, t := range tags {
		if t.ID == tagID {
			return true
		}
	}
	return false
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
	allTags = append(allTags, body.Class...)
	if err := validateCharacterTags(c.Request.Context(), client, allTags); err != nil {
		send400(c, "Tag validation failed: "+err.Error())
		return
	}

	id := uuid.New().String()
	data := map[string]interface{}{
		"display_name":   body.DisplayName,
		"character_tags": tagsToSlugs(body.Fandom, body.Race, body.Gender, body.Class),
		"image_ids":      body.ImageIDs,
		"created_at":     firestore.ServerTimestamp,
		"updated_at":     firestore.ServerTimestamp,
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

	// Rebuild character_tags: load existing slugs, override with any provided categories
	existingSlugs := extractCharacterTagSlugs(doc.Data())
	existingTagMap, _ := resolveSlugsToCharTags(c.Request.Context(), client, existingSlugs)

	// Group existing tags by category
	existingByCategory := make(map[string][]CharTag)
	for _, slug := range existingSlugs {
		if ct, ok := existingTagMap[slug]; ok {
			existingByCategory[ct.Category] = append(existingByCategory[ct.Category], ct)
		}
	}

	// Resolve final tags per category: override if provided, else keep existing
	resolveCat := func(provided *[]CharTag, cat string) []CharTag {
		if provided != nil {
			return *provided
		}
		return existingByCategory[cat]
	}
	finalFandom := resolveCat(body.Fandom, "fandom")
	finalRace := resolveCat(body.Race, "race")
	finalGender := resolveCat(body.Gender, "gender")
	finalClass := resolveCat(body.Class, "class")

	allFinalTags := append(finalFandom, finalRace...)
	allFinalTags = append(allFinalTags, finalGender...)
	allFinalTags = append(allFinalTags, finalClass...)

	if len(allFinalTags) > 0 {
		if err := validateCharacterTags(c.Request.Context(), client, allFinalTags); err != nil {
			send400(c, "Tag validation failed: "+err.Error())
			return
		}
	}
	updates = append(updates, firestore.Update{Path: "character_tags", Value: tagsToSlugs(finalFandom, finalRace, finalGender, finalClass)})

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

// resolveCharacterOut resolves a character document into CharacterOut.
// It reads the character_tags slug array and resolves slugs to full CharTag objects.
func resolveCharacterOut(ctx context.Context, client FirestoreClient, doc DocumentSnapshot) (CharacterOut, error) {
	slugs := extractCharacterTagSlugs(doc.Data())
	tagCache, err := resolveSlugsToCharTags(ctx, client, slugs)
	if err != nil {
		log.Printf("[WARN] Failed to resolve tag slugs for character %s: %v", doc.ID(), err)
		tagCache = make(map[string]CharTag)
	}
	return resolveCharacterOutWithCache(ctx, client, doc, slugs, tagCache)
}

// resolveCharacterOutWithCache resolves a character using a pre-built tag cache.
// Used by list endpoints to avoid N+1 tag resolution queries.
func resolveCharacterOutWithCache(ctx context.Context, client FirestoreClient, doc DocumentSnapshot, slugs []string, tagCache map[string]CharTag) (CharacterOut, error) {
	d := doc.Data()
	if d == nil {
		return CharacterOut{}, fmt.Errorf("nil data")
	}

	reqStr := func(key string) string {
		if val, ok := d[key].(string); ok {
			return val
		}
		return ""
	}

	getStr := func(key string) *string {
		if val, ok := d[key].(string); ok {
			return &val
		}
		return nil
	}

	getTimestamp := func(key string) *time.Time {
		if val, ok := d[key].(time.Time); ok {
			return &val
		}
		return nil
	}

	// Split resolved tags by category
	fandom, race, gender, class := splitTagsByCategory(slugs, tagCache)

	// Parse image_ids
	var imageIDs []string
	if rawIDs, ok := d["image_ids"].([]interface{}); ok {
		for _, idVal := range rawIDs {
			if s, ok := idVal.(string); ok {
				imageIDs = append(imageIDs, s)
			}
		}
	} else if rawIDs, ok := d["image_ids"].([]string); ok {
		imageIDs = rawIDs
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

	status := reqStr("status")
	if status == "" {
		status = "adopted" // default legacy characters to adopted
	}

	return CharacterOut{
		CharacterID: doc.ID(),
		DisplayName: reqStr("display_name"),
		Tagline:     getStr("tagline"),
		Bio:         getStr("bio"),
		Fandom:      fandom,
		Race:        race,
		Gender:      gender,
		Class:       class,
		Images:      images,
		Status:      status,
		CreatedAt:   getTimestamp("created_at"),
		UpdatedAt:   getTimestamp("updated_at"),
	}, nil
}

// tagsToSlugs builds a flat array of hierarchical slug strings for storage.
// Fandom tags are stored as-is (e.g. "fandom__d_d").
// Child tags (race, gender, class) are prefixed with the fandom slug
// (e.g. "fandom__d_d.race__elf") so tags are scoped to their fandom.
func tagsToSlugs(fandom, race, gender, class []CharTag) []string {
	var slugs []string

	// Determine fandom prefix (use first fandom tag if available)
	var fandomPrefix string
	for _, t := range fandom {
		if t.Slug != "" {
			slugs = append(slugs, t.Slug)
			if fandomPrefix == "" {
				fandomPrefix = t.Slug
			}
		}
	}

	// Child categories get prefixed with fandom
	childSets := [][]CharTag{race, gender, class}
	for _, tags := range childSets {
		for _, t := range tags {
			if t.Slug == "" {
				continue
			}
			if fandomPrefix != "" {
				slugs = append(slugs, fandomPrefix+"."+t.Slug)
			} else {
				slugs = append(slugs, t.Slug)
			}
		}
	}

	if slugs == nil {
		return []string{}
	}
	return slugs
}

// extractCharacterTagSlugs reads the character_tags string array from a Firestore document.
func extractCharacterTagSlugs(d map[string]interface{}) []string {
	var slugs []string
	if raw, ok := d["character_tags"].([]interface{}); ok {
		for _, v := range raw {
			if s, ok := v.(string); ok {
				slugs = append(slugs, s)
			}
		}
	} else if raw, ok := d["character_tags"].([]string); ok {
		slugs = raw
	}
	return slugs
}

// leafSlug extracts the leaf (last segment) from a hierarchical slug.
// e.g. "fandom__d_d.race__elf" → "race__elf", "fandom__d_d" → "fandom__d_d"
func leafSlug(hierarchicalSlug string) string {
	if idx := strings.LastIndex(hierarchicalSlug, "."); idx != -1 {
		return hierarchicalSlug[idx+1:]
	}
	return hierarchicalSlug
}

// resolveSlugsToCharTags batch-resolves hierarchical slug strings to full CharTag objects.
// It extracts the leaf slug from each hierarchical path (e.g. "fandom__d_d.race__elf" → "race__elf"),
// queries the character_tags collection by those leaf slugs, and returns a map keyed by the
// FULL hierarchical slug → CharTag.
func resolveSlugsToCharTags(ctx context.Context, client FirestoreClient, slugs []string) (map[string]CharTag, error) {
	result := make(map[string]CharTag)
	if len(slugs) == 0 {
		return result, nil
	}

	// Build leaf → [full hierarchical slugs] mapping
	leafToFull := make(map[string][]string)
	var uniqueLeaves []string
	seen := make(map[string]bool)
	for _, fullSlug := range slugs {
		leaf := leafSlug(fullSlug)
		leafToFull[leaf] = append(leafToFull[leaf], fullSlug)
		if !seen[leaf] {
			uniqueLeaves = append(uniqueLeaves, leaf)
			seen[leaf] = true
		}
	}

	// Firestore "in" supports up to 30 values — batch if needed
	for i := 0; i < len(uniqueLeaves); i += 30 {
		end := i + 30
		if end > len(uniqueLeaves) {
			end = len(uniqueLeaves)
		}
		batch := uniqueLeaves[i:end]

		docs, err := client.Collection(TAGS_COLLECTION).Where("slug", "in", batch).Documents(ctx).GetAll()
		if err != nil {
			return result, fmt.Errorf("failed to resolve tag slugs: %w", err)
		}
		for _, doc := range docs {
			t, err := docToTag(doc)
			if err == nil {
				ct := CharTag{
					ID:       t.ID,
					Category: t.Category,
					Name:     t.Name,
					Slug:     t.Slug,
				}
				// Map the resolved tag back to ALL full hierarchical slugs that share this leaf
				for _, fullSlug := range leafToFull[t.Slug] {
					result[fullSlug] = ct
				}
			}
		}
	}
	return result, nil
}

// splitTagsByCategory groups resolved CharTags by their category.
// For hierarchical slugs like "fandom__d_d.race__elf", the category comes from
// the resolved leaf tag (race). Fandom slugs have no dot separator.
func splitTagsByCategory(slugs []string, tagCache map[string]CharTag) (fandom, race, gender, class []CharTag) {
	fandom = make([]CharTag, 0)
	race = make([]CharTag, 0)
	gender = make([]CharTag, 0)
	class = make([]CharTag, 0)
	for _, slug := range slugs {
		ct, ok := tagCache[slug]
		if !ok {
			// Derive category from leaf slug prefix as fallback
			leaf := leafSlug(slug)
			parts := strings.SplitN(leaf, "__", 2)
			if len(parts) == 2 {
				ct = CharTag{Slug: parts[0] + "__" + parts[1], Category: parts[0], Name: parts[1]}
			} else {
				continue
			}
		}
		switch ct.Category {
		case "fandom":
			fandom = append(fandom, ct)
		case "race":
			race = append(race, ct)
		case "gender":
			gender = append(gender, ct)
		case "class":
			class = append(class, ct)
		}
	}
	return
}

func safeStr(val interface{}) string {
	if s, ok := val.(string); ok {
		return s
	}
	return ""
}

// handleValidateProfile godoc
// @Summary      Validate if a profile is a generated character
// @Tags         characters
// @Accept       json
// @Produce      json
// @Param        body  body  ProfileValidationRequest  true  "Profile validation payload"
// @Success      200  {object}  ValidationResponse
// @Router       /characters/validate [post]
func handleValidateProfile(c *gin.Context) {
	var body ProfileValidationRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": err.Error()})
		return
	}

	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	// Query characters by display name
	docs, err := client.Collection(CHARACTERS_COLLECTION).Where("display_name", "==", body.DisplayName).Documents(c.Request.Context()).GetAll()
	if err != nil {
		send500(c, "Failed to query characters: "+err.Error())
		return
	}

	// For strict matching, we check if there's any document that exactly matches tagline and bio.
	for _, doc := range docs {
		d := doc.Data()

		dbTagline := ""
		if v, ok := d["tagline"].(string); ok {
			dbTagline = v
		}

		dbBio := ""
		if v, ok := d["bio"].(string); ok {
			dbBio = v
		}

		reqTagline := ""
		if body.Tagline != nil {
			reqTagline = *body.Tagline
		}

		reqBio := ""
		if body.Bio != nil {
			reqBio = *body.Bio
		}

		if dbTagline == reqTagline && dbBio == reqBio {
			// Resolve the character images to compare URLs
			charOut, err := resolveCharacterOut(c.Request.Context(), client, doc)
			if err != nil {
				log.Printf("[WARN] Failed to resolve character %s for validation: %v", doc.ID(), err)
				continue
			}

			// Extract character image URLs
			var charImageURLs []string
			for _, img := range charOut.Images {
				charImageURLs = append(charImageURLs, img.URL)
			}

			// Compare lengths
			if len(body.ImageURLs) != len(charImageURLs) {
				continue // Length mismatch, try next document
			}

			// Compare elements. We assume order doesn't necessarily have to match but usually does.
			// Let's do exact ordered match for simplicity, or we could sort/map them.
			// The original prompt implies validation of "generated profile", so it should match exactly.
			imagesMatch := true
			for i := range body.ImageURLs {
				if body.ImageURLs[i] != charImageURLs[i] {
					imagesMatch = false
					break
				}
			}

			if imagesMatch {
				c.JSON(http.StatusOK, ValidationResponse{IsGenerated: true, Status: charOut.Status})
				return
			}
		}
	}

	c.JSON(http.StatusOK, ValidationResponse{IsGenerated: false})
}

// handleGenerateCharacterDetails godoc
// @Summary      Generate character details using AI
// @Tags         characters
// @Accept       json
// @Produce      json
// @Param        body  body  CharacterGenerateRequest  true  "Tags to generate character from"
// @Success      200  {object}  CharacterOut
// @Security     BearerAuth
// @Router       /characters/generate [post]
func handleGenerateCharacterDetails(c *gin.Context) {
	var body CharacterGenerateRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": err.Error()})
		return
	}

	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	auth := GetAuth(c)
	if auth.UID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"detail": "Unauthorized"})
		return
	}

	// Validate tags
	allTags := append(body.Fandom, body.Race...)
	allTags = append(allTags, body.Gender...)
	allTags = append(allTags, body.Class...)
	if err := validateCharacterTags(c.Request.Context(), client, allTags); err != nil {
		send400(c, "Tag validation failed: "+err.Error())
		return
	}

	// Build the text prompt from parameters
	var fandomNames, raceNames, genderNames, classNames []string
	for _, t := range body.Fandom {
		fandomNames = append(fandomNames, t.Name)
	}
	for _, t := range body.Race {
		raceNames = append(raceNames, t.Name)
	}
	for _, t := range body.Gender {
		genderNames = append(genderNames, t.Name)
	}
	for _, t := range body.Class {
		classNames = append(classNames, t.Name)
	}

	prompt := fmt.Sprintf("Fandom: %s, Gender: %s, Race: %s, Class: %s",
		strings.Join(fandomNames, ", "),
		strings.Join(genderNames, ", "),
		strings.Join(raceNames, ", "),
		strings.Join(classNames, ", "),
	)

	// Call the agent router
	agentRouterURL := serviceURLs.Get("agent_router")
	payload := map[string]interface{}{
		"prompt": prompt,
		"agent":  "character_generator",
		"model":  "gemini-flash-lite",
	}
	bodyBytes, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(c.Request.Context(), "POST", agentRouterURL+"/invoke", bytes.NewBuffer(bodyBytes))
	if err != nil {
		send500(c, "Failed to construct agent router request: "+err.Error())
		return
	}
	req.Header.Set("Authorization", "Bearer "+auth.Token)
	req.Header.Set("Content-Type", "application/json")

	agentClient := &http.Client{Timeout: 60 * time.Second}
	resp, err := agentClient.Do(req)
	if err != nil {
		send500(c, "Failed to call agent router: "+err.Error())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		send500(c, fmt.Sprintf("agent_router error (HTTP %d): %s", resp.StatusCode, string(respBody)))
		return
	}

	var invokeResp struct {
		Response string `json:"response"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&invokeResp); err != nil {
		send500(c, "Failed to decode agent router response: "+err.Error())
		return
	}

	trimmed := strings.TrimSpace(invokeResp.Response)
	if strings.HasPrefix(trimmed, "```") {
		lines := strings.Split(trimmed, "\n")
		if len(lines) >= 3 {
			inner := lines[1:]
			for len(inner) > 0 && strings.TrimSpace(inner[len(inner)-1]) == "```" {
				inner = inner[:len(inner)-1]
			}
			trimmed = strings.TrimSpace(strings.Join(inner, "\n"))
		}
	}
	if strings.HasPrefix(trimmed, "```json") {
		trimmed = strings.TrimPrefix(trimmed, "```json")
		trimmed = strings.TrimSuffix(trimmed, "```")
		trimmed = strings.TrimSpace(trimmed)
	}

	var generated struct {
		Name        string `json:"name"`
		Tagline     string `json:"tagline"`
		Bio         string `json:"bio"`
		ImagePrompt string `json:"image_prompt"`
	}
	if err := json.Unmarshal([]byte(trimmed), &generated); err != nil {
		send500(c, "Failed to parse generated character JSON: "+err.Error()+" (raw: "+invokeResp.Response+")")
		return
	}

	characterID := uuid.New().String()
	charData := map[string]interface{}{
		"display_name": generated.Name,
		"tagline":      generated.Tagline,
		"bio":          generated.Bio,
		"image_prompt": generated.ImagePrompt,
		"character_tags": tagsToSlugs(body.Fandom, body.Race, body.Gender, body.Class),
		"image_ids":    []interface{}{},
		"status":       "pending",
		"created_at":   firestore.ServerTimestamp,
		"updated_at":   firestore.ServerTimestamp,
	}

	charRef := client.Collection(CHARACTERS_COLLECTION).Doc(characterID)
	if _, err := charRef.Set(c.Request.Context(), charData); err != nil {
		send500(c, "Failed to write character to database: "+err.Error())
		return
	}

	doc, err := charRef.Get(c.Request.Context())
	if err != nil {
		send500(c, "Failed to refetch generated character: "+err.Error())
		return
	}

	charOut, err := resolveCharacterOut(c.Request.Context(), client, doc)
	if err != nil {
		send500(c, "Failed to resolve character output: "+err.Error())
		return
	}

	c.JSON(http.StatusOK, charOut)
}

// handleGenerateCharacterImage godoc
// @Summary      Generate character image using Imagen
// @Tags         characters
// @Accept       json
// @Produce      json
// @Param        id  path  string  true  "Character ID"
// @Success      200  {object}  CharacterOut
// @Security     BearerAuth
// @Router       /characters/{id}/generate-image [post]
func handleGenerateCharacterImage(c *gin.Context) {
	characterID := c.Param("id")

	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	auth := GetAuth(c)
	if auth.UID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"detail": "Unauthorized"})
		return
	}

	// Fetch character doc
	charRef := client.Collection(CHARACTERS_COLLECTION).Doc(characterID)
	charDoc, err := charRef.Get(c.Request.Context())
	if err != nil || !charDoc.Exists() {
		send404(c, "Character not found")
		return
	}

	charData := charDoc.Data()
	status, _ := charData["status"].(string)
	imagePrompt, _ := charData["image_prompt"].(string)

	if imagePrompt == "" {
		send400(c, "Character does not have an image generation prompt")
		return
	}

	// Safety check: only pending characters can generate images
	if status != "pending" {
		send400(c, "Character image can only be generated in pending status")
		return
	}

	// Call the agent router's image generator
	agentRouterURL := serviceURLs.Get("agent_router")
	payload := map[string]interface{}{
		"prompt":       imagePrompt,
		"aspect_ratio": "3:4",
	}
	bodyBytes, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(c.Request.Context(), "POST", agentRouterURL+"/generate-image", bytes.NewBuffer(bodyBytes))
	if err != nil {
		send500(c, "Failed to construct agent router image request: "+err.Error())
		return
	}
	req.Header.Set("Authorization", "Bearer "+auth.Token)
	req.Header.Set("Content-Type", "application/json")

	// Image generation can take a bit longer
	imageClient := &http.Client{Timeout: 60 * time.Second}
	resp, err := imageClient.Do(req)
	if err != nil {
		send500(c, "Failed to call agent router image generator: "+err.Error())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		send500(c, fmt.Sprintf("agent_router image generator error (HTTP %d): %s", resp.StatusCode, string(respBody)))
		return
	}

	var invokeResp struct {
		Image string `json:"image"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&invokeResp); err != nil {
		send500(c, "Failed to decode agent router image response: "+err.Error())
		return
	}

	base64Data := invokeResp.Image
	if idx := strings.Index(base64Data, ","); idx != -1 {
		base64Data = base64Data[idx+1:]
	}

	imgBytes, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		send500(c, "Failed to decode generated image base64: "+err.Error())
		return
	}

	// Normalize Image with isAdmin = true (bypassing strict bounds checks but filling to 1080x1350)
	normalizedData, err := normalizeImageRitual(imgBytes, true)
	if err != nil {
		send500(c, "Failed to normalize generated image: "+err.Error())
		return
	}

	imageID := uuid.New().String()
	filename := fmt.Sprintf("%s.jpg", imageID)

	// Upload to GCS
	publicURL, err := uploadToGCS(c.Request.Context(), characterID, filename, "image/jpeg", bytes.NewReader(normalizedData))
	if err != nil {
		send500(c, "Failed to upload generated image to GCS: "+err.Error())
		return
	}

	// Cleanup existing images if any
	var existingImageIDs []string
	if rawIDs, ok := charData["image_ids"].([]interface{}); ok {
		for _, idVal := range rawIDs {
			if s, ok := idVal.(string); ok {
				existingImageIDs = append(existingImageIDs, s)
			}
		}
	}

	for _, oldID := range existingImageIDs {
		oldFilename := fmt.Sprintf("%s.jpg", oldID)
		if err := deleteSingleImageFunc(c.Request.Context(), characterID, oldFilename); err != nil {
			log.Printf("[WARN] Failed to delete old GCS image %s: %v", oldFilename, err)
		}
		if _, err := client.Collection(IMAGES_COLLECTION).Doc(oldID).Delete(c.Request.Context()); err != nil {
			log.Printf("[WARN] Failed to delete old image doc %s: %v", oldID, err)
		}
	}

	// Write image metadata to Firestore
	imgData := map[string]interface{}{
		"url":          publicURL,
		"source_type":  "ai_generated",
		"character_id": characterID,
		"position":     0,
		"created_at":   firestore.ServerTimestamp,
		"updated_at":   firestore.ServerTimestamp,
	}

	_, err = client.Collection(IMAGES_COLLECTION).Doc(imageID).Set(c.Request.Context(), imgData)
	if err != nil {
		send500(c, "Failed to save image metadata: "+err.Error())
		return
	}

	// Update character's image_ids array to reference ONLY the new image ID
	_, err = charRef.Update(c.Request.Context(), []firestore.Update{
		{Path: "image_ids", Value: []interface{}{imageID}},
		{Path: "updated_at", Value: firestore.ServerTimestamp},
	})
	if err != nil {
		send500(c, "Failed to update character's image list: "+err.Error())
		return
	}

	// Get fresh document
	newDoc, err := charRef.Get(c.Request.Context())
	if err != nil {
		send500(c, "Failed to fetch updated character: "+err.Error())
		return
	}

	charOut, err := resolveCharacterOut(c.Request.Context(), client, newDoc)
	if err != nil {
		send500(c, "Failed to resolve character output: "+err.Error())
		return
	}

	c.JSON(http.StatusOK, charOut)
}

// handleAdoptCharacter godoc
// @Summary      Adopt a pending character
// @Tags         characters
// @Accept       json
// @Produce      json
// @Param        id  path  string  true  "Character ID"
// @Success      200  {object}  CharacterOut
// @Security     BearerAuth
// @Router       /characters/{id}/adopt [post]
func handleAdoptCharacter(c *gin.Context) {
	characterID := c.Param("id")

	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	auth := GetAuth(c)
	if auth.UID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"detail": "Unauthorized"})
		return
	}

	charRef := client.Collection(CHARACTERS_COLLECTION).Doc(characterID)
	charDoc, err := charRef.Get(c.Request.Context())
	if err != nil || !charDoc.Exists() {
		send404(c, "Character not found")
		return
	}

	charData := charDoc.Data()
	status, _ := charData["status"].(string)

	var imageIDs []string
	if rawIDs, ok := charData["image_ids"].([]interface{}); ok {
		for _, idVal := range rawIDs {
			if s, ok := idVal.(string); ok {
				imageIDs = append(imageIDs, s)
			}
		}
	}

	// Validate status is pending
	if status != "pending" {
		send400(c, "Character is not pending adoption")
		return
	}

	// Enforce image exists
	if len(imageIDs) == 0 {
		send400(c, "Character must have a generated image before adoption")
		return
	}

	// Adopt the character
	updates := []firestore.Update{
		{Path: "status", Value: "adopted"},
		{Path: "updated_at", Value: firestore.ServerTimestamp},
	}

	if _, err := charRef.Update(c.Request.Context(), updates); err != nil {
		send500(c, "Failed to adopt character: "+err.Error())
		return
	}

	newDoc, err := charRef.Get(c.Request.Context())
	if err != nil {
		send500(c, "Failed to fetch updated character: "+err.Error())
		return
	}

	charOut, err := resolveCharacterOut(c.Request.Context(), client, newDoc)
	if err != nil {
		send500(c, "Failed to resolve character output: "+err.Error())
		return
	}

	c.JSON(http.StatusOK, charOut)
}
