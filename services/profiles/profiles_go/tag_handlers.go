package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"google.golang.org/api/iterator"
)

const TAGS_COLLECTION = "tags"

var ValidCategories = map[string]bool{
	"gender":    true,
	"race":      true,
	"fandom":    true,
	"interests": true,
	"events":    true,
}

var slugPattern = regexp.MustCompile(`^[a-z0-9]+__[a-z0-9_]+$`)

func isValidSlug(slug string) bool {
	return slugPattern.MatchString(slug)
}

func generateSlugWithUniqueness(ctx context.Context, client FirestoreClient, category, name string) (string, error) {
	base := strings.ToLower(name)
	base = strings.ReplaceAll(base, " ", "_")
	// Remove non-alphanumeric
	reg, _ := regexp.Compile("[^a-z0-9_]+")
	base = reg.ReplaceAllString(base, "")
	
	baseSlug := fmt.Sprintf("%s__%s", category, base)
	
	// Check if exists
	slug := baseSlug
	suffix := 1
	for {
		existing, err := client.Collection(TAGS_COLLECTION).Where("slug", "==", slug).Documents(ctx).GetAll()
		if err != nil {
			return "", err
		}
		if len(existing) == 0 {
			return slug, nil
		}
		slug = fmt.Sprintf("%s_%d", baseSlug, suffix)
		suffix++
	}
}

// handleGetTag godoc
// @Summary      Get a tag by ID
// @Tags         tags
// @Param        id  path  string  true  "Tag ID"
// @Success      200  {object}  Tag
// @Router       /tags/{id} [get]
func handleGetTag(c *gin.Context) {
	id := c.Param("id")
	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	doc, err := client.Collection(TAGS_COLLECTION).Doc(id).Get(c.Request.Context())
	if err != nil || !doc.Exists() {
		send404(c, "Tag not found")
		return
	}

	t, err := docToTag(doc)
	if err != nil {
		send500(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, t)
}

// handleGetTagBySlug godoc
// @Summary      Get a tag by slug
// @Tags         tags
// @Param        slug  path  string  true  "Tag Slug"
// @Success      200  {object}  Tag
// @Router       /tags/slug/{slug} [get]
func handleGetTagBySlug(c *gin.Context) {
	slug := c.Param("slug")
	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	docs, err := client.Collection(TAGS_COLLECTION).Where("slug", "==", slug).Limit(1).Documents(c.Request.Context()).GetAll()
	if err != nil || len(docs) == 0 {
		send404(c, "Tag not found")
		return
	}

	t, err := docToTag(docs[0])
	if err != nil {
		send500(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, t)
}

// handleListTagsByCategory godoc
// @Summary      List tags in a category
// @Tags         tags
// @Param        category  path  string  true  "Category"
// @Success      200  {array}  Tag
// @Router       /tags/category/{category} [get]
func handleListTagsByCategory(c *gin.Context) {
	category := c.Param("category")
	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	docs, err := client.Collection(TAGS_COLLECTION).Where("category", "==", category).Documents(c.Request.Context()).GetAll()
	if err != nil {
		send500(c, "Failed to list tags")
		return
	}

	results := make([]Tag, 0)
	for _, doc := range docs {
		t, err := docToTag(doc)
		if err == nil {
			results = append(results, t)
		}
	}
	c.JSON(http.StatusOK, results)
}

// handleSearchTags godoc
// @Summary      Search tags by category and name prefix
// @Tags         tags
// @Accept       json
// @Produce      json
// @Param        body  body  TagSearchQuery  true  "Search query"
// @Success      200  {array}  Tag
// @Router       /tags/search [post]
func handleSearchTags(c *gin.Context) {
	var query TagSearchQuery
	if err := c.ShouldBindJSON(&query); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": err.Error()})
		return
	}

	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	nameLower := strings.ToLower(query.Name)
	// Prefix search: WHERE name_lower >= query.Name AND name_lower < query.Name + "\uf8ff"
	iter := client.Collection(TAGS_COLLECTION).
		Where("category", "==", query.Category).
		Where("name_lower", ">=", nameLower).
		Where("name_lower", "<", nameLower+"\uf8ff").
		Documents(c.Request.Context())

	results := make([]Tag, 0)
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			log.Printf("[ERROR] Tag search error: %v", err)
			break
		}
		t, err := docToTag(doc)
		if err == nil {
			results = append(results, t)
		}
	}

	c.JSON(http.StatusOK, results)
}

