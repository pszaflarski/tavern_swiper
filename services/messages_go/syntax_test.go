package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"bytes"
	"encoding/json"

	"github.com/gin-gonic/gin"
)

func TestFirestoreSyntax(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)

	t.Run("VerifyArrayContainsOperator", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		// Setup match in cache with deterministic ID
		p1, p2 := "syntax_p1", "syntax_p2"
		matchID := "match_syntax_p1_syntax_p2"
		mock.Collection(COLLECTION_CACHE).Doc(matchID).Set(context.Background(), map[string]interface{}{
			"profile_ids": []string{p1, p2},
		})

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		
		body := ConversationCreate{ParticipantProfileIDs: []string{p1, p2}}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/conversations", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")

		handleCreateConversation(c)

		if w.Code != http.StatusCreated {
			t.Errorf("Expected 201 Created with correct syntax, got %d. Body: %s", w.Code, w.Body.String())
		}
	})
}
