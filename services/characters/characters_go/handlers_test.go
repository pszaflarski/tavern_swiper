package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
)

func ptrStr(s string) *string { return &s }
func ptrBool(b bool) *bool   { return &b }
func ptrInt(i int) *int      { return &i }

func signGoTestToken(uid string, role string) string {
	now := time.Now()
	claims := jwt.MapClaims{
		"sub":  uid,
		"role": role,
		"iat":  now.Unix(),
		"exp":  now.Add(30 * time.Minute).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := token.SignedString(jwtSecret)
	return s
}

func setupTestEngine() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.Default()

	r.GET("/characters/health", handleHealth)

	r.Use(AuthMiddleware())
	
	cGroup := r.Group("/characters")
	{
		cGroup.GET("/", handleListAllCharacters)
		cGroup.GET("/random", handleGetRandomCharacter)
		cGroup.POST("/validate", handleValidateProfile)
		cGroup.GET("/:id", handleGetCharacter)
		cGroup.POST("/generate", handleGenerateCharacterDetails)
		cGroup.POST("/:id/generate-image", handleGenerateCharacterImage)
		cGroup.POST("/:id/adopt", handleAdoptCharacter)

		cGroup.POST("/", handleCreateCharacter)
		cGroup.PUT("/:id", handleUpdateCharacter)
		cGroup.DELETE("/:id", handleDeleteCharacter)

		cGroup.POST("/images", handleUploadImage)
		cGroup.PUT("/images/:id", handleUpdateImage)
		cGroup.DELETE("/images/:id", handleDeleteImage)
		cGroup.GET("/images/by-artist/:handle", handleListImagesByArtist)

		tGroup := cGroup.Group("/tags")
		{
			tGroup.POST("/search", handleSearchTags)
			tGroup.GET("/by-slug/:slug", handleGetTagBySlug)
			tGroup.GET("/by-category/:category", handleListTagsByCategory)

			tGroup.GET("/roots", handleListRootTags)

			tGroup.GET("/:id", handleGetTag)
			tGroup.POST("/", handleCreateTag)
			tGroup.PUT("/:id", handleUpdateTag)
			tGroup.DELETE("/:id", handleDeleteTag)

			tGroup.GET("/:id/children", handleListChildren)
			tGroup.GET("/:id/ancestors", handleListAncestors)
			tGroup.GET("/:id/tree", handleGetSubtree)
		}
	}
	return r
}

func TestHealthCheck(t *testing.T) {
	r := setupTestEngine()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/characters/health", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var body map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	assert.Equal(t, "healthy", body["status"])
}

