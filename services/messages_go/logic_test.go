package main

import (
	"tavern-swiper.app/firestoreutil"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestUniquenessKeyGeneration(t *testing.T) {
	skipIfRealDB(t)
	pids := []string{"hero456", "hero123"}
	sort.Strings(pids)
	key := strings.Join(pids, "_")
	if key != "hero123_hero456" {
		t.Errorf("Expected hero123_hero456, got %s", key)
	}
}

func TestHandleCreateConversation(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)
	
	t.Run("AllowInitializationWithMatch", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (firestoreutil.FirestoreClient, error) {
			return mock, nil
		}
		
		// Inject match into cache with deterministic ID
		matchID := "match_p1_p2"
		mock.Collection(COLLECTION_CACHE).Doc(matchID).Set(context.Background(), map[string]interface{}{
			"profile_ids": []interface{}{"p1", "p2"},
		})
		
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		
		body := ConversationCreate{ParticipantProfileIDs: []string{"p1", "p2"}}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/conversations", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")
		
		handleCreateConversation(c)
		
		if w.Code != http.StatusCreated {
			t.Errorf("Expected 201, got %d. Body: %s", w.Code, w.Body.String())
		}
		
		var resp map[string]string
		json.Unmarshal(w.Body.Bytes(), &resp)
		convID := resp["conversation_id"]
		
		// Verify conversation doc
		convSnap, _ := mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Get(context.Background())
		if !convSnap.Exists() {
			t.Fatal("Conversation document was not created")
		}
		
		// Verify mappings
		m1, _ := mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc("p1_" + convID).Get(context.Background())
		m2, _ := mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc("p2_" + convID).Get(context.Background())
		if !m1.Exists() || !m2.Exists() {
			t.Error("Mappings were not created correctly")
		}
	})

	t.Run("ForbiddenWithoutMatch", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (firestoreutil.FirestoreClient, error) {
			return mock, nil
		}
		
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		
		body := ConversationCreate{ParticipantProfileIDs: []string{"unmatched1", "unmatched2"}}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/conversations", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")
		
		handleCreateConversation(c)
		
		if w.Code != http.StatusForbidden {
			t.Errorf("Expected 403, got %d", w.Code)
		}
	})
}

func TestHandleSendMessage(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)
	
	t.Run("SuccessAndDenormalization", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (firestoreutil.FirestoreClient, error) {
			return mock, nil
		}
		
		convID := "conv123"
		senderID := "p1"
		
		// Setup conversation and mapping
		mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), Conversation{ID: convID})
		mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(senderID+"_"+convID).Set(context.Background(), ProfileConversation{
			ProfileID: senderID, ConversationID: convID,
		})
		
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Params = []gin.Param{{Key: "id", Value: convID}}
		
		body := MessageCreate{SenderProfileID: senderID, Content: "Hello World"}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/conversations/"+convID+"/messages", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")
		
		handleSendMessage(c)
		
		if w.Code != http.StatusCreated {
			t.Errorf("Expected 201, got %d. Body: %s", w.Code, w.Body.String())
		}
		
		// Verify denormalization on parent
		convSnap, _ := mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Get(context.Background())
		data := convSnap.Data()
		if data["last_message_text"] != "Hello World" {
			t.Errorf("Denormalization failed, expected 'Hello World', got %v", data["last_message_text"])
		}
		
		// Verify message in sub-collection
		msgIter := mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Collection(COLLECTION_MESSAGES).Documents(context.Background())
		msgs, _ := msgIter.GetAll()
		if len(msgs) != 1 {
			t.Errorf("Expected 1 message in sub-collection, got %d", len(msgs))
		}
	})
}

func TestHandleListConversations(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)
	
	t.Run("OrderedListing", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (firestoreutil.FirestoreClient, error) {
			return mock, nil
		}
		
		profileID := "p1"
		
		// Create two conversations
		c1 := "conv1"
		c2 := "conv2"
		now := time.Now()
		
		mock.Collection(COLLECTION_CONVERSATIONS).Doc(c1).Set(context.Background(), map[string]interface{}{
			"id": c1, "updated_at": now.Add(-1 * time.Hour), "participant_ids": []interface{}{"p1", "p2"},
		})
		mock.Collection(COLLECTION_CONVERSATIONS).Doc(c2).Set(context.Background(), map[string]interface{}{
			"id": c2, "updated_at": now, "participant_ids": []interface{}{"p1", "p3"},
		})
		
		mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc("p1_"+c1).Set(context.Background(), ProfileConversation{ProfileID: "p1", ConversationID: c1})
		mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc("p1_"+c2).Set(context.Background(), ProfileConversation{ProfileID: "p1", ConversationID: c2})
		
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Params = []gin.Param{{Key: "profile_id", Value: profileID}}
		
		handleListConversations(c)
		
		var resp []ConversationOut
		json.Unmarshal(w.Body.Bytes(), &resp)
		
		if len(resp) != 2 {
			t.Fatalf("Expected 2 conversations, got %d", len(resp))
		}
		
		// Verify order (c2 should be first as it is newer)
		if resp[0].ID != c2 {
			t.Errorf("Expected first conversation to be %s, got %s", c2, resp[0].ID)
		}
	})
}
