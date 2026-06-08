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

const TAGS_COLLECTION = "character_tags"

var slugPattern = regexp.MustCompile(`^[a-z0-9]+__[a-z0-9_]+$`)

func isValidSlug(slug string) bool {
	return slugPattern.MatchString(slug)
}

func generateSlugWithUniqueness(ctx context.Context, client FirestoreClient, category, name string) (string, error) {
	base := strings.ToLower(name)
	base = strings.ReplaceAll(base, " ", "_")
	reg, _ := regexp.Compile("[^a-z0-9_]+")
	base = reg.ReplaceAllString(base, "")
	
	baseSlug := fmt.Sprintf("%s__%s", category, base)
	
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
// @Summary      Get a character tag by ID
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
// @Summary      Get a character tag by slug
// @Tags         tags
// @Param        slug  path  string  true  "Tag Slug"
// @Success      200  {object}  Tag
// @Router       /tags/by-slug/{slug} [get]
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
// @Summary      List character tags in a category
// @Tags         tags
// @Param        category  path  string  true  "Category"
// @Success      200  {array}  Tag
// @Router       /tags/by-category/{category} [get]
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
// @Summary      Search character tags by category and name prefix
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

// handleListRootTags godoc
// @Summary      List root tags (no parent)
// @Description  Returns all tags where parent_id is null, ordered by display_order.
// @Tags         tags
// @Produce      json
// @Success      200  {array}  TagTreeNode
// @Router       /tags/roots [get]
func handleListRootTags(c *gin.Context) {
	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	// Fetch all tags and filter for roots (parent_id is null/missing)
	allDocs, err := client.Collection(TAGS_COLLECTION).Documents(c.Request.Context()).GetAll()
	if err != nil {
		send500(c, "Failed to list tags")
		return
	}

	// Build a map of parent_id -> child count
	childCounts := make(map[string]int)
	roots := make([]Tag, 0)
	for _, doc := range allDocs {
		t, err := docToTag(doc)
		if err != nil {
			continue
		}
		if t.ParentID != nil && *t.ParentID != "" {
			childCounts[*t.ParentID]++
		} else {
			roots = append(roots, t)
		}
	}

	// Build response with child counts
	results := make([]TagTreeNode, 0, len(roots))
	for _, t := range roots {
		results = append(results, TagTreeNode{
			Tag:        t,
			IsRoot:     true,
			ChildCount: childCounts[t.ID],
		})
	}

	c.JSON(http.StatusOK, results)
}

// handleListChildren godoc
// @Summary      List direct children of a tag
// @Description  Returns all tags whose parent_id matches the given tag ID. Optionally filter by category.
// @Tags         tags
// @Produce      json
// @Param        id        path   string  true   "Parent Tag ID"
// @Param        category  query  string  false  "Filter children by category"
// @Success      200  {array}  TagTreeNode
// @Router       /tags/{id}/children [get]
func handleListChildren(c *gin.Context) {
	parentID := c.Param("id")
	categoryFilter := c.Query("category")

	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	// Verify parent exists
	parentDoc, err := client.Collection(TAGS_COLLECTION).Doc(parentID).Get(c.Request.Context())
	if err != nil || !parentDoc.Exists() {
		send404(c, "Parent tag not found")
		return
	}

	// Fetch children: parent_id == parentID
	childDocs, err := client.Collection(TAGS_COLLECTION).Where("parent_id", "==", parentID).Documents(c.Request.Context()).GetAll()
	if err != nil {
		send500(c, "Failed to list children")
		return
	}

	// Also need grandchild counts: fetch all docs with parent_id in child IDs
	childIDs := make(map[string]bool)
	children := make([]Tag, 0)
	for _, doc := range childDocs {
		t, err := docToTag(doc)
		if err != nil {
			continue
		}
		childIDs[t.ID] = true
		if categoryFilter == "" || t.Category == categoryFilter {
			children = append(children, t)
		}
	}

	// Count grandchildren for each child
	grandchildCounts := make(map[string]int)
	if len(childIDs) > 0 {
		// Fetch all tags and count those whose parent_id is in childIDs
		allDocs, err := client.Collection(TAGS_COLLECTION).Documents(c.Request.Context()).GetAll()
		if err == nil {
			for _, doc := range allDocs {
				t, err := docToTag(doc)
				if err != nil {
					continue
				}
				if t.ParentID != nil && childIDs[*t.ParentID] {
					grandchildCounts[*t.ParentID]++
				}
			}
		}
	}

	results := make([]TagTreeNode, 0, len(children))
	for _, t := range children {
		results = append(results, TagTreeNode{
			Tag:        t,
			IsRoot:     false,
			ChildCount: grandchildCounts[t.ID],
		})
	}

	c.JSON(http.StatusOK, results)
}

// handleListAncestors godoc
// @Summary      List ancestors of a tag (root to tag path)
// @Description  Walks up the parent_id chain and returns the ordered path from root to the given tag.
// @Tags         tags
// @Produce      json
// @Param        id  path  string  true  "Tag ID"
// @Success      200  {array}  Tag
// @Router       /tags/{id}/ancestors [get]
func handleListAncestors(c *gin.Context) {
	tagID := c.Param("id")

	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	// Walk up the parent chain
	chain := make([]Tag, 0)
	visited := make(map[string]bool)
	currentID := tagID

	for {
		if visited[currentID] {
			// Circular reference detected — break to avoid infinite loop
			break
		}
		visited[currentID] = true

		doc, err := client.Collection(TAGS_COLLECTION).Doc(currentID).Get(c.Request.Context())
		if err != nil || !doc.Exists() {
			if currentID == tagID {
				send404(c, "Tag not found")
				return
			}
			break // Parent doesn't exist, stop walking
		}

		t, err := docToTag(doc)
		if err != nil {
			break
		}

		chain = append(chain, t)

		if t.ParentID == nil || *t.ParentID == "" {
			break // Reached root
		}
		currentID = *t.ParentID
	}

	// Reverse to get root-to-tag order
	for i, j := 0, len(chain)-1; i < j; i, j = i+1, j-1 {
		chain[i], chain[j] = chain[j], chain[i]
	}

	c.JSON(http.StatusOK, chain)
}

// handleGetSubtree godoc
// @Summary      Get full subtree rooted at a tag
// @Description  Returns the tag and all its descendants as a flat list with depth metadata.
// @Tags         tags
// @Produce      json
// @Param        id  path  string  true  "Root Tag ID"
// @Success      200  {array}  map[string]interface{}
// @Security     BearerAuth
// @Router       /tags/{id}/tree [get]
func handleGetSubtree(c *gin.Context) {
	rootID := c.Param("id")

	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	// Verify root exists
	rootDoc, err := client.Collection(TAGS_COLLECTION).Doc(rootID).Get(c.Request.Context())
	if err != nil || !rootDoc.Exists() {
		send404(c, "Tag not found")
		return
	}

	// Fetch all tags and build the tree in memory
	allDocs, err := client.Collection(TAGS_COLLECTION).Documents(c.Request.Context()).GetAll()
	if err != nil {
		send500(c, "Failed to fetch tags")
		return
	}

	// Build tag map and children map
	tagMap := make(map[string]Tag)
	childrenMap := make(map[string][]string) // parent_id -> []child_id
	for _, doc := range allDocs {
		t, err := docToTag(doc)
		if err != nil {
			continue
		}
		tagMap[t.ID] = t
		if t.ParentID != nil && *t.ParentID != "" {
			childrenMap[*t.ParentID] = append(childrenMap[*t.ParentID], t.ID)
		}
	}

	// BFS from root
	type tagWithDepth struct {
		Tag   Tag `json:"tag"`
		Depth int `json:"depth"`
	}

	results := make([]tagWithDepth, 0)
	type queueItem struct {
		id    string
		depth int
	}
	queue := []queueItem{{id: rootID, depth: 0}}

	visited := make(map[string]bool)
	for len(queue) > 0 {
		item := queue[0]
		queue = queue[1:]

		if visited[item.id] {
			continue
		}
		visited[item.id] = true

		if t, ok := tagMap[item.id]; ok {
			results = append(results, tagWithDepth{Tag: t, Depth: item.depth})
			for _, childID := range childrenMap[item.id] {
				queue = append(queue, queueItem{id: childID, depth: item.depth + 1})
			}
		}
	}

	c.JSON(http.StatusOK, results)
}

// handleCreateTag godoc
// @Summary      Create a new character tag (Admin only)
// @Tags         tags
// @Accept       json
// @Produce      json
// @Param        body  body  TagCreate  true  "Tag data"
// @Success      201  {object}  Tag
// @Security     BearerAuth
// @Router       /tags/ [post]
func handleCreateTag(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdmin(auth.Role) {
		send403(c, "Admin or Root Admin authorization required")
		return
	}

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

	// Validate parent exists if provided
	if body.ParentID != nil && *body.ParentID != "" {
		parentDoc, err := client.Collection(TAGS_COLLECTION).Doc(*body.ParentID).Get(c.Request.Context())
		if err != nil || !parentDoc.Exists() {
			send400(c, "Parent tag does not exist")
			return
		}
	}

	// Check if exact category/name match exists
	existingByName, _ := client.Collection(TAGS_COLLECTION).
		Where("category", "==", body.Category).
		Where("name", "==", body.Name).
		Limit(1).Documents(c.Request.Context()).GetAll()
	if len(existingByName) > 0 {
		t, _ := docToTag(existingByName[0])
		c.JSON(http.StatusOK, t)
		return
	}

	slug := body.Slug
	if slug == "" {
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

	// Final slug uniqueness check
	if body.Slug != "" {
		existing, _ := client.Collection(TAGS_COLLECTION).Where("slug", "==", slug).Documents(c.Request.Context()).GetAll()
		if len(existing) > 0 {
			send400(c, "Tag with this slug already exists")
			return
		}
	}

	multiSelect := true
	if body.MultiSelect != nil {
		multiSelect = *body.MultiSelect
	}

	displayOrder := 0
	if body.DisplayOrder != nil {
		displayOrder = *body.DisplayOrder
	}

	id := uuid.New().String()
	data := map[string]interface{}{
		"category":      body.Category,
		"name":          body.Name,
		"name_lower":    strings.ToLower(body.Name),
		"slug":          slug,
		"multi_select":  multiSelect,
		"status":        "active",
		"display_order": displayOrder,
		"created_at":    firestore.ServerTimestamp,
		"updated_at":    firestore.ServerTimestamp,
	}

	if body.ParentID != nil && *body.ParentID != "" {
		data["parent_id"] = *body.ParentID
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
// @Summary      Update a character tag (Admin only)
// @Tags         tags
// @Param        id    path  string     true  "Tag ID"
// @Param        body  body  TagUpdate  true  "Fields to update"
// @Success      200  {object}  Tag
// @Security     BearerAuth
// @Router       /tags/{id} [put]
func handleUpdateTag(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdmin(auth.Role) {
		send403(c, "Admin or Root Admin authorization required")
		return
	}

	id := c.Param("id")
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
	if body.ParentID != nil {
		if *body.ParentID == "" {
			// Setting parent to null (making it a root)
			updates = append(updates, firestore.Update{Path: "parent_id", Value: firestore.Delete})
		} else {
			// Validate new parent exists
			parentDoc, err := client.Collection(TAGS_COLLECTION).Doc(*body.ParentID).Get(c.Request.Context())
			if err != nil || !parentDoc.Exists() {
				send400(c, "Parent tag does not exist")
				return
			}
			// Prevent setting parent to self
			if *body.ParentID == id {
				send400(c, "A tag cannot be its own parent")
				return
			}
			// Prevent circular references: walk up from proposed parent
			// and ensure we don't find the current tag ID
			currentCheckID := *body.ParentID
			visited := make(map[string]bool)
			for {
				if visited[currentCheckID] {
					break
				}
				visited[currentCheckID] = true

				checkDoc, err := client.Collection(TAGS_COLLECTION).Doc(currentCheckID).Get(c.Request.Context())
				if err != nil || !checkDoc.Exists() {
					break
				}
				checkTag, err := docToTag(checkDoc)
				if err != nil {
					break
				}
				if checkTag.ParentID == nil || *checkTag.ParentID == "" {
					break // Reached root, no cycle
				}
				if *checkTag.ParentID == id {
					send400(c, "Setting this parent would create a circular reference")
					return
				}
				currentCheckID = *checkTag.ParentID
			}
			updates = append(updates, firestore.Update{Path: "parent_id", Value: *body.ParentID})
		}
	}
	if body.DisplayOrder != nil {
		updates = append(updates, firestore.Update{Path: "display_order", Value: *body.DisplayOrder})
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
// @Summary      Delete a character tag (Admin only)
// @Description  Deletes a tag. Blocked if the tag has children.
// @Tags         tags
// @Param        id  path  string  true  "Tag ID"
// @Success      204  "No Content"
// @Security     BearerAuth
// @Router       /tags/{id} [delete]
func handleDeleteTag(c *gin.Context) {
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

	ref := client.Collection(TAGS_COLLECTION).Doc(id)
	doc, err := ref.Get(c.Request.Context())
	if err != nil || !doc.Exists() {
		send404(c, "Tag not found")
		return
	}

	// Block deletion if children exist
	children, err := client.Collection(TAGS_COLLECTION).Where("parent_id", "==", id).Limit(1).Documents(c.Request.Context()).GetAll()
	if err == nil && len(children) > 0 {
		send400(c, "Cannot delete tag: it has child tags. Delete or re-parent children first.")
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

	getPtrStr := func(key string) *string {
		if val, ok := d[key].(string); ok && val != "" {
			return &val
		}
		return nil
	}

	getInt := func(key string) int {
		if val, ok := d[key].(int); ok {
			return val
		}
		if val, ok := d[key].(int64); ok {
			return int(val)
		}
		if val, ok := d[key].(float64); ok {
			return int(val)
		}
		return 0
	}

	return Tag{
		ID:           doc.ID(),
		Category:     reqStr("category"),
		Name:         reqStr("name"),
		Slug:         reqStr("slug"),
		MultiSelect:  reqBool("multi_select"),
		Status:       reqStr("status"),
		ParentID:     getPtrStr("parent_id"),
		DisplayOrder: getInt("display_order"),
		CreatedAt:    getTimestamp("created_at"),
		UpdatedAt:    getTimestamp("updated_at"),
	}, nil
}

// validateCharacterTags enforces existence constraints
func validateCharacterTags(ctx context.Context, client FirestoreClient, tags []CharTag) error {
	if len(tags) == 0 {
		return nil
	}

	categoryCounts := make(map[string]int)
	for _, t := range tags {
		doc, err := client.Collection(TAGS_COLLECTION).Doc(t.ID).Get(ctx)
		if err != nil || !doc.Exists() {
			return fmt.Errorf("Tag %s does not exist", t.ID)
		}
		vt, err := docToTag(doc)
		if err != nil {
			return fmt.Errorf("Tag %s is malformed", t.ID)
		}
		categoryCounts[vt.Category]++
		if !vt.MultiSelect && categoryCounts[vt.Category] > 1 {
			return fmt.Errorf("Category %s only allows one tag", vt.Category)
		}
		if t.Category != vt.Category || t.Name != vt.Name || t.Slug != vt.Slug {
			return fmt.Errorf("Tag %s denormalized data mismatch", t.ID)
		}
	}

	return nil
}
