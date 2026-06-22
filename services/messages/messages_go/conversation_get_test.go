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

func TestHandleGetConversation(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)

	mock := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mock, nil
	}

	t.Run("GetConversation_Success_Admin", func(t *testing.T) {
		convID := "c_admin"
		now := time.Now().UTC()

		mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), map[string]interface{}{
			"id":              convID,
			"participant_ids": []interface{}{"p1", "p2"},
			"created_at":      now,
			"updated_at":      now,
			"last_message_id": "m1",
			"last_message_text": "hello",
			"last_message_sent_at": now,
			"last_message_sender_id": "p2",
		})

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "admin"})
		c.Params = []gin.Param{{Key: "id", Value: convID}}

		handleGetConversation(c)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
		}

		var resp ConversationOut
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("Failed to unmarshal response: %v", err)
		}

		if resp.ID != convID {
			t.Errorf("Expected ID %s, got %s", convID, resp.ID)
		}
		if len(resp.ParticipantIDs) != 2 || resp.ParticipantIDs[0] != "p1" || resp.ParticipantIDs[1] != "p2" {
			t.Errorf("Expected participants [p1, p2], got %v", resp.ParticipantIDs)
		}
	})

	t.Run("GetConversation_Success_Participant", func(t *testing.T) {
		convID := "c_part"
		now := time.Now().UTC()

		mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), map[string]interface{}{
			"id":              convID,
			"participant_ids": []interface{}{"p1", "p2"},
			"created_at":      now,
			"updated_at":      now,
		})

		// Mock profiles client to verify ownership of p1
		oldClient := profilesClient
		profilesClient = &mockProfilesClient{
			GetProfileFunc: func(profileID string, token string) (*ProfileInfo, error) {
				if profileID == "p1" {
					return &ProfileInfo{ProfileID: "p1", UserID: "user_p1"}, nil
				}
				return nil, http.ErrAbortHandler
			},
		}
		defer func() { profilesClient = oldClient }()

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{UID: "user_p1", Role: "user"})
		c.Params = []gin.Param{{Key: "id", Value: convID}}

		handleGetConversation(c)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
		}
	})

	t.Run("GetConversation_Forbidden_NotParticipant", func(t *testing.T) {
		convID := "c_forbidden"
		now := time.Now().UTC()

		mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), map[string]interface{}{
			"id":              convID,
			"participant_ids": []interface{}{"p1", "p2"},
			"created_at":      now,
			"updated_at":      now,
		})

		// Mock profiles client to verify ownership of third party
		oldClient := profilesClient
		profilesClient = &mockProfilesClient{
			GetProfileFunc: func(profileID string, token string) (*ProfileInfo, error) {
				return &ProfileInfo{ProfileID: profileID, UserID: "user_other"}, nil
			},
		}
		defer func() { profilesClient = oldClient }()

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{UID: "user_hacker", Role: "user"})
		c.Params = []gin.Param{{Key: "id", Value: convID}}

		handleGetConversation(c)

		if w.Code != http.StatusForbidden {
			t.Errorf("Expected 403, got %d", w.Code)
		}
	})

	t.Run("GetConversation_NotFound", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "admin"})
		c.Params = []gin.Param{{Key: "id", Value: "non_existent_id"}}

		handleGetConversation(c)

		if w.Code != http.StatusNotFound {
			t.Errorf("Expected 404, got %d", w.Code)
		}
	})
}