// handleValidateTags godoc
// @Summary      Validate tags existence
// @Tags         tags
// @Accept       json
// @Produce      json
// @Param        body  body  TagValidateRequest  true  "Validation fields"
// @Success      200  {object}  TagValidateResponse
// @Router       /tags/validate [post]
func handleValidateTags(c *gin.Context) {
	var body TagValidateRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": err.Error()})
		return
	}

	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	var q Query = client.Collection(TAGS_COLLECTION)
	hasField := false

	if body.Category != nil {
		q = q.Where("category", "==", *body.Category)
		hasField = true
	}
	if body.Name != nil {
		q = q.Where("name", "==", *body.Name)
		hasField = true
	}
	if body.Slug != nil {
		q = q.Where("slug", "==", *body.Slug)
		hasField = true
	}
	if body.MultiSelect != nil {
		q = q.Where("multi_select", "==", *body.MultiSelect)
		hasField = true
	}

	if !hasField {
		send400(c, "At least one field is required for validation")
		return
	}

	docs, err := q.Documents(c.Request.Context()).GetAll()
	if err != nil {
		send500(c, "Validation query failed")
		return
	}

	matches := make([]Tag, 0)
	for _, doc := range docs {
		t, err := docToTag(doc)
		if err == nil {
			matches = append(matches, t)
		}
	}

	c.JSON(http.StatusOK, TagValidateResponse{
		Valid:   len(matches) > 0,
		Matches: matches,
	})
}

// handleCreateTag godoc
// @Summary      Create a new tag (Admin only)
// @Tags         tags
// @Accept       json
// @Produce      json
// @Param        body  body  TagCreate  true  "Tag data"
// @Success      201  {object}  Tag
// @Security     BearerAuth
// @Router       /tags/ [post]
func handleCreateTag(c *gin.Context) {
	auth := GetAuth(c)
	var body TagCreate
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": err.Error()})
		return
	}

	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	// Category whitelist
	if !ValidCategories[body.Category] {
		send400(c, "Invalid category")
		return
	}

	// Check if exact category/name match exists (Idempotent for users)
	existingByName, _ := client.Collection(TAGS_COLLECTION).
		Where("category", "==", body.Category).
		Where("name", "==", body.Name).
		Limit(1).Documents(c.Request.Context()).GetAll()
	if len(existingByName) > 0 {
		t, _ := docToTag(existingByName[0])
		c.JSON(http.StatusOK, t)
		return
	}

	status := "pending"
	var suggestedBy *string
	if IsAdmin(auth.Role) {
		status = "active"
	} else {
		suggestedBy = &auth.UID
	}

	slug := body.Slug
	if slug == "" || !IsAdmin(auth.Role) {
		generated, err := generateSlugWithUniqueness(c.Request.Context(), client, body.Category, body.Name)
		if err != nil {
			send500(c, "Failed to generate unique slug")
			return
		}
		slug = generated
	} else if !isValidSlug(slug) {
		send400(c, "Invalid slug format (expected category__name)")
		return
	}

	// Final slug uniqueness check (if manually provided)
	if IsAdmin(auth.Role) && body.Slug != "" {
		existing, _ := client.Collection(TAGS_COLLECTION).Where("slug", "==", slug).Documents(c.Request.Context()).GetAll()
		if len(existing) > 0 {
			send400(c, "Tag with this slug already exists")
			return
		}
	}

	// MultiSelect consistency
	multiSelect := true
	if body.MultiSelect != nil {
		multiSelect = *body.MultiSelect
	} else {
		existingInCat, _ := client.Collection(TAGS_COLLECTION).Where("category", "==", body.Category).Limit(1).Documents(c.Request.Context()).GetAll()
		if len(existingInCat) > 0 {
			if t, err := docToTag(existingInCat[0]); err == nil {
				multiSelect = t.MultiSelect
			}
		}
	}

	id := uuid.New().String()
	data := map[string]interface{}{
		"category":     body.Category,
		"name":         body.Name,
		"name_lower":   strings.ToLower(body.Name),
		"slug":         slug,
		"multi_select": multiSelect,
		"status":       status,
		"created_at":   firestore.ServerTimestamp,
		"updated_at":   firestore.ServerTimestamp,
	}
	if suggestedBy != nil {
		data["suggested_by"] = *suggestedBy
	}

	ref := client.Collection(TAGS_COLLECTION).Doc(id)
	if _, err := ref.Set(c.Request.Context(), data); err != nil {
		send500(c, "Failed to create tag")
		return
	}

	doc, err := ref.Get(c.Request.Context())
	if err != nil {
		send500(c, "Failed to refetch created tag")
		return
	}
	t, err := docToTag(doc)
	if err != nil {
		send500(c, err.Error())
		return
	}
	c.JSON(http.StatusCreated, t)
}

