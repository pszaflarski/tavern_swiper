package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestDeletionBehavior(t *testing.T) {
	skipIfRealDB(t)
	jwtSecret = []byte("super-secret-tavern-key-123")
	fixedNow := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	t.Run("DeleteProfile_PublishesDeletionEvent", func(t *testing.T) {
		mockPub := &mockPublisher{}
		r := setupTest(mockPub)

		profileID := "p-del-1"
		userID := "u-del-1"
		mock := &mockClient{collections: map[string]*mockCollection{
			COLLECTION: {
				docs: map[string]*mockDoc{
					profileID: {id: profileID, exists: true, data: map[string]interface{}{"user_id": userID}},
				},
			},
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		// Stub GCS deletion to no-op
		oldDelete := deleteProfileImagesFunc
		deleteProfileImagesFunc = func(ctx context.Context, profileID string) error { return nil }
		defer func() { deleteProfileImagesFunc = oldDelete }()

		token := signGoTestTokenWithTimes(userID, "user", fixedNow, fixedNow.Add(30*time.Minute))
		req, _ := http.NewRequest("DELETE", "/profiles/"+profileID, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNoContent, w.Code)
		assert.Contains(t, mockPub.PublishedDeleted, profileID, "Should publish DELETED event")
	})

	t.Run("DeleteProfile_CallsDeleteProfileImages", func(t *testing.T) {
		mockPub := &mockPublisher{}
		r := setupTest(mockPub)

		profileID := "p-del-img"
		userID := "u-del-img"
		mock := &mockClient{collections: map[string]*mockCollection{
			COLLECTION: {
				docs: map[string]*mockDoc{
					profileID: {id: profileID, exists: true, data: map[string]interface{}{"user_id": userID}},
				},
			},
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		deletedIDs := []string{}
		oldDelete := deleteProfileImagesFunc
		deleteProfileImagesFunc = func(ctx context.Context, pID string) error {
			deletedIDs = append(deletedIDs, pID)
			return nil
		}
		defer func() { deleteProfileImagesFunc = oldDelete }()

		token := signGoTestTokenWithTimes(userID, "user", fixedNow, fixedNow.Add(30*time.Minute))
		req, _ := http.NewRequest("DELETE", "/profiles/"+profileID, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNoContent, w.Code)
		assert.Contains(t, deletedIDs, profileID, "Should call deleteProfileImages for the profile")
	})

	t.Run("DeleteAllProfiles_PublishesAllDeletedEvent", func(t *testing.T) {
		mockPub := &mockPublisher{}
		r := setupTest(mockPub)

		mock := &mockClient{collections: make(map[string]*mockCollection)}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		// Stub GCS deletion to no-op
		oldDelete := deleteProfileImagesFunc
		deleteProfileImagesFunc = func(ctx context.Context, profileID string) error { return nil }
		defer func() { deleteProfileImagesFunc = oldDelete }()

		adminToken := signGoTestTokenWithTimes("admin-purge", "root_admin", fixedNow, fixedNow.Add(30*time.Minute))
		req, _ := http.NewRequest("DELETE", "/profiles/", nil)
		req.Header.Set("Authorization", "Bearer "+adminToken)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, mockPub.PublishedAll, "admin-purge", "Should publish ALL_DELETED event")
	})

	t.Run("DeleteAllProfiles_CleansGCSForEachProfile", func(t *testing.T) {
		mockPub := &mockPublisher{}
		r := setupTest(mockPub)

		p1 := &mockSnap{
			id: "p1", exists: true,
			data: map[string]interface{}{"user_id": "u1", "display_name": "Hero"},
			ref:  &mockDoc{id: "p1", exists: true, data: map[string]interface{}{"user_id": "u1"}},
		}
		p2 := &mockSnap{
			id: "p2", exists: true,
			data: map[string]interface{}{"user_id": "u2", "display_name": "Villain"},
			ref:  &mockDoc{id: "p2", exists: true, data: map[string]interface{}{"user_id": "u2"}},
		}
		mock := &mockClient{collections: map[string]*mockCollection{
			COLLECTION: {
				queryRes: []*mockSnap{p1, p2},
				docs: map[string]*mockDoc{
					"p1": p1.ref.(*mockDoc),
					"p2": p2.ref.(*mockDoc),
				},
			},
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		deletedIDs := []string{}
		oldDelete := deleteProfileImagesFunc
		deleteProfileImagesFunc = func(ctx context.Context, pID string) error {
			deletedIDs = append(deletedIDs, pID)
			return nil
		}
		defer func() { deleteProfileImagesFunc = oldDelete }()

		adminToken := signGoTestTokenWithTimes("admin-purge", "root_admin", fixedNow, fixedNow.Add(30*time.Minute))
		req, _ := http.NewRequest("DELETE", "/profiles/", nil)
		req.Header.Set("Authorization", "Bearer "+adminToken)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, deletedIDs, "p1", "Should call deleteProfileImages for p1")
		assert.Contains(t, deletedIDs, "p2", "Should call deleteProfileImages for p2")
	})
}

// Prevent unused import errors
var _ = io.Discard
