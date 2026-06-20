package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestProfileOperations(t *testing.T) {
	skipIfRealDB(t)
	fixedNow := time.Date(2026, 4, 17, 10, 0, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	mockPub := &mockPublisher{}
	r := setupTest(mockPub)

	oldGetDB := getDBFunc
	defer func() { getDBFunc = oldGetDB }()

	t.Run("HealthCheck", func(t *testing.T) {
		req, _ := http.NewRequest("GET", "/profiles/health", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), "ok")
	})

	t.Run("DeleteProfile_OwnerSuccess", func(t *testing.T) {
		profileID := "p1"
		userID := "u1"
		mock := &mockClient{collections: map[string]*mockCollection{
			COLLECTION: {
				docs: map[string]*mockDoc{
					profileID: {id: profileID, exists: true, data: map[string]interface{}{"user_id": userID}},
				},
			},
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }
		token := signGoTestToken(userID, "user")

		req, _ := http.NewRequest("DELETE", "/profiles/"+profileID, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNoContent, w.Code)
		assert.False(t, mock.Collection(COLLECTION).Doc(profileID).(*mockDoc).exists)
		assert.Contains(t, mockPub.PublishedDeleted, profileID)
	})

	t.Run("DeleteProfile_NonOwnerForbidden", func(t *testing.T) {
		profileID := "p1"
		mock := &mockClient{collections: map[string]*mockCollection{
			COLLECTION: {
				docs: map[string]*mockDoc{
					profileID: {id: profileID, exists: true, data: map[string]interface{}{"user_id": "owner"}},
				},
			},
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }
		token := signGoTestToken("not-owner", "user")

		req, _ := http.NewRequest("DELETE", "/profiles/"+profileID, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("DeleteAllProfiles_AdminOnly", func(t *testing.T) {
		mock := &mockClient{collections: make(map[string]*mockCollection)}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		// 1. Non-admin fails
		userToken := signGoTestToken("u1", "user")
		req1, _ := http.NewRequest("DELETE", "/profiles/", nil)
		req1.Header.Set("Authorization", "Bearer "+userToken)
		w1 := httptest.NewRecorder()
		r.ServeHTTP(w1, req1)
		assert.Equal(t, http.StatusForbidden, w1.Code)

		// 2. Admin (root) succeeds
		adminToken := signGoTestToken("admin", "root_admin")
		req2, _ := http.NewRequest("DELETE", "/profiles/", nil)
		req2.Header.Set("Authorization", "Bearer "+adminToken)
		w2 := httptest.NewRecorder()
		r.ServeHTTP(w2, req2)
		assert.Equal(t, http.StatusOK, w2.Code)
		assert.Contains(t, mockPub.PublishedAll, "admin")
	})

	t.Run("SetActive_Success", func(t *testing.T) {
		profileID := "p1"
		userID := "u1"
		mock := &mockClient{collections: map[string]*mockCollection{
			COLLECTION: {
				docs: map[string]*mockDoc{
					profileID: {id: profileID, exists: true, data: map[string]interface{}{"user_id": userID, "is_active": false}},
				},
			},
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }
		token := signGoTestToken(userID, "user")

		req, _ := http.NewRequest("POST", "/profiles/"+profileID+"/set_active", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		doc, _ := mock.Collection(COLLECTION).Doc(profileID).Get(context.Background())
		assert.True(t, doc.Data()["is_active"].(bool))
	})
}