// handleUpdateTag godoc
// @Summary      Update a tag (Admin only)
// @Tags         tags
// @Param        id    path  string     true  "Tag ID"
// @Param        body  body  TagUpdate  true  "Fields to update"
// @Success      200  {object}  Tag
// @Security     BearerAuth
// @Router       /tags/{id} [put]
func handleUpdateTag(c *gin.Context) {
	id := c.Param("id")
	auth := GetAuth(c)
	if !IsAdmin(auth.Role) {
		send403(c, "Admin or Root Admin authorization required")
		return
	}

	var body TagUpdate
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": err.Error()})
		return
	}

	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	ref := client.Collection(TAGS_COLLECTION).Doc(id)
	doc, err := ref.Get(c.Request.Context())
	if err != nil || !doc.Exists() {
		send404(c, "Tag not found")
		return
	}

	updates := make([]firestore.Update, 0)
	if body.Category != nil {
		if !ValidCategories[*body.Category] {
			send400(c, "Invalid category")
			return
		}
		updates = append(updates, firestore.Update{Path: "category", Value: *body.Category})
	}
	if body.Name != nil {
		updates = append(updates, firestore.Update{Path: "name", Value: *body.Name})
		updates = append(updates, firestore.Update{Path: "name_lower", Value: strings.ToLower(*body.Name)})
	}
	if body.Slug != nil {
		if !isValidSlug(*body.Slug) {
			send400(c, "Invalid slug format (expected category__name)")
			return
		}
		// Slug uniqueness check
		existing, _ := client.Collection(TAGS_COLLECTION).Where("slug", "==", *body.Slug).Documents(c.Request.Context()).GetAll()
		for _, e := range existing {
			if e.ID() != id {
				send400(c, "Tag with this slug already exists")
				return
			}
		}
		updates = append(updates, firestore.Update{Path: "slug", Value: *body.Slug})
	}
	if body.MultiSelect != nil {
		updates = append(updates, firestore.Update{Path: "multi_select", Value: *body.MultiSelect})
	}
	if body.Status != nil {
		updates = append(updates, firestore.Update{Path: "status", Value: *body.Status})
	}

	if len(updates) > 0 {
		updates = append(updates, firestore.Update{Path: "updated_at", Value: firestore.ServerTimestamp})
		if _, err := ref.Update(c.Request.Context(), updates); err != nil {
			send500(c, "Failed to update tag")
			return
		}
	}

	newDoc, err := ref.Get(c.Request.Context())
	if err != nil {
		send500(c, "Failed to refetch updated tag")
		return
	}
	t, err := docToTag(newDoc)
	if err != nil {
		send500(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, t)
}

