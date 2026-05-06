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

func TestTagStatusFlow(t *testing.T) {
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

	t.Run("UserCreateTag_Pending_Success", func(t *testing.T) {
		mock := &mockClient{collections: make(map[string]*mockCollection)}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		body := TagCreate{
			Category: "fandom",
			Name:     "Star Wars",
		}
		jsonBody, _ := json.Marshal(body)

		req, _ := http.NewRequest("POST", "/profiles/tags/", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusCreated, w.Code)
		var res Tag
		json.Unmarshal(w.Body.Bytes(), &res)
		assert.Equal(t, "Star Wars", res.Name)
		assert.Equal(t, "pending", res.Status)
		assert.Equal(t, "fandom__star_wars", res.Slug)
		assert.NotNil(t, res.SuggestedBy)
		assert.Equal(t, "u1", *res.SuggestedBy)
	})

	t.Run("UserCreateTag_Idempotent", func(t *testing.T) {
		mock := &mockClient{collections: map[string]*mockCollection{
			TAGS_COLLECTION: {
				queryRes: []*mockSnap{
					{id: "t1", data: map[string]interface{}{
						"name":     "Star Wars",
						"category": "fandom",
						"slug":     "fandom__star_wars",
						"status":   "pending",
					}, exists: true},
				},
			},
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		body := TagCreate{
			Category: "fandom",
			Name:     "Star Wars",
		}
		jsonBody, _ := json.Marshal(body)

		req, _ := http.NewRequest("POST", "/profiles/tags/", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		var res Tag
		json.Unmarshal(w.Body.Bytes(), &res)
		assert.Equal(t, "t1", res.ID)
	})

	t.Run("AdminCreateTag_Active", func(t *testing.T) {
		mock := &mockClient{collections: make(map[string]*mockCollection)}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		body := TagCreate{
			Category: "fandom",
			Name:     "Star Trek",
			Slug:     "fandom__trek",
		}
		jsonBody, _ := json.Marshal(body)

		req, _ := http.NewRequest("POST", "/profiles/tags/", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+adminToken)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusCreated, w.Code)
		var res Tag
		json.Unmarshal(w.Body.Bytes(), &res)
		assert.Equal(t, "active", res.Status)
		assert.Equal(t, "fandom__trek", res.Slug)
		assert.Nil(t, res.SuggestedBy)
	})

	t.Run("AdminApproveTag", func(t *testing.T) {
		mock := &mockClient{collections: map[string]*mockCollection{
			TAGS_COLLECTION: {
				docs: map[string]*mockDoc{
					"t1": {id: "t1", data: map[string]interface{}{
						"name":     "Star Wars",
						"category": "fandom",
						"slug":     "fandom__star_wars",
						"status":   "pending",
					}, exists: true},
				},
			},
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		body := map[string]interface{}{"status": "active"}
		jsonBody, _ := json.Marshal(body)

		req, _ := http.NewRequest("PUT", "/profiles/tags/t1", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+adminToken)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		var res Tag
		json.Unmarshal(w.Body.Bytes(), &res)
		assert.Equal(t, "active", res.Status)
	})

	t.Run("ListPendingTags_AdminOnly", func(t *testing.T) {
		mock := &mockClient{collections: map[string]*mockCollection{
			TAGS_COLLECTION: {
				queryRes: []*mockSnap{
					{id: "t1", data: map[string]interface{}{"name": "Sug 1", "category": "fandom", "status": "pending"}, exists: true},
				},
			},
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		// 1. User fails
		req1, _ := http.NewRequest("GET", "/profiles/tags/pending", nil)
		req1.Header.Set("Authorization", "Bearer "+token)
		w1 := httptest.NewRecorder()
		r.ServeHTTP(w1, req1)
		assert.Equal(t, http.StatusForbidden, w1.Code)

		// 2. Admin succeeds
		req2, _ := http.NewRequest("GET", "/profiles/tags/pending", nil)
		req2.Header.Set("Authorization", "Bearer "+adminToken)
		w2 := httptest.NewRecorder()
		r.ServeHTTP(w2, req2)
		assert.Equal(t, http.StatusOK, w2.Code)
		var res []Tag
		json.Unmarshal(w2.Body.Bytes(), &res)
		assert.Len(t, res, 1)
		assert.Equal(t, "pending", res[0].Status)
	})
}
