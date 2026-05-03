package main

import (
	"tavern-swiper.app/firestoreutil"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestEdgeCaseProtections(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)
	mock := &mockClient{}
	getDBFunc = func(ctx context.Context) (firestoreutil.FirestoreClient, error) { return mock, nil }

	t.Run("CreateConversation_SelfMessaging", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		
		body := ConversationCreate{ParticipantProfileIDs: []string{"hero1", "hero1"}}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/conversations", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")
		
		handleCreateConversation(c)
		
		if w.Code != http.StatusUnprocessableEntity {
			t.Errorf("Expected 422 for self-messaging, got %d", w.Code)
		}
	})

	t.Run("CreateConversation_InvalidParticipantCount", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		
		body := ConversationCreate{ParticipantProfileIDs: []string{"hero1", "hero2", "hero3"}}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/conversations", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")
		
		handleCreateConversation(c)
		
		if w.Code != http.StatusUnprocessableEntity {
			t.Errorf("Expected 422 for 3 participants, got %d", w.Code)
		}
	})

	t.Run("SendMessage_EmptyOrWhitespace", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Params = []gin.Param{{Key: "id", Value: "c1"}}
		
		body := MessageCreate{SenderProfileID: "p1", Content: "   "}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/conversations/c1/messages", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")
		
		handleSendMessage(c)
		
		if w.Code != http.StatusUnprocessableEntity {
			t.Errorf("Expected 422 for whitespace message, got %d", w.Code)
		}
	})

	t.Run("SendMessage_MaxLength", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Params = []gin.Param{{Key: "id", Value: "c1"}}
		
		longContent := strings.Repeat("a", 2001)
		body := MessageCreate{SenderProfileID: "p1", Content: longContent}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/conversations/c1/messages", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")
		
		handleSendMessage(c)
		
		if w.Code != http.StatusUnprocessableEntity {
			t.Errorf("Expected 422 for excessively long message, got %d", w.Code)
		}
	})
}