// handleDeleteTag godoc
// @Summary      Delete a tag (Admin only)
// @Tags         tags
// @Param        id  path  string  true  "Tag ID"
// @Success      204  "No Content"
// @Security     BearerAuth
// @Router       /tags/{id} [delete]
func handleDeleteTag(c *gin.Context) {
	id := c.Param("id")
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

	ref := client.Collection(TAGS_COLLECTION).Doc(id)
	doc, err := ref.Get(c.Request.Context())
	if err != nil || !doc.Exists() {
		send404(c, "Tag not found")
		return
	}

	if _, err := ref.Delete(c.Request.Context()); err != nil {
		send500(c, "Failed to delete tag")
		return
	}
	c.Status(http.StatusNoContent)
}

// Helper: docToTag
func docToTag(doc DocumentSnapshot) (Tag, error) {
	d := doc.Data()
	if d == nil {
		return Tag{}, fmt.Errorf("Tag document %s empty", doc.ID())
	}

	reqStr := func(key string) string {
		if val, ok := d[key].(string); ok {
			return val
		}
		return ""
	}

	reqBool := func(key string) bool {
		if val, ok := d[key].(bool); ok {
			return val
		}
		return false
	}

	getTimestamp := func(key string) *time.Time {
		if val, ok := d[key].(time.Time); ok {
			return &val
		}
		return nil
	}

	return Tag{
		ID:          doc.ID(),
		Category:    reqStr("category"),
		Name:        reqStr("name"),
		Slug:        reqStr("slug"),
		MultiSelect: reqBool("multi_select"),
		Status:      reqStr("status"),
		SuggestedBy: func() *string {
			if s, ok := d["suggested_by"].(string); ok {
				return &s
			}
			return nil
		}(),
		CreatedAt: getTimestamp("created_at"),
		UpdatedAt: getTimestamp("updated_at"),
	}, nil
}

func handleListPendingTags(c *gin.Context) {
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

	docs, err := client.Collection(TAGS_COLLECTION).Where("status", "==", "pending").OrderBy("created_at", firestore.Desc).Documents(c.Request.Context()).GetAll()
	if err != nil {
		send500(c, "Failed to list pending tags")
		return
	}

	results := make([]Tag, 0)
	for _, doc := range docs {
		t, err := docToTag(doc)
		if err == nil {
			results = append(results, t)
		}
	}
	c.JSON(http.StatusOK, results)
}

// validateProfileTags enforces existence and multi_select constraints
func validateProfileTags(ctx context.Context, client FirestoreClient, tags []ProfileTag) error {
	if len(tags) == 0 {
		return nil
	}

	// 1. Batch fetch all referenced tags to check existence and multi_select
	tagIDs := make([]string, len(tags))
	for i, t := range tags {
		tagIDs[i] = t.ID
	}

	// Firestore client doesn't have a direct BatchGet for interfaces in this project,
	// but we can look them up. For simplicity and since tags are few, we'll do individual Gets or a query.
	// Implementation plan suggested batch-fetch.
	
	validTags := make(map[string]Tag)
	for _, id := range tagIDs {
		doc, err := client.Collection(TAGS_COLLECTION).Doc(id).Get(ctx)
		if err != nil || !doc.Exists() {
			return fmt.Errorf("Tag %s does not exist", id)
		}
		t, err := docToTag(doc)
		if err != nil {
			return fmt.Errorf("Tag %s is malformed", id)
		}
		validTags[id] = t
	}

	// 2. Check multi_select constraints
	categoryCounts := make(map[string]int)
	for _, t := range tags {
		vt := validTags[t.ID]
		categoryCounts[vt.Category]++
		if !vt.MultiSelect && categoryCounts[vt.Category] > 1 {
			return fmt.Errorf("Category %s only allows one tag", vt.Category)
		}
		// Also verify denormalized data matches source of truth
		// NOTE: Status is checked during creation/attachment, but here we just verify consistency.
		if t.Category != vt.Category || t.Name != vt.Name || t.Slug != vt.Slug || t.Status != vt.Status {
			return fmt.Errorf("Tag %s denormalized data mismatch", t.ID)
		}
	}

	return nil
}
