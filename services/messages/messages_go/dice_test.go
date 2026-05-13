package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// mockProfilesClient implements ProfilesClient for tests.
type mockProfilesClient struct {
	GetProfileFunc func(profileID string, token string) (*ProfileInfo, error)
}

func (m *mockProfilesClient) GetProfile(profileID string, token string) (*ProfileInfo, error) {
	if m.GetProfileFunc != nil {
		return m.GetProfileFunc(profileID, token)
	}
	return nil, nil
}

func TestHandleRollDice(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)

	t.Run("SimpleRoll_NoConversation", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "user"})

		body := map[string]string{"type": "d20"}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/messages/roll-dice", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")

		handleRollDice(c)

		if w.Code != http.StatusOK {
			t.Errorf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
		}

		var resp DiceRollResponse
		json.Unmarshal(w.Body.Bytes(), &resp)

		if resp.DiceType != "d20" {
			t.Errorf("Expected type 'd20', got '%s'", resp.DiceType)
		}
		if resp.Result < 1 || resp.Result > 20 {
			t.Errorf("Expected result between 1 and 20, got %d", resp.Result)
		}
		if resp.ConversationID != "" {
			t.Errorf("Expected empty conversation_id, got '%s'", resp.ConversationID)
		}
		if resp.MessageID != "" {
			t.Errorf("Expected empty message_id, got '%s'", resp.MessageID)
		}
	})

	t.Run("AllDiceTypes", func(t *testing.T) {
		for diceType, maxVal := range ValidDiceTypes {
			t.Run(diceType, func(t *testing.T) {
				w := httptest.NewRecorder()
				c, _ := gin.CreateTestContext(w)
				c.Set("auth", AuthData{Role: "user"})

				body := map[string]string{"type": diceType}
				b, _ := json.Marshal(body)
				c.Request, _ = http.NewRequest("POST", "/messages/roll-dice", bytes.NewBuffer(b))
				c.Request.Header.Set("Content-Type", "application/json")

				handleRollDice(c)

				if w.Code != http.StatusOK {
					t.Errorf("Expected 200, got %d", w.Code)
				}

				var resp DiceRollResponse
				json.Unmarshal(w.Body.Bytes(), &resp)

				if resp.Result < 1 || resp.Result > maxVal {
					t.Errorf("Expected %s result between 1 and %d, got %d", diceType, maxVal, resp.Result)
				}
			})
		}
	})

	t.Run("InvalidDiceType", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "user"})

		body := map[string]string{"type": "d100"}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/messages/roll-dice", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")

		handleRollDice(c)

		if w.Code != http.StatusUnprocessableEntity {
			t.Errorf("Expected 422, got %d", w.Code)
		}
	})

	t.Run("MissingType", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "user"})

		body := map[string]string{"conversation_id": "c1"}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/messages/roll-dice", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")

		handleRollDice(c)

		if w.Code != http.StatusUnprocessableEntity {
			t.Errorf("Expected 422, got %d", w.Code)
		}
	})

	t.Run("ConversationWithoutProfileID", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "user"})

		body := map[string]string{"type": "d6", "conversation_id": "conv123"}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/messages/roll-dice", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")

		handleRollDice(c)

		if w.Code != http.StatusUnprocessableEntity {
			t.Errorf("Expected 422, got %d. Body: %s", w.Code, w.Body.String())
		}
	})

	t.Run("ConversationNotParticipant", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "user"})

		body := map[string]string{"type": "d6", "conversation_id": "conv123", "profile_id": "p_stranger"}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/messages/roll-dice", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")

		handleRollDice(c)

		if w.Code != http.StatusForbidden {
			t.Errorf("Expected 403, got %d", w.Code)
		}
	})

	t.Run("ConversationRollWithEventMessage", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		// Setup: inject mock profiles client
		oldClient := profilesClient
		profilesClient = &mockProfilesClient{
			GetProfileFunc: func(profileID string, token string) (*ProfileInfo, error) {
				return &ProfileInfo{ProfileID: profileID, DisplayName: "Thorin Oakenshield"}, nil
			},
		}
		defer func() { profilesClient = oldClient }()

		convID := "conv_dice"
		profileID := "p1"

		// Setup conversation and mapping
		mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), map[string]interface{}{
			"id":              convID,
			"participant_ids": []interface{}{"p1", "p2"},
		})
		mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(profileID+"_"+convID).Set(context.Background(), ProfileConversation{
			ProfileID: profileID, ConversationID: convID,
		})

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "user", Token: "test-token"})

		body := map[string]string{"type": "d20", "conversation_id": convID, "profile_id": profileID}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/messages/roll-dice", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")

		handleRollDice(c)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
		}

		var resp DiceRollResponse
		json.Unmarshal(w.Body.Bytes(), &resp)

		if resp.DiceType != "d20" {
			t.Errorf("Expected type 'd20', got '%s'", resp.DiceType)
		}
		if resp.Result < 1 || resp.Result > 20 {
			t.Errorf("Expected result between 1 and 20, got %d", resp.Result)
		}
		if resp.ConversationID != convID {
			t.Errorf("Expected conversation_id '%s', got '%s'", convID, resp.ConversationID)
		}
		if resp.MessageID == "" {
			t.Error("Expected message_id to be set")
		}

		// Verify the event message was created in the sub-collection
		msgIter := mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Collection(COLLECTION_MESSAGES).Documents(context.Background())
		msgs, _ := msgIter.GetAll()
		if len(msgs) != 1 {
			t.Fatalf("Expected 1 message in sub-collection, got %d", len(msgs))
		}

		msgData := msgs[0].Data()
		if msgData["type"] != MessageTypeEvent {
			t.Errorf("Expected message type '%s', got '%v'", MessageTypeEvent, msgData["type"])
		}

		content, _ := msgData["content"].(string)
		// Content should contain "Thorin Oakenshield rolled a X on a d20"
		if content == "" {
			t.Error("Expected non-empty content")
		}

		// Verify denormalization
		convSnap, _ := mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Get(context.Background())
		convData := convSnap.Data()
		if convData["last_message_type"] != MessageTypeEvent {
			t.Errorf("Expected last_message_type '%s', got '%v'", MessageTypeEvent, convData["last_message_type"])
		}
	})

	t.Run("ConversationRollFallbackName", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		// Setup: profiles client returns an error (simulating service down)
		oldClient := profilesClient
		profilesClient = &mockProfilesClient{
			GetProfileFunc: func(profileID string, token string) (*ProfileInfo, error) {
				return nil, http.ErrAbortHandler // Simulate failure
			},
		}
		defer func() { profilesClient = oldClient }()

		convID := "conv_fallback"
		profileID := "p1"

		mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), map[string]interface{}{
			"id":              convID,
			"participant_ids": []interface{}{"p1", "p2"},
		})
		mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(profileID+"_"+convID).Set(context.Background(), ProfileConversation{
			ProfileID: profileID, ConversationID: convID,
		})

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "user", Token: "test-token"})

		body := map[string]string{"type": "d6", "conversation_id": convID, "profile_id": profileID}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/messages/roll-dice", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")

		handleRollDice(c)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
		}

		// Verify the event message uses the fallback name
		msgIter := mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Collection(COLLECTION_MESSAGES).Documents(context.Background())
		msgs, _ := msgIter.GetAll()
		if len(msgs) != 1 {
			t.Fatalf("Expected 1 message, got %d", len(msgs))
		}

		content, _ := msgs[0].Data()["content"].(string)
		if content == "" {
			t.Error("Expected non-empty content")
		}
		// Should use fallback "An adventurer" since profiles client failed
		if len(content) < 10 {
			t.Errorf("Content seems too short: '%s'", content)
		}
	})

	t.Run("CaseInsensitiveDiceType", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "user"})

		body := map[string]string{"type": "D20"}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/messages/roll-dice", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")

		handleRollDice(c)

		if w.Code != http.StatusOK {
			t.Errorf("Expected 200 for uppercase D20, got %d", w.Code)
		}

		var resp DiceRollResponse
		json.Unmarshal(w.Body.Bytes(), &resp)
		if resp.DiceType != "d20" {
			t.Errorf("Expected normalized type 'd20', got '%s'", resp.DiceType)
		}
	})
	t.Run("DiceRoll_SetsUnreadForOtherParticipants", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}
		oldClient := profilesClient
		profilesClient = &mockProfilesClient{}
		defer func() { profilesClient = oldClient }()

		convID := "conv_unread"
		profileID := "p1"
		otherID := "p2"

		mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), map[string]interface{}{
			"id":              convID,
			"participant_ids": []interface{}{profileID, otherID},
		})
		mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(profileID+"_"+convID).Set(context.Background(), ProfileConversation{
			ProfileID: profileID, ConversationID: convID, Unread: true,
		})
		mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(otherID+"_"+convID).Set(context.Background(), ProfileConversation{
			ProfileID: otherID, ConversationID: convID, Unread: false,
		})

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "user"})

		body := map[string]string{"type": "d6", "conversation_id": convID, "profile_id": profileID}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/messages/roll-dice", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")

		handleRollDice(c)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200, got %d", w.Code)
		}

		s1, _ := mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(profileID+"_"+convID).Get(context.Background())
		s2, _ := mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(otherID+"_"+convID).Get(context.Background())

		if s1.Data()["unread"] != false {
			t.Errorf("Roller unread should be false, got %v", s1.Data()["unread"])
		}
		if s2.Data()["unread"] != true {
			t.Errorf("Other participant unread should be true, got %v", s2.Data()["unread"])
		}
	})
}

func TestRollDieDistribution(t *testing.T) {
	// Verify rollDie produces values in the correct range across many rolls
	for diceType, maxVal := range ValidDiceTypes {
		t.Run(diceType, func(t *testing.T) {
			for i := 0; i < 100; i++ {
				result := rollDie(maxVal)
				if result < 1 || result > maxVal {
					t.Fatalf("rollDie(%d) = %d, want 1..%d", maxVal, result, maxVal)
				}
			}
		})
	}
}