func TestCreateCharacterAccessControl(t *testing.T) {
	r := setupTestEngine()

	// 1. Unauthenticated
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/characters/", bytes.NewReader([]byte("{}")))
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusUnauthorized, w.Code)

	// 2. Regular User (Not Admin)
	userToken := signGoTestToken("user-123", "user")
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("POST", "/characters/", bytes.NewReader([]byte("{}")))
	req.Header.Set("Authorization", "Bearer "+userToken)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestCreateAndGetCharacter(t *testing.T) {
	r := setupTestEngine()
	adminToken := signGoTestToken("admin-123", "admin")

	// Set up mock client
	mockDB := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mockDB, nil
	}

	// 1. Create character tags first (so they pass validation)
	tag1Data := TagCreate{
		Category: "fandom",
		Name:     "The Witcher",
	}
	tag1Body, _ := json.Marshal(tag1Data)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/characters/tags/", bytes.NewReader(tag1Body))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusCreated, w.Code)

	var tagOut Tag
	_ = json.Unmarshal(w.Body.Bytes(), &tagOut)
	assert.Equal(t, "The Witcher", tagOut.Name)
	assert.Equal(t, "fandom__the_witcher", tagOut.Slug)

	// Add tag to mock database manually since mock Set doesn't fully persist to collection maps in this simplified mock
	mockDB.Collection(TAGS_COLLECTION).Doc(tagOut.ID).Set(context.Background(), map[string]interface{}{
		"category":      tagOut.Category,
		"name":          tagOut.Name,
		"name_lower":    "the witcher",
		"slug":          tagOut.Slug,
		"multi_select":  true,
		"status":        "active",
		"display_order": 0,
	})
	// Set queryRes so slug "in" queries used by resolveSlugsToCharTags return this tag
	mockDB.Collection(TAGS_COLLECTION).(*mockCollection).queryRes = []*mockSnap{
		{
			id:     tagOut.ID,
			exists: true,
			data: map[string]interface{}{
				"category":      tagOut.Category,
				"name":          tagOut.Name,
				"name_lower":    "the witcher",
				"slug":          tagOut.Slug,
				"multi_select":  true,
				"status":        "active",
				"display_order": 0,
			},
		},
	}

	// 2. Create Character
	charData := CharacterCreate{
		DisplayName: "Geralt of Rivia",
		Tagline:     ptrStr("The White Wolf"),
		Bio:         ptrStr("Mutated monster hunter."),
		Fandom: []CharTag{
			{
				ID:       tagOut.ID,
				Category: tagOut.Category,
				Name:     tagOut.Name,
				Slug:     tagOut.Slug,
			},
		},
		ImageIDs: []string{},
	}
	charBody, _ := json.Marshal(charData)
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("POST", "/characters/", bytes.NewReader(charBody))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)
	var charOut CharacterOut
	_ = json.Unmarshal(w.Body.Bytes(), &charOut)
	assert.Equal(t, "Geralt of Rivia", charOut.DisplayName)
	assert.Equal(t, "The White Wolf", *charOut.Tagline)
	assert.Equal(t, 1, len(charOut.Fandom))
	assert.Equal(t, "The Witcher", charOut.Fandom[0].Name)

	// Manually set character in mockDB with new character_tags format
	mockDB.Collection(CHARACTERS_COLLECTION).Doc(charOut.CharacterID).Set(context.Background(), map[string]interface{}{
		"display_name":   charOut.DisplayName,
		"tagline":        *charOut.Tagline,
		"bio":            *charOut.Bio,
		"character_tags": []interface{}{"fandom__the_witcher"},
		"image_ids":      []interface{}{},
		"created_at":     time.Now(),
		"updated_at":     time.Now(),
	})

	// 3. Get Character
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", "/characters/"+charOut.CharacterID, nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var getOut CharacterOut
	_ = json.Unmarshal(w.Body.Bytes(), &getOut)
	assert.Equal(t, charOut.CharacterID, getOut.CharacterID)
	assert.Equal(t, "Geralt of Rivia", getOut.DisplayName)
}

func TestSearchTags(t *testing.T) {
	r := setupTestEngine()
	adminToken := signGoTestToken("admin-123", "admin")

	mockDB := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mockDB, nil
	}

	// Mock queries by returning preset documents
	mockDB.Collection(TAGS_COLLECTION).(*mockCollection).queryRes = []*mockSnap{
		{
			id:     "tag-1",
			exists: true,
			data: map[string]interface{}{
				"category":      "fandom",
				"name":          "The Witcher 3",
				"slug":          "fandom__the_witcher_3",
				"multi_select":  true,
				"status":        "active",
				"display_order": 0,
			},
		},
	}

	searchQuery := TagSearchQuery{
		Category: "fandom",
		Name:     "witcher",
	}
	body, _ := json.Marshal(searchQuery)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/characters/tags/search", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var tags []Tag
	_ = json.Unmarshal(w.Body.Bytes(), &tags)
	assert.Equal(t, 1, len(tags))
	assert.Equal(t, "The Witcher 3", tags[0].Name)
}

