package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestTagHandlers(t *testing.T) {
	// Mock _now to match test token generation
	fixedNow := time.Date(2026, 4, 17, 10, 0, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	mockPub := &mockPublisher{}
	r := setupTest(mockPub)
	
	// Override getDBFunc for tests
	oldGetDB := getDBFunc
	defer func() { getDBFunc = oldGetDB }()

	token := signGoTestToken("admin-uid", "admin")

	t.Run("CreateTag", func(t *testing.T) {
		mock := &mockClient{collections: make(map[string]*mockCollection)}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		body := TagCreate{
			Category:    "fandom",
			Name:        "Star Wars",
			Slug:        "fandom__star_wars",
			MultiSelect: ptrBool(true),
		}
		jsonBody, _ := json.Marshal(body)

		req, _ := http.NewRequest("POST", "/profiles/tags/", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusCreated, w.Code)
		var res Tag
		json.Unmarshal(w.Body.Bytes(), &res)
		assert.Equal(t, "Star Wars", res.Name)
	})

	t.Run("SearchTags", func(t *testing.T) {
		mock := &mockClient{collections: make(map[string]*mockCollection)}
		col := mock.Collection(TAGS_COLLECTION).(*mockCollection)
		col.queryRes = []*mockSnap{
			{id: "1", data: map[string]interface{}{"category": "fandom", "name": "Baldur's Gate", "slug": "fandom__bg3", "multi_select": true}, exists: true},
		}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		body := TagSearchQuery{
			Category: "fandom",
			Name:     "Ba",
		}
		jsonBody, _ := json.Marshal(body)

		req, _ := http.NewRequest("POST", "/profiles/tags/search", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		var res []Tag
		json.Unmarshal(w.Body.Bytes(), &res)
		assert.Len(t, res, 1)
		assert.Equal(t, "Baldur's Gate", res[0].Name)
	})

	t.Run("ValidateTags", func(t *testing.T) {
		mock := &mockClient{collections: make(map[string]*mockCollection)}
		col := mock.Collection(TAGS_COLLECTION).(*mockCollection)
		col.queryRes = []*mockSnap{
			{id: "1", data: map[string]interface{}{"category": "fandom", "name": "Star Wars", "slug": "fandom__star_wars", "multi_select": true}, exists: true},
		}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		body := TagValidateRequest{
			Category: ptrStr("fandom"),
			Name:     ptrStr("Star Wars"),
		}
		jsonBody, _ := json.Marshal(body)

		req, _ := http.NewRequest("POST", "/profiles/tags/validate", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		var res TagValidateResponse
		json.Unmarshal(w.Body.Bytes(), &res)
		assert.True(t, res.Valid)
	})
	t.Run("CreateTag_NonAdmin_CreatesPendingTag", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }
		userToken := signGoTestToken("user-123", "user")

		body := TagCreate{Category: "fandom", Name: "X"}
		jsonBody, _ := json.Marshal(body)

		req, _ := http.NewRequest("POST", "/profiles/tags/", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+userToken)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assert.Equal(t, http.StatusCreated, w.Code)
		var res Tag
		json.Unmarshal(w.Body.Bytes(), &res)
		assert.Equal(t, "pending", res.Status)
		assert.NotNil(t, res.SuggestedBy)
		assert.Equal(t, "user-123", *res.SuggestedBy)
	})

	t.Run("CreateTag_InvalidSlug_Returns400", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		body := TagCreate{Category: "fandom", Name: "X", Slug: "invalid-slug"}
		jsonBody, _ := json.Marshal(body)

		req, _ := http.NewRequest("POST", "/profiles/tags/", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("DeleteTag_NotFound_Returns404", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		req, _ := http.NewRequest("DELETE", "/profiles/tags/non-existent", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assert.Equal(t, http.StatusNotFound, w.Code)
	})

	t.Run("GetTag_MalformedDoc_DoesNotPanic", func(t *testing.T) {
		mock := &mockClient{collections: map[string]*mockCollection{
			TAGS_COLLECTION: {
				docs: map[string]*mockDoc{
					"bad": {id: "bad", exists: true, data: map[string]interface{}{"category": 123}}, // wrong type
				},
			},
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		req, _ := http.NewRequest("GET", "/profiles/tags/bad", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assert.Equal(t, http.StatusOK, w.Code) // Should return empty strings for malformed fields, not panic
	})

	t.Run("GetTagBySlug", func(t *testing.T) {
		mock := &mockClient{collections: make(map[string]*mockCollection)}
		col := mock.Collection(TAGS_COLLECTION).(*mockCollection)
		col.queryRes = []*mockSnap{
			{id: "1", data: map[string]interface{}{"category": "fandom", "name": "Star Wars", "slug": "fandom__star_wars", "multi_select": true}, exists: true},
		}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		req, _ := http.NewRequest("GET", "/profiles/tags/by-slug/fandom__star_wars", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "slug", col.Filters[0].Path)
		assert.Equal(t, "fandom__star_wars", col.Filters[0].Value)
	})

	t.Run("UpdateTag_HappyPath", func(t *testing.T) {
		mock := &mockClient{collections: map[string]*mockCollection{
			TAGS_COLLECTION: {
				docs: map[string]*mockDoc{
					"t1": {id: "t1", exists: true, data: map[string]interface{}{"name": "Old Name", "slug": "fandom__old"}},
				},
			},
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		body := TagUpdate{Name: ptrStr("New Name")}
		jsonBody, _ := json.Marshal(body)

		req, _ := http.NewRequest("PUT", "/profiles/tags/t1", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		var res Tag
		json.Unmarshal(w.Body.Bytes(), &res)
		assert.Equal(t, "New Name", res.Name)
	})

	t.Run("UpdateTag_SlugCollision", func(t *testing.T) {
		mock := &mockClient{collections: map[string]*mockCollection{
			TAGS_COLLECTION: {
				docs: map[string]*mockDoc{
					"t1": {id: "t1", exists: true, data: map[string]interface{}{"slug": "fandom__t1"}},
					"t2": {id: "t2", exists: true, data: map[string]interface{}{"slug": "fandom__t2"}},
				},
				queryRes: []*mockSnap{
					{id: "t2", data: map[string]interface{}{"slug": "fandom__t2"}, exists: true},
				},
			},
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		body := TagUpdate{Slug: ptrStr("fandom__t2")}
		jsonBody, _ := json.Marshal(body)

		req, _ := http.NewRequest("PUT", "/profiles/tags/t1", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
		assert.Contains(t, w.Body.String(), "already exists")
	})

	t.Run("DeleteTag_Success", func(t *testing.T) {
		mock := &mockClient{collections: map[string]*mockCollection{
			TAGS_COLLECTION: {
				docs: map[string]*mockDoc{
					"t1": {id: "t1", exists: true},
				},
			},
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		req, _ := http.NewRequest("DELETE", "/profiles/tags/t1", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNoContent, w.Code)
		assert.False(t, mock.Collection(TAGS_COLLECTION).Doc("t1").(*mockDoc).exists)
	})

	t.Run("ValidateTags_NoMatch_ReturnsFalse", func(t *testing.T) {
		mock := &mockClient{collections: make(map[string]*mockCollection)}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		body := TagValidateRequest{Slug: ptrStr("non-existent")}
		jsonBody, _ := json.Marshal(body)

		req, _ := http.NewRequest("POST", "/profiles/tags/validate", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		var res TagValidateResponse
		json.Unmarshal(w.Body.Bytes(), &res)
		assert.False(t, res.Valid)
	})

	t.Run("ValidateTags_EmptyBody_Returns400", func(t *testing.T) {
		req, _ := http.NewRequest("POST", "/profiles/tags/validate", bytes.NewBufferString("{}"))
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
}
