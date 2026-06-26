package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestHandleListMatches(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)

	fixedNow := time.Date(2026, 6, 25, 12, 0, 0, 0, time.UTC)

	// Helper to generate a valid token with future expiry
	validToken := func(uid, role string) string {
		now := time.Now()
		return signGoTestTokenWithTimes(uid, role, now, now.Add(30*time.Minute))
	}

	t.Run("ReturnsAllMatches", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		// Seed two matches in the cache
		mock.Collection(COLLECTION_CACHE).Doc("match_p1_p2").Set(context.Background(), map[string]interface{}{
			"match_id":    "match_p1_p2",
			"profile_ids": []interface{}{"p1", "p2"},
			"created_at":  fixedNow,
		})
		mock.Collection(COLLECTION_CACHE).Doc("match_p1_p3").Set(context.Background(), map[string]interface{}{
			"match_id":    "match_p1_p3",
			"profile_ids": []interface{}{"p1", "p3"},
			"created_at":  fixedNow,
		})

		r := setupTest()
		w := httptest.NewRecorder()
		token := validToken("admin-uid", "admin")
		req, _ := http.NewRequest("GET", "/messages/matches/profile/p1", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
		}

		var results []MatchOut
		json.Unmarshal(w.Body.Bytes(), &results)
		if len(results) != 2 {
			t.Errorf("Expected 2 matches, got %d", len(results))
		}
	})

	t.Run("NewOnlyFiltersConversed", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		// Seed two matches in the cache
		mock.Collection(COLLECTION_CACHE).Doc("match_p1_p2").Set(context.Background(), map[string]interface{}{
			"match_id":    "match_p1_p2",
			"profile_ids": []interface{}{"p1", "p2"},
			"created_at":  fixedNow,
		})
		mock.Collection(COLLECTION_CACHE).Doc("match_p1_p3").Set(context.Background(), map[string]interface{}{
			"match_id":    "match_p1_p3",
			"profile_ids": []interface{}{"p1", "p3"},
			"created_at":  fixedNow,
		})

		// Create a conversation between p1 and p2 (so match_p1_p2 should be filtered)
		convID := "conv-p1-p2"
		mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), map[string]interface{}{
			"id":               convID,
			"participants_key": "p1_p2",
			"participant_ids":  []interface{}{"p1", "p2"},
			"last_message_id":  "msg1",
			"created_at":       fixedNow,
			"updated_at":       fixedNow,
		})
		// Create profile_conversations mapping for p1
		mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc("p1_"+convID).Set(context.Background(), map[string]interface{}{
			"profile_id":      "p1",
			"conversation_id": convID,
			"role":            "participant",
		})

		r := setupTest()
		w := httptest.NewRecorder()
		token := validToken("admin-uid", "admin")
		req, _ := http.NewRequest("GET", "/messages/matches/profile/p1?new_only=true", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
		}

		var results []MatchOut
		json.Unmarshal(w.Body.Bytes(), &results)
		if len(results) != 1 {
			t.Fatalf("Expected 1 match (p1_p3 only), got %d", len(results))
		}
		if results[0].ID != "match_p1_p3" {
			t.Errorf("Expected remaining match to be match_p1_p3, got %s", results[0].ID)
		}
	})

	t.Run("NewOnlyNoConversations", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		// Seed one match, no conversations
		mock.Collection(COLLECTION_CACHE).Doc("match_p1_p4").Set(context.Background(), map[string]interface{}{
			"match_id":    "match_p1_p4",
			"profile_ids": []interface{}{"p1", "p4"},
			"created_at":  fixedNow,
		})

		r := setupTest()
		w := httptest.NewRecorder()
		token := validToken("admin-uid", "admin")
		req, _ := http.NewRequest("GET", "/messages/matches/profile/p1?new_only=true", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
		}

		var results []MatchOut
		json.Unmarshal(w.Body.Bytes(), &results)
		if len(results) != 1 {
			t.Errorf("Expected 1 match, got %d", len(results))
		}
	})

	t.Run("ForbiddenForNonOwner", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}
		// profilesClient is nil so verifyProfileOwnership returns false for non-admins
		oldClient := profilesClient
		profilesClient = nil
		defer func() { profilesClient = oldClient }()

		r := setupTest()
		w := httptest.NewRecorder()
		token := validToken("some-uid", "user")
		req, _ := http.NewRequest("GET", "/messages/matches/profile/p1", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		r.ServeHTTP(w, req)

		if w.Code != http.StatusForbidden {
			t.Errorf("Expected 403, got %d. Body: %s", w.Code, w.Body.String())
		}
	})

	t.Run("EmptyMatchesReturnsEmptyArray", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		r := setupTest()
		w := httptest.NewRecorder()
		token := validToken("admin-uid", "admin")
		req, _ := http.NewRequest("GET", "/messages/matches/profile/p1", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
		}

		var results []MatchOut
		json.Unmarshal(w.Body.Bytes(), &results)
		if len(results) != 0 {
			t.Errorf("Expected 0 matches, got %d", len(results))
		}
	})
}