func TestCreateTagWithParent(t *testing.T) {
	r := setupTestEngine()
	adminToken := signGoTestToken("admin-123", "admin")

	mockDB := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mockDB, nil
	}

	// 1. Create a root fandom tag
	rootData := TagCreate{
		Category: "fandom",
		Name:     "D&D",
	}
	rootBody, _ := json.Marshal(rootData)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/characters/tags/", bytes.NewReader(rootBody))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusCreated, w.Code)

	var rootTag Tag
	_ = json.Unmarshal(w.Body.Bytes(), &rootTag)
	assert.Equal(t, "D&D", rootTag.Name)
	assert.Equal(t, "fandom", rootTag.Category)
	assert.Nil(t, rootTag.ParentID) // Root tag has no parent

	// Persist root to mock
	mockDB.Collection(TAGS_COLLECTION).Doc(rootTag.ID).Set(context.Background(), map[string]interface{}{
		"category":      "fandom",
		"name":          "D&D",
		"name_lower":    "d&d",
		"slug":          rootTag.Slug,
		"multi_select":  true,
		"status":        "active",
		"display_order": 0,
	})

	// 2. Create a child tag with parent_id
	childData := TagCreate{
		Category: "class",
		Name:     "Paladin",
		ParentID: &rootTag.ID,
	}
	childBody, _ := json.Marshal(childData)
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("POST", "/characters/tags/", bytes.NewReader(childBody))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusCreated, w.Code)

	var childTag Tag
	_ = json.Unmarshal(w.Body.Bytes(), &childTag)
	assert.Equal(t, "Paladin", childTag.Name)
	assert.Equal(t, "class", childTag.Category)
	assert.NotNil(t, childTag.ParentID)
	assert.Equal(t, rootTag.ID, *childTag.ParentID)
}

func TestCreateTagWithInvalidParent(t *testing.T) {
	r := setupTestEngine()
	adminToken := signGoTestToken("admin-123", "admin")

	mockDB := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mockDB, nil
	}

	nonExistentID := "nonexistent-parent-id"
	childData := TagCreate{
		Category: "class",
		Name:     "Wizard",
		ParentID: &nonExistentID,
	}
	childBody, _ := json.Marshal(childData)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/characters/tags/", bytes.NewReader(childBody))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	var errBody map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &errBody)
	assert.Contains(t, errBody["detail"], "Parent tag does not exist")
}

func TestListRootTags(t *testing.T) {
	r := setupTestEngine()
	adminToken := signGoTestToken("admin-123", "admin")

	mockDB := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mockDB, nil
	}

	// Set up mock with a mix of root and child tags
	mockDB.Collection(TAGS_COLLECTION).(*mockCollection).queryRes = []*mockSnap{
		{
			id:     "tag-dnd",
			exists: true,
			data: map[string]interface{}{
				"category":      "fandom",
				"name":          "D&D",
				"slug":          "fandom__dnd",
				"multi_select":  true,
				"status":        "active",
				"display_order": 0,
				// No parent_id — root tag
			},
		},
		{
			id:     "tag-genshin",
			exists: true,
			data: map[string]interface{}{
				"category":      "fandom",
				"name":          "Genshin Impact",
				"slug":          "fandom__genshin_impact",
				"multi_select":  true,
				"status":        "active",
				"display_order": 1,
			},
		},
		{
			id:     "tag-paladin",
			exists: true,
			data: map[string]interface{}{
				"category":      "class",
				"name":          "Paladin",
				"slug":          "class__paladin",
				"multi_select":  false,
				"status":        "active",
				"parent_id":     "tag-dnd",
				"display_order": 0,
			},
		},
	}

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/characters/tags/roots", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var roots []TagTreeNode
	_ = json.Unmarshal(w.Body.Bytes(), &roots)
	assert.Equal(t, 2, len(roots))

	// Verify roots are only the ones without parent_id
	for _, root := range roots {
		assert.True(t, root.IsRoot)
		assert.Nil(t, root.ParentID)
	}

	// D&D should show 1 child (Paladin)
	var dnd *TagTreeNode
	for i := range roots {
		if roots[i].Name == "D&D" {
			dnd = &roots[i]
			break
		}
	}
	assert.NotNil(t, dnd)
	assert.Equal(t, 1, dnd.ChildCount)
}

