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

func TestTagSuggestions(t *testing.T) {
	skipIfRealDB(t)
	fixedNow := time.Date(2026, 4, 17, 10, 0, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	mockPub := &mockPublisher{}
	r := setupTest(mockPub)
	
	oldGetDB := getDBFunc
	defer func() { getDBFunc = oldGetDB }()

	token := signGoTestToken("u1", "user")
	adminToken := signGoTestToken("admin", "admin")

	t.Run("SuggestTag_Success", func(t *testing.T) {
		mock := &mockClient{collections: make(map[string]*mockCollection)}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		body := TagSuggestionCreate{
			Category: "fandom",
			Name:     "New Cool Fandom",
		}
		jsonBody, _ := json.Marshal(body)

		req, _ := http.NewRequest("POST", "/profiles/tags/suggest", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusCreated, w.Code)
		var res TagSuggestion
		json.Unmarshal(w.Body.Bytes(), &res)
		assert.Equal(t, "New Cool Fandom", res.Name)
		assert.Equal(t, "u1", res.UserID)
	})

	t.Run("ListSuggestions_AdminOnly", func(t *testing.T) {
		mock := &mockClient{collections: map[string]*mockCollection{
			SUGGESTIONS_COLLECTION: {
				queryRes: []*mockSnap{
					{id: "s1", data: map[string]interface{}{"name": "Sug 1", "category": "fandom", "user_id": "u1"}, exists: true},
				},
			},
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		// 1. User fails
		req1, _ := http.NewRequest("GET", "/profiles/tags/suggestions", nil)
		req1.Header.Set("Authorization", "Bearer "+token)
		w1 := httptest.NewRecorder()
		r.ServeHTTP(w1, req1)
		assert.Equal(t, http.StatusForbidden, w1.Code)

		// 2. Admin succeeds
		req2, _ := http.NewRequest("GET", "/profiles/tags/suggestions", nil)
		req2.Header.Set("Authorization", "Bearer "+adminToken)
		w2 := httptest.NewRecorder()
		r.ServeHTTP(w2, req2)
		assert.Equal(t, http.StatusOK, w2.Code)
		var res []TagSuggestion
		json.Unmarshal(w2.Body.Bytes(), &res)
		assert.Len(t, res, 1)
	})

	t.Run("DeleteSuggestion_NotFound", func(t *testing.T) {
		mock := &mockClient{collections: make(map[string]*mockCollection)}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		req, _ := http.NewRequest("DELETE", "/profiles/tags/suggestions/non-existent", nil)
		req.Header.Set("Authorization", "Bearer "+adminToken)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNotFound, w.Code)
	})
}
