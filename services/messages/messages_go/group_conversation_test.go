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
)

func TestGroupConversations(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)

	mock := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mock, nil
	}

	// Mock profiles client to verify ownership of p1
	oldClient := profilesClient
	profilesClient = &mockProfilesClient{
		GetProfileFunc: func(profileID string, token string) (*ProfileInfo, error) {
			if profileID == "p1" {
				return &ProfileInfo{ProfileID: "p1", UserID: "user_p1"}, nil
			}
			return &ProfileInfo{ProfileID: profileID, UserID: "user_other"}, nil
		},
	}
	defer func() { profilesClient = oldClient }()

	t.Run("CreateGroupChat_Success", func(t *testing.T) {
		// Seed matches for p1 vs p2 and p1 vs p3
		mock.Collection(COLLECTION_CACHE).Doc("match_p1_p2").Set(context.Background(), map[string]interface{}{
			"match_id":    "match_p1_p2",
			"profile_ids": []interface{}{"p1", "p2"},
		})
		mock.Collection(COLLECTION_CACHE).Doc("match_p1_p3").Set(context.Background(), map[string]interface{}{
			"match_id":    "match_p1_p3",
			"profile_ids": []interface{}{"p1", "p3"},
		})

		body := ConversationCreate{
			ParticipantProfileIDs: []string{"p1", "p2", "p3"},
			Type:                  "group",
			Name:                  "The Fellowship",
			ImageURL:              "http://example.com/fellowship.jpg",
		}
		bodyBytes, _ := json.Marshal(body)

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("POST", "/conversations", bytes.NewBuffer(bodyBytes))
		c.Set("auth", AuthData{UID: "user_p1", Role: "user"})

		handleCreateConversation(c)

		if w.Code != http.StatusCreated {
			t.Fatalf("Expected 201 Created, got %d. Body: %s", w.Code, w.Body.String())
		}

		var resp map[string]string
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("Failed to unmarshal response: %v", err)
		}

		convID := resp["conversation_id"]
		if convID == "" {
			t.Fatalf("Expected non-empty conversation_id")
		}

		// Verify conversation is stored in mock Firestore
		docSnap, err := mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Get(context.Background())
		if err != nil || !docSnap.Exists() {
			t.Fatalf("Expected conversation to be stored in DB")
		}

		data := docSnap.Data()
		if data["type"] != "group" {
			t.Errorf("Expected type group, got %v", data["type"])
		}
		if data["name"] != "The Fellowship" {
			t.Errorf("Expected name The Fellowship, got %v", data["name"])
		}
		if data["image_url"] != "http://example.com/fellowship.jpg" {
			t.Errorf("Expected image_url http://example.com/fellowship.jpg, got %v", data["image_url"])
		}
	})

	t.Run("CreateGroupChat_UnmatchedParticipant_Forbidden", func(t *testing.T) {
		// p1 is matched with p2, but NOT p4
		body := ConversationCreate{
			ParticipantProfileIDs: []string{"p1", "p2", "p4"},
			Type:                  "group",
			Name:                  "Unmatched Guild",
		}
		bodyBytes, _ := json.Marshal(body)

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("POST", "/conversations", bytes.NewBuffer(bodyBytes))
		c.Set("auth", AuthData{UID: "user_p1", Role: "user"})

		handleCreateConversation(c)

		if w.Code != http.StatusForbidden {
			t.Errorf("Expected 403 Forbidden for unmatched participant, got %d", w.Code)
		}
	})

	t.Run("CreateGroupChat_InvalidParticipantCount", func(t *testing.T) {
		body := ConversationCreate{
			ParticipantProfileIDs: []string{"p1"},
			Type:                  "group",
		}
		bodyBytes, _ := json.Marshal(body)

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("POST", "/conversations", bytes.NewBuffer(bodyBytes))
		c.Set("auth", AuthData{UID: "user_p1", Role: "user"})

		handleCreateConversation(c)

		if w.Code != http.StatusUnprocessableEntity {
			t.Errorf("Expected 422, got %d", w.Code)
		}
	})

	t.Run("CreateDirectChat_InvalidParticipantCount", func(t *testing.T) {
		body := ConversationCreate{
			ParticipantProfileIDs: []string{"p1", "p2", "p3"},
			Type:                  "direct",
		}
		bodyBytes, _ := json.Marshal(body)

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("POST", "/conversations", bytes.NewBuffer(bodyBytes))
		c.Set("auth", AuthData{UID: "user_p1", Role: "user"})

		handleCreateConversation(c)

		if w.Code != http.StatusUnprocessableEntity {
			t.Errorf("Expected 422, got %d", w.Code)
		}
	})

	t.Run("GetGroupChat_Success", func(t *testing.T) {
		convID := "group_convo_id"
		now := time.Now().UTC()

		mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), map[string]interface{}{
			"id":              convID,
			"type":            "group",
			"name":            "The Fellowship",
			"image_url":       "http://example.com/fellowship.jpg",
			"participant_ids": []interface{}{"p1", "p2", "p3"},
			"created_at":      now,
			"updated_at":      now,
			"last_message_id": "msg1",
			"last_message_text": "Greetings, traveler",
			"last_message_sent_at": now,
			"last_message_sender_id": "p2",
		})

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{UID: "user_p1", Role: "user"})
		c.Params = []gin.Param{{Key: "id", Value: convID}}

		handleGetConversation(c)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
		}

		var resp ConversationOut
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("Failed to unmarshal response: %v", err)
		}

		if resp.Type != "group" {
			t.Errorf("Expected Type 'group', got '%s'", resp.Type)
		}
		if resp.Name == nil || *resp.Name != "The Fellowship" {
			t.Errorf("Expected Name 'The Fellowship'")
		}
		if resp.ImageURL == nil || *resp.ImageURL != "http://example.com/fellowship.jpg" {
			t.Errorf("Expected ImageURL 'http://example.com/fellowship.jpg'")
		}
		if resp.OtherProfileID != nil {
			t.Errorf("Expected OtherProfileID to be nil for group chats, got '%s'", *resp.OtherProfileID)
		}
	})
}
