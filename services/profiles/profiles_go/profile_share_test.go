package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestProfileSharingAndClaiming(t *testing.T) {
	skipIfRealDB(t)
	fixedNow := time.Date(2026, 4, 17, 10, 0, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	mockPub := &mockPublisher{}
	r := setupTest(mockPub)

	oldGetDB := getDBFunc
	defer func() { getDBFunc = oldGetDB }()

	t.Run("ShareProfile_Success", func(t *testing.T) {
		profileID := "p_share_1"
		userID := "u1"
		mock := &mockClient{collections: map[string]*mockCollection{
			COLLECTION: {
				docs: map[string]*mockDoc{
					profileID: {id: profileID, exists: true, data: map[string]interface{}{"user_id": userID, "display_name": "Hero 1"}},
				},
			},
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }
		token := signGoTestToken(userID, "user")

		req, _ := http.NewRequest("POST", "/profiles/"+profileID+"/share", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		
		var out ProfileOut
		err := json.Unmarshal(w.Body.Bytes(), &out)
		assert.NoError(t, err)
		assert.NotNil(t, out.SharedAt)
		assert.Equal(t, fixedNow.Unix(), out.SharedAt.Unix())

		doc, _ := mock.Collection(COLLECTION).Doc(profileID).Get(context.Background())
		assert.NotNil(t, doc.Data()["shared_at"])
	})

	t.Run("ShareProfile_ForbiddenNonOwner", func(t *testing.T) {
		profileID := "p_share_2"
		mock := &mockClient{collections: map[string]*mockCollection{
			COLLECTION: {
				docs: map[string]*mockDoc{
					profileID: {id: profileID, exists: true, data: map[string]interface{}{"user_id": "owner"}},
				},
			},
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }
		token := signGoTestToken("not-owner", "user")

		req, _ := http.NewRequest("POST", "/profiles/"+profileID+"/share", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("GetSharedProfile_Success", func(t *testing.T) {
		profileID := "p_get_shared"
		sharedTime := fixedNow.Add(-1 * time.Hour)
		mock := &mockClient{collections: map[string]*mockCollection{
			COLLECTION: {
				docs: map[string]*mockDoc{
					profileID: {id: profileID, exists: true, data: map[string]interface{}{
						"user_id":      "u1",
						"display_name": "Shared Hero",
						"shared_at":    sharedTime,
					}},
				},
			},
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		req, _ := http.NewRequest("GET", "/profiles/shared/"+profileID, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		
		var out ProfileOut
		err := json.Unmarshal(w.Body.Bytes(), &out)
		assert.NoError(t, err)
		assert.NotNil(t, out.SharedAt)
		assert.Equal(t, sharedTime.Unix(), out.SharedAt.Unix())
	})

	t.Run("GetSharedProfile_NotFoundNotShared", func(t *testing.T) {
		profileID := "p_not_shared"
		mock := &mockClient{collections: map[string]*mockCollection{
			COLLECTION: {
				docs: map[string]*mockDoc{
					profileID: {id: profileID, exists: true, data: map[string]interface{}{
						"user_id":      "u1",
						"display_name": "Private Hero",
					}},
				},
			},
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		req, _ := http.NewRequest("GET", "/profiles/shared/"+profileID, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNotFound, w.Code)
	})

	t.Run("UnshareProfile_Success", func(t *testing.T) {
		profileID := "p_unshare"
		mock := &mockClient{collections: map[string]*mockCollection{
			COLLECTION: {
				docs: map[string]*mockDoc{
					profileID: {id: profileID, exists: true, data: map[string]interface{}{
						"user_id":   "u1",
						"shared_at": fixedNow,
					}},
				},
			},
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		req, _ := http.NewRequest("POST", "/profiles/"+profileID+"/unshare", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		
		doc, _ := mock.Collection(COLLECTION).Doc(profileID).Get(context.Background())
		assert.Nil(t, doc.Data()["shared_at"])
	})

	t.Run("ClaimProfile_Success", func(t *testing.T) {
		profileID := "p_claim"
		claimingUser := "u_claim"
		existingActiveProfile := "p_existing_active"

		col := &mockCollection{
			path: COLLECTION,
			docs: make(map[string]*mockDoc),
		}
		col.docs[profileID] = &mockDoc{
			id:     profileID,
			exists: true,
			data: map[string]interface{}{
				"user_id":      "original_owner",
				"display_name": "Adrift Hero",
				"shared_at":    fixedNow,
				"is_active":    false,
			},
		}
		col.docs[existingActiveProfile] = &mockDoc{
			id:     existingActiveProfile,
			exists: true,
			data: map[string]interface{}{
				"user_id":   claimingUser,
				"is_active": true,
			},
		}
		col.queryRes = []*mockSnap{
			{
				id:     existingActiveProfile,
				exists: true,
				data:   col.docs[existingActiveProfile].data,
				ref:    col.docs[existingActiveProfile],
			},
		}

		mock := &mockClient{collections: map[string]*mockCollection{
			COLLECTION: col,
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }
		token := signGoTestToken(claimingUser, "user")

		req, _ := http.NewRequest("POST", "/profiles/"+profileID+"/claim", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)

		// Verify the claimed profile
		doc, _ := mock.Collection(COLLECTION).Doc(profileID).Get(context.Background())
		assert.Equal(t, claimingUser, doc.Data()["user_id"])
		assert.True(t, doc.Data()["is_active"].(bool))
		assert.Nil(t, doc.Data()["shared_at"])

		// Verify that other profile was deactivated
		oldActiveDoc, _ := mock.Collection(COLLECTION).Doc(existingActiveProfile).Get(context.Background())
		assert.False(t, oldActiveDoc.Data()["is_active"].(bool))
	})

	t.Run("ClaimProfile_BadRequestNotShared", func(t *testing.T) {
		profileID := "p_claim_not_shared"
		claimingUser := "u_claim"
		mock := &mockClient{collections: map[string]*mockCollection{
			COLLECTION: {
				docs: map[string]*mockDoc{
					profileID: {id: profileID, exists: true, data: map[string]interface{}{
						"user_id":   "original_owner",
						"is_active": true,
					}},
				},
			},
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }
		token := signGoTestToken(claimingUser, "user")

		req, _ := http.NewRequest("POST", "/profiles/"+profileID+"/claim", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
}