func TestListChildren(t *testing.T) {
	r := setupTestEngine()
	adminToken := signGoTestToken("admin-123", "admin")

	mockDB := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mockDB, nil
	}

	// Set up parent tag document
	parentID := "tag-dnd"
	mockDB.Collection(TAGS_COLLECTION).Doc(parentID).Set(context.Background(), map[string]interface{}{
		"category":      "fandom",
		"name":          "D&D",
		"slug":          "fandom__dnd",
		"multi_select":  true,
		"status":        "active",
		"display_order": 0,
	})

	// Set up children as query results for parent_id == parentID
	mockDB.Collection(TAGS_COLLECTION).(*mockCollection).queryRes = []*mockSnap{
		{
			id:     "tag-paladin",
			exists: true,
			data: map[string]interface{}{
				"category":      "class",
				"name":          "Paladin",
				"slug":          "class__paladin",
				"multi_select":  false,
				"status":        "active",
				"parent_id":     parentID,
				"display_order": 0,
			},
		},
		{
			id:     "tag-elf",
			exists: true,
			data: map[string]interface{}{
				"category":      "race",
				"name":          "Elf",
				"slug":          "race__elf",
				"multi_select":  false,
				"status":        "active",
				"parent_id":     parentID,
				"display_order": 1,
			},
		},
	}

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/characters/tags/"+parentID+"/children", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var children []TagTreeNode
	_ = json.Unmarshal(w.Body.Bytes(), &children)
	assert.Equal(t, 2, len(children))

	// Verify all children point to parent
	for _, child := range children {
		assert.NotNil(t, child.ParentID)
		assert.Equal(t, parentID, *child.ParentID)
		assert.False(t, child.IsRoot)
	}
}

func TestListAncestors(t *testing.T) {
	r := setupTestEngine()
	adminToken := signGoTestToken("admin-123", "admin")

	mockDB := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mockDB, nil
	}

	// Set up a 3-level chain: fandom -> faction -> subfaction
	rootID := "tag-wh"
	factionID := "tag-sm"
	subfactionID := "tag-ba"

	mockDB.Collection(TAGS_COLLECTION).Doc(rootID).Set(context.Background(), map[string]interface{}{
		"category":      "fandom",
		"name":          "Warhammer",
		"slug":          "fandom__warhammer",
		"multi_select":  true,
		"status":        "active",
		"display_order": 0,
	})

	mockDB.Collection(TAGS_COLLECTION).Doc(factionID).Set(context.Background(), map[string]interface{}{
		"category":      "faction",
		"name":          "Space Marines",
		"slug":          "faction__space_marines",
		"multi_select":  false,
		"status":        "active",
		"parent_id":     rootID,
		"display_order": 0,
	})

	mockDB.Collection(TAGS_COLLECTION).Doc(subfactionID).Set(context.Background(), map[string]interface{}{
		"category":      "subfaction",
		"name":          "Blood Angels",
		"slug":          "subfaction__blood_angels",
		"multi_select":  false,
		"status":        "active",
		"parent_id":     factionID,
		"display_order": 0,
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/characters/tags/"+subfactionID+"/ancestors", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var ancestors []Tag
	_ = json.Unmarshal(w.Body.Bytes(), &ancestors)
	assert.Equal(t, 3, len(ancestors))

	// Verify order: root first, then faction, then subfaction
	assert.Equal(t, "Warhammer", ancestors[0].Name)
	assert.Equal(t, "Space Marines", ancestors[1].Name)
	assert.Equal(t, "Blood Angels", ancestors[2].Name)
}

func TestDeleteTagWithChildren(t *testing.T) {
	r := setupTestEngine()
	adminToken := signGoTestToken("admin-123", "admin")

	mockDB := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mockDB, nil
	}

	parentID := "tag-dnd"
	mockDB.Collection(TAGS_COLLECTION).Doc(parentID).Set(context.Background(), map[string]interface{}{
		"category":      "fandom",
		"name":          "D&D",
		"slug":          "fandom__dnd",
		"multi_select":  true,
		"status":        "active",
		"display_order": 0,
	})

	// Mock query results to simulate children existing
	mockDB.Collection(TAGS_COLLECTION).(*mockCollection).queryRes = []*mockSnap{
		{
			id:     "tag-paladin",
			exists: true,
			data: map[string]interface{}{
				"category":      "class",
				"name":          "Paladin",
				"slug":          "class__paladin",
				"parent_id":     parentID,
				"display_order": 0,
			},
		},
	}

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("DELETE", "/characters/tags/"+parentID, nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	var errBody map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &errBody)
	assert.Contains(t, errBody["detail"], "child tags")
}

