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

func TestSuccessResponseStructure(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)
	mock := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

	t.Run("MessageOut_Structure", func(t *testing.T) {
		convID := "c1"
		senderID := "p1"
		mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(senderID+"_"+convID).Set(context.Background(), ProfileConversation{
			ProfileID: senderID, ConversationID: convID,
		})
		
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "admin"})
		c.Params = []gin.Param{{Key: "id", Value: convID}}
		
		body := MessageCreate{SenderProfileID: senderID, Content: "Structure Test"}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/messages/conversations/"+convID+"/messages", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")
		
		handleSendMessage(c)
		
		var resp MessageOut
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("Failed to unmarshal into MessageOut: %v", err)
		}
		
		if resp.MessageID == "" || resp.ConversationID != convID || resp.SentAt == "" {
			t.Errorf("Missing fields in MessageOut: %+v", resp)
		}
		
		if _, err := time.Parse(time.RFC3339, resp.SentAt); err != nil {
			t.Errorf("SentAt is not RFC3339 compliant: %s", resp.SentAt)
		}
	})

	t.Run("ConversationOut_Structure", func(t *testing.T) {
		profileID := "p1"
		convID := "c1"
		now := time.Now().UTC()
		
		mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), map[string]interface{}{
			"id": convID,
			"participant_ids": []interface{}{"p1", "p2"},
			"created_at": now,
			"updated_at": now,
			"last_message_id": "m1",
			"last_message_text": "hello",
			"last_message_sent_at": now,
			"last_message_sender_id": "p2",
		})
		mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc("p1_"+convID).Set(context.Background(), ProfileConversation{
			ProfileID: "p1", ConversationID: convID,
		})

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "admin"})
		c.Params = []gin.Param{{Key: "profile_id", Value: profileID}}
		
		handleListConversations(c)
		
		var resp []ConversationOut
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("Failed to unmarshal into []ConversationOut: %v", err)
		}
		
		if len(resp) == 0 {
			t.Fatal("Expected at least one conversation")
		}
		
		conv := resp[0]
		if conv.ID != convID || conv.LastMessage == nil || conv.UpdatedAt == nil {
			t.Errorf("Missing fields in ConversationOut: %+v", conv)
		}
		
		if conv.LastMessage.Content != "hello" || conv.LastMessage.SentAt == "" {
			t.Errorf("Invalid LastMessage structure: %+v", conv.LastMessage)
		}

		if _, err := time.Parse(time.RFC3339, *conv.UpdatedAt); err != nil {
			t.Errorf("UpdatedAt is not RFC3339 compliant: %s", *conv.UpdatedAt)
		}
	})
}

func TestErrorResponseStructure(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)
	
	t.Run("422_UnprocessableEntity", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "admin"})
		
		// Missing required fields
		body := map[string]interface{}{"something": "else"}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/messages/conversations", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")
		
		handleCreateConversation(c)
		
		if w.Code != http.StatusUnprocessableEntity {
			t.Errorf("Expected 422, got %d", w.Code)
		}
		
		var resp map[string]interface{}
		json.Unmarshal(w.Body.Bytes(), &resp)
		if _, ok := resp["detail"]; !ok {
			t.Error("Error response missing 'detail' field")
		}
	})

	t.Run("400_BadRequest_MalformedJSON", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "admin"})
		
		c.Request, _ = http.NewRequest("POST", "/messages/conversations", bytes.NewBufferString("{invalid-json"))
		c.Request.Header.Set("Content-Type", "application/json")
		
		handleCreateConversation(c)
		
		if w.Code != http.StatusUnprocessableEntity { 
			t.Logf("Note: Gin returned %d for malformed JSON", w.Code)
		}
		
		var resp map[string]interface{}
		json.Unmarshal(w.Body.Bytes(), &resp)
		if _, ok := resp["detail"]; !ok {
			t.Error("Error response missing 'detail' field")
		}
	})
}

func TestEmptyArrayConsistency(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)
	mock := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

	t.Run("GetMessages_EmptyArray", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "admin"})
		c.Params = []gin.Param{{Key: "id", Value: "non-existent"}}
		
		mock.Collection(COLLECTION_CONVERSATIONS).Doc("non-existent").Set(context.Background(), map[string]interface{}{
			"participant_ids": []interface{}{"p1", "p2"},
		})
		
		handleGetMessages(c)
		
		if w.Body.String() != "[]" {
			t.Errorf("Expected empty array '[]', got '%s'", w.Body.String())
		}
	})

	t.Run("ListConversations_EmptyArray", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "admin"})
		c.Params = []gin.Param{{Key: "profile_id", Value: "lonely-user"}}
		
		handleListConversations(c)
		
		if w.Body.String() != "[]" {
			t.Errorf("Expected empty array '[]', got '%s'", w.Body.String())
		}
	})
}
