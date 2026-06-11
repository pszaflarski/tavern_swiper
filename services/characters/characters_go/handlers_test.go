package main

import (
	"bytes"
	"context"
	"encoding/json"
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

	r.Use(AuthMiddleware())

	r.GET("/characters/health", handleHealth)
	
	cGroup := r.Group("/characters")
	{
		cGroup.GET("/", handleListAllCharacters)
		cGroup.GET("/random", handleGetRandomCharacter)
		cGroup.POST("/validate", handleValidateProfile)
		cGroup.GET("/:id", handleGetCharacter)

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
			tGroup.GET("/:id", handleGetTag)
			tGroup.POST("/", handleCreateTag)
			tGroup.PUT("/:id", handleUpdateTag)
			tGroup.DELETE("/:id", handleDeleteTag)
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
		"category":     tagOut.Category,
		"name":         tagOut.Name,
		"name_lower":   "the witcher",
		"slug":         tagOut.Slug,
		"multi_select": true,
		"status":       "active",
	})

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

	// Manually set character in mockDB
	mockDB.Collection(CHARACTERS_COLLECTION).Doc(charOut.CharacterID).Set(context.Background(), map[string]interface{}{
		"display_name": charOut.DisplayName,
		"tagline":      *charOut.Tagline,
		"bio":          *charOut.Bio,
		"fandom": []interface{}{
			map[string]interface{}{
				"id":       charOut.Fandom[0].ID,
				"category": charOut.Fandom[0].Category,
				"name":     charOut.Fandom[0].Name,
				"slug":     charOut.Fandom[0].Slug,
			},
		},
		"image_ids":  []interface{}{},
		"created_at": time.Now(),
		"updated_at": time.Now(),
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
				"category":     "fandom",
				"name":         "The Witcher 3",
				"slug":         "fandom__the_witcher_3",
				"multi_select": true,
				"status":       "active",
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

func TestValidateProfile(t *testing.T) {
	r := setupTestEngine()
	adminToken := signGoTestToken("admin-123", "admin")

	mockDB := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mockDB, nil
	}

	// 1. Setup mock character
	mockDB.Collection(CHARACTERS_COLLECTION).(*mockCollection).queryRes = []*mockSnap{
		{
			id:     "char-1",
			exists: true,
			data: map[string]interface{}{
				"display_name": "Geralt of Rivia",
				"tagline":      "The White Wolf",
				"bio":          "Mutated monster hunter.",
			},
		},
	}

	// 2. Test successful match
	validReq := ProfileValidationRequest{
		DisplayName: "Geralt of Rivia",
		Tagline:     ptrStr("The White Wolf"),
		Bio:         ptrStr("Mutated monster hunter."),
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

	// 3. Test failure (modified bio)
	invalidReq := ProfileValidationRequest{
		DisplayName: "Geralt of Rivia",
		Tagline:     ptrStr("The White Wolf"),
		Bio:         ptrStr("Just a normal human."),
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
}