func TestDeleteLeafTag(t *testing.T) {
	r := setupTestEngine()
	adminToken := signGoTestToken("admin-123", "admin")

	mockDB := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mockDB, nil
	}

	leafID := "tag-paladin"
	mockDB.Collection(TAGS_COLLECTION).Doc(leafID).Set(context.Background(), map[string]interface{}{
		"category":      "class",
		"name":          "Paladin",
		"slug":          "class__paladin",
		"multi_select":  false,
		"status":        "active",
		"parent_id":     "tag-dnd",
		"display_order": 0,
	})

	// Mock: no children (empty query results)
	mockDB.Collection(TAGS_COLLECTION).(*mockCollection).queryRes = []*mockSnap{}

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("DELETE", "/characters/tags/"+leafID, nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNoContent, w.Code)
}

func TestTagDisplayOrder(t *testing.T) {
	r := setupTestEngine()
	adminToken := signGoTestToken("admin-123", "admin")

	mockDB := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mockDB, nil
	}

	tagData := TagCreate{
		Category:     "class",
		Name:         "Fighter",
		DisplayOrder: ptrInt(5),
	}
	tagBody, _ := json.Marshal(tagData)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/characters/tags/", bytes.NewReader(tagBody))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)

	var tag Tag
	_ = json.Unmarshal(w.Body.Bytes(), &tag)
	assert.Equal(t, 5, tag.DisplayOrder)
	assert.Equal(t, "Fighter", tag.Name)
}

func TestValidateProfile(t *testing.T) {
	r := setupTestEngine()
	adminToken := signGoTestToken("admin-123", "admin")

	mockDB := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mockDB, nil
	}

	// 1. Setup mock character and images
	mockDB.Collection(CHARACTERS_COLLECTION).(*mockCollection).queryRes = []*mockSnap{
		{
			id:     "char-1",
			exists: true,
			data: map[string]interface{}{
				"display_name": "Geralt of Rivia",
				"tagline":      "The White Wolf",
				"bio":          "Mutated monster hunter.",
				"image_ids":    []interface{}{"img-1"},
				"status":        "pending",
			},
		},
	}
	mockDB.Collection(IMAGES_COLLECTION).Doc("img-1").Set(context.Background(), map[string]interface{}{
		"url":          "https://example.com/geralt.jpg",
		"source_type":  "generated",
		"character_id": "char-1",
		"position":     0,
	})

	// 2. Test successful match
	validReq := ProfileValidationRequest{
		DisplayName: "Geralt of Rivia",
		Tagline:     ptrStr("The White Wolf"),
		Bio:         ptrStr("Mutated monster hunter."),
		ImageURLs:   []string{"https://example.com/geralt.jpg"},
	}
	body, _ := json.Marshal(validReq)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/characters/validate", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp ValidationResponse
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.True(t, resp.IsGenerated)
	assert.Equal(t, "pending", resp.Status)

	// 3. Test failure (modified bio)
	invalidReq := ProfileValidationRequest{
		DisplayName: "Geralt of Rivia",
		Tagline:     ptrStr("The White Wolf"),
		Bio:         ptrStr("Just a normal human."),
		ImageURLs:   []string{"https://example.com/geralt.jpg"},
	}
	body2, _ := json.Marshal(invalidReq)
	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest("POST", "/characters/validate", bytes.NewReader(body2))
	req2.Header.Set("Authorization", "Bearer "+adminToken)
	r.ServeHTTP(w2, req2)

	assert.Equal(t, http.StatusOK, w2.Code)
	var resp2 ValidationResponse
	_ = json.Unmarshal(w2.Body.Bytes(), &resp2)
	assert.False(t, resp2.IsGenerated)

	// 4. Test failure (modified images)
	invalidImgReq := ProfileValidationRequest{
		DisplayName: "Geralt of Rivia",
		Tagline:     ptrStr("The White Wolf"),
		Bio:         ptrStr("Mutated monster hunter."),
		ImageURLs:   []string{"https://example.com/hacked.jpg"},
	}
	body3, _ := json.Marshal(invalidImgReq)
	w3 := httptest.NewRecorder()
	req3, _ := http.NewRequest("POST", "/characters/validate", bytes.NewReader(body3))
	req3.Header.Set("Authorization", "Bearer "+adminToken)
	r.ServeHTTP(w3, req3)

	assert.Equal(t, http.StatusOK, w3.Code)
	var resp3 ValidationResponse
	_ = json.Unmarshal(w3.Body.Bytes(), &resp3)
	assert.False(t, resp3.IsGenerated)
}

func TestCharacterGenerationAndAdoption(t *testing.T) {
	r := setupTestEngine()
	userToken := signGoTestToken("user-123", "user")

	mockDB := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mockDB, nil
	}

	// 1. Stub the tag documents in the database
	mockDB.Collection(TAGS_COLLECTION).Doc("tag-witcher").Set(context.Background(), map[string]interface{}{
		"category":      "fandom",
		"name":          "The Witcher",
		"slug":          "fandom__the_witcher",
		"multi_select":  true,
		"status":        "active",
		"display_order": 0,
	})
	mockDB.Collection(TAGS_COLLECTION).Doc("tag-elf").Set(context.Background(), map[string]interface{}{
		"category":      "race",
		"name":          "Elf",
		"slug":          "race__elf",
		"multi_select":  true,
		"status":        "active",
		"display_order": 0,
	})
	mockDB.Collection(TAGS_COLLECTION).Doc("tag-female").Set(context.Background(), map[string]interface{}{
		"category":      "gender",
		"name":          "Female",
		"slug":          "gender__female",
		"multi_select":  true,
		"status":        "active",
		"display_order": 0,
	})
	mockDB.Collection(TAGS_COLLECTION).Doc("tag-mage").Set(context.Background(), map[string]interface{}{
		"category":      "class",
		"name":          "Mage",
		"slug":          "class__mage",
		"multi_select":  true,
		"status":        "active",
		"display_order": 0,
	})
	// Set queryRes so slug "in" queries used by resolveSlugsToCharTags return all tags
	mockDB.Collection(TAGS_COLLECTION).(*mockCollection).queryRes = []*mockSnap{
		{id: "tag-witcher", exists: true, data: map[string]interface{}{
			"category": "fandom", "name": "The Witcher", "slug": "fandom__the_witcher",
			"multi_select": true, "status": "active", "display_order": 0,
		}},
		{id: "tag-elf", exists: true, data: map[string]interface{}{
			"category": "race", "name": "Elf", "slug": "race__elf",
			"multi_select": true, "status": "active", "display_order": 0,
		}},
		{id: "tag-female", exists: true, data: map[string]interface{}{
			"category": "gender", "name": "Female", "slug": "gender__female",
			"multi_select": true, "status": "active", "display_order": 0,
		}},
		{id: "tag-mage", exists: true, data: map[string]interface{}{
			"category": "class", "name": "Mage", "slug": "class__mage",
			"multi_select": true, "status": "active", "display_order": 0,
		}},
	}

	// 2. Setup mock agent router
	mockAgentRouter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/invoke" {
			resp := map[string]interface{}{
				"response": `{"name": "Yennefer", "tagline": "Magic is beauty", "bio": "A powerful sorceress.", "image_prompt": "Beautiful lady mage"}`,
			}
			json.NewEncoder(w).Encode(resp)
		} else if r.URL.Path == "/generate-image" {
			myImg := image.NewRGBA(image.Rect(0, 0, 1, 1))
			var buf bytes.Buffer
			_ = png.Encode(&buf, myImg)
			encoded := "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
			resp := map[string]interface{}{
				"image": encoded,
			}
			json.NewEncoder(w).Encode(resp)
		}
	}))
	defer mockAgentRouter.Close()

	// Update service URLs
	serviceURLs.mu.Lock()
	serviceURLs.urls["agent_router"] = mockAgentRouter.URL
	serviceURLs.mu.Unlock()

	// Mock GCS upload & delete functions
	oldUpload := uploadToGCS
	oldDeleteSingle := deleteSingleImageFunc
	defer func() {
		uploadToGCS = oldUpload
		deleteSingleImageFunc = oldDeleteSingle
	}()
	uploadToGCS = func(ctx context.Context, characterID string, filename string, contentType string, data io.Reader) (string, error) {
		return "https://storage.googleapis.com/mock-bucket/characters/" + characterID + "/" + filename, nil
	}
	deleteSingleImageFunc = func(ctx context.Context, characterID string, filename string) error {
		return nil
	}

	// A. Generate character details
	genReq := CharacterGenerateRequest{
		Fandom: []CharTag{{ID: "tag-witcher", Category: "fandom", Name: "The Witcher", Slug: "fandom__the_witcher"}},
		Race:   []CharTag{{ID: "tag-elf", Category: "race", Name: "Elf", Slug: "race__elf"}},
		Gender: []CharTag{{ID: "tag-female", Category: "gender", Name: "Female", Slug: "gender__female"}},
		Class:  []CharTag{{ID: "tag-mage", Category: "class", Name: "Mage", Slug: "class__mage"}},
	}
	genBody, _ := json.Marshal(genReq)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/characters/generate", bytes.NewReader(genBody))
	req.Header.Set("Authorization", "Bearer "+userToken)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var charOut CharacterOut
	err := json.Unmarshal(w.Body.Bytes(), &charOut)
	assert.NoError(t, err)
	assert.Equal(t, "Yennefer", charOut.DisplayName)
	assert.Equal(t, "Magic is beauty", *charOut.Tagline)
	assert.Equal(t, "A powerful sorceress.", *charOut.Bio)
	assert.Equal(t, "pending", charOut.Status)
	assert.Equal(t, 0, len(charOut.Images))

	// Verify image_prompt was NOT returned in JSON output
	var jsonMap map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &jsonMap)
	assert.Nil(t, jsonMap["image_prompt"])

	// Check Firestore stored state
	charDoc, err := mockDB.Collection(CHARACTERS_COLLECTION).Doc(charOut.CharacterID).Get(context.Background())
	assert.NoError(t, err)
	assert.True(t, charDoc.Exists())
	assert.Equal(t, "Beautiful lady mage", charDoc.Data()["image_prompt"])

	// B. Generate Image
	wGenImg := httptest.NewRecorder()
	reqGenImg, _ := http.NewRequest("POST", "/characters/"+charOut.CharacterID+"/generate-image", nil)
	reqGenImg.Header.Set("Authorization", "Bearer "+userToken)
	r.ServeHTTP(wGenImg, reqGenImg)

	assert.Equal(t, http.StatusOK, wGenImg.Code)
	var charOutWithImg CharacterOut
	err = json.Unmarshal(wGenImg.Body.Bytes(), &charOutWithImg)
	assert.NoError(t, err)
	assert.Equal(t, 1, len(charOutWithImg.Images))
	assert.Equal(t, "ai_generated", charOutWithImg.Images[0].SourceType)
	assert.Contains(t, charOutWithImg.Images[0].URL, charOut.CharacterID)

	// Check image document was created in mock DB
	imgDoc, err := mockDB.Collection(IMAGES_COLLECTION).Doc(charOutWithImg.Images[0].ImageID).Get(context.Background())
	assert.NoError(t, err)
	assert.True(t, imgDoc.Exists())
	assert.Equal(t, charOut.CharacterID, imgDoc.Data()["character_id"])

	// C. Adopt Character
	wAdopt := httptest.NewRecorder()
	reqAdopt, _ := http.NewRequest("POST", "/characters/"+charOut.CharacterID+"/adopt", nil)
	reqAdopt.Header.Set("Authorization", "Bearer "+userToken)
	r.ServeHTTP(wAdopt, reqAdopt)

	assert.Equal(t, http.StatusOK, wAdopt.Code)
	var adoptedChar CharacterOut
	err = json.Unmarshal(wAdopt.Body.Bytes(), &adoptedChar)
	assert.NoError(t, err)
	assert.Equal(t, "adopted", adoptedChar.Status)
}
