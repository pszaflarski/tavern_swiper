package main

import (
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
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}
		
		// Inject match into cache with deterministic ID
		matchID := "match_p1_p2"
		mock.Collection(COLLECTION_CACHE).Doc(matchID).Set(context.Background(), map[string]interface{}{
			"profile_ids": []interface{}{"p1", "p2"},
		})
		
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "admin"})
		
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

		// Verify welcome system message was created
		convData := convSnap.Data()
		if convData["last_message_id"] == nil || convData["last_message_id"] == "" {
			t.Error("Expected last_message_id to be set on new conversation (welcome message)")
		}
		if convData["last_message_type"] != MessageTypeSystem {
			t.Errorf("Expected last_message_type '%s', got '%v'", MessageTypeSystem, convData["last_message_type"])
		}
		if convData["last_message_text"] != "A fateful bond has been forged." {
			t.Errorf("Expected welcome message text, got '%v'", convData["last_message_text"])
		}

		// Verify the message exists in the sub-collection
		msgIter := mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Collection(COLLECTION_MESSAGES).Documents(context.Background())
		msgs, _ := msgIter.GetAll()
		if len(msgs) != 1 {
			t.Fatalf("Expected 1 welcome message in sub-collection, got %d", len(msgs))
		}
		msgData := msgs[0].Data()
		if msgData["type"] != MessageTypeSystem {
			t.Errorf("Welcome message type should be '%s', got '%v'", MessageTypeSystem, msgData["type"])
		}
	})

	t.Run("ForbiddenWithoutMatch", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}
		
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "admin"})
		
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
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
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
		c.Set("auth", AuthData{Role: "admin"})
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
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}
		
		profileID := "p1"
		
		// Create two conversations
		c1 := "conv1"
		c2 := "conv2"
		now := time.Now()
		
		mock.Collection(COLLECTION_CONVERSATIONS).Doc(c1).Set(context.Background(), map[string]interface{}{
			"id": c1, "updated_at": now.Add(-1 * time.Hour), "participant_ids": []interface{}{"p1", "p2"},
			"last_message_id": "msg1", "last_message_text": "Hello",
			"last_message_sent_at": now.Add(-1 * time.Hour), "last_message_type": "user",
		})
		mock.Collection(COLLECTION_CONVERSATIONS).Doc(c2).Set(context.Background(), map[string]interface{}{
			"id": c2, "updated_at": now, "participant_ids": []interface{}{"p1", "p3"},
			"last_message_id": "msg2", "last_message_text": "Hey there",
			"last_message_sent_at": now, "last_message_type": "user",
		})
		
		mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc("p1_"+c1).Set(context.Background(), ProfileConversation{ProfileID: "p1", ConversationID: c1})
		mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc("p1_"+c2).Set(context.Background(), ProfileConversation{ProfileID: "p1", ConversationID: c2})
		
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "admin"})
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

func TestHandleSendSystemMessage(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)

	t.Run("AdminCanSendSystemMessage", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		convID := "conv123"

		// Setup conversation (system sender is NOT a participant)
		mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), map[string]interface{}{
			"id":              convID,
			"participant_ids": []interface{}{"p1", "p2"},
		})

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "admin"})
		c.Params = []gin.Param{{Key: "id", Value: convID}}

		body := map[string]string{"content": "It started to rain", "type": "system"}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/conversations/"+convID+"/messages", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")

		handleSendMessage(c)

		if w.Code != http.StatusCreated {
			t.Errorf("Expected 201, got %d. Body: %s", w.Code, w.Body.String())
		}

		var resp MessageOut
		json.Unmarshal(w.Body.Bytes(), &resp)

		if resp.Type != "system" {
			t.Errorf("Expected type 'system', got '%s'", resp.Type)
		}
		if resp.SenderProfileID != "" {
			t.Errorf("Expected empty sender_profile_id for system message, got '%s'", resp.SenderProfileID)
		}
		if resp.Content != "It started to rain" {
			t.Errorf("Expected content 'It started to rain', got '%s'", resp.Content)
		}

		// Verify denormalization on parent includes type
		convSnap, _ := mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Get(context.Background())
		data := convSnap.Data()
		if data["last_message_type"] != "system" {
			t.Errorf("Denormalized last_message_type should be 'system', got %v", data["last_message_type"])
		}
		if data["last_message_sender_id"] != "" {
			t.Errorf("Denormalized last_message_sender_id should be empty for system, got %v", data["last_message_sender_id"])
		}
	})

	t.Run("AdminCanSendEventMessage", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		convID := "conv456"
		mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), map[string]interface{}{
			"id":              convID,
			"participant_ids": []interface{}{"p1", "p2"},
		})

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "root_admin"})
		c.Params = []gin.Param{{Key: "id", Value: convID}}

		body := map[string]string{"content": "A mysterious stranger appeared", "type": "event"}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/conversations/"+convID+"/messages", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")

		handleSendMessage(c)

		if w.Code != http.StatusCreated {
			t.Errorf("Expected 201, got %d. Body: %s", w.Code, w.Body.String())
		}

		var resp MessageOut
		json.Unmarshal(w.Body.Bytes(), &resp)
		if resp.Type != "event" {
			t.Errorf("Expected type 'event', got '%s'", resp.Type)
		}
	})

	t.Run("NonAdminRejectedForSystemMessage", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		convID := "conv789"

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "user"})
		c.Params = []gin.Param{{Key: "id", Value: convID}}

		body := map[string]string{"content": "Trying to be system", "type": "system"}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/conversations/"+convID+"/messages", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")

		handleSendMessage(c)

		if w.Code != http.StatusForbidden {
			t.Errorf("Expected 403, got %d. Body: %s", w.Code, w.Body.String())
		}
	})

	t.Run("InvalidTypeRejected", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "admin"})
		c.Params = []gin.Param{{Key: "id", Value: "conv123"}}

		body := map[string]string{"content": "Bad type", "type": "announcement"}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/conversations/conv123/messages", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")

		handleSendMessage(c)

		if w.Code != http.StatusUnprocessableEntity {
			t.Errorf("Expected 422, got %d", w.Code)
		}
	})

	t.Run("UserMessageWithoutSenderRejected", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "user"})
		c.Params = []gin.Param{{Key: "id", Value: "conv123"}}

		// type defaults to "user", no sender_profile_id
		body := map[string]string{"content": "No sender"}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/conversations/conv123/messages", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")

		handleSendMessage(c)

		if w.Code != http.StatusUnprocessableEntity {
			t.Errorf("Expected 422, got %d. Body: %s", w.Code, w.Body.String())
		}
	})

	t.Run("DefaultTypeIsUser", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		// Inject mock profiles client for ownership verification
		oldPC := profilesClient
		profilesClient = &mockProfilesClient{
			GetProfileFunc: func(profileID string, token string) (*ProfileInfo, error) {
				return &ProfileInfo{ProfileID: profileID, UserID: "test-uid"}, nil
			},
		}
		defer func() { profilesClient = oldPC }()

		convID := "conv_default"
		senderID := "p1"

		mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), Conversation{ID: convID})
		mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(senderID+"_"+convID).Set(context.Background(), ProfileConversation{
			ProfileID: senderID, ConversationID: convID,
		})

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{UID: "test-uid", Role: "user"})
		c.Params = []gin.Param{{Key: "id", Value: convID}}

		// No type field — should default to "user"
		body := map[string]string{"content": "Hello", "sender_profile_id": senderID}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/conversations/"+convID+"/messages", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")

		handleSendMessage(c)

		if w.Code != http.StatusCreated {
			t.Errorf("Expected 201, got %d. Body: %s", w.Code, w.Body.String())
		}

		var resp MessageOut
		json.Unmarshal(w.Body.Bytes(), &resp)
		if resp.Type != "user" {
			t.Errorf("Expected default type 'user', got '%s'", resp.Type)
		}
	})

	t.Run("SystemMessageAppearsInGetMessages", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		convID := "conv_with_system"
		now := time.Now()

		// Create conversation
		mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), map[string]interface{}{
			"id":              convID,
			"participant_ids": []interface{}{"p1", "p2"},
		})

		// Add a user message and a system message to the sub-collection
		mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Collection(COLLECTION_MESSAGES).Doc("msg1").Set(context.Background(), map[string]interface{}{
			"sent_by":    "p1",
			"content":    "Hello there",
			"type":       "user",
			"created_at": now,
		})
		mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Collection(COLLECTION_MESSAGES).Doc("msg2").Set(context.Background(), map[string]interface{}{
			"content":    "A thunderstorm rolls in",
			"type":       "system",
			"created_at": now.Add(1 * time.Minute),
		})

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "admin"})
		c.Params = []gin.Param{{Key: "id", Value: convID}}
		c.Request, _ = http.NewRequest("GET", "/conversations/"+convID+"/messages", nil)

		handleGetMessages(c)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
		}

		var msgs []MessageOut
		json.Unmarshal(w.Body.Bytes(), &msgs)

		if len(msgs) != 2 {
			t.Fatalf("Expected 2 messages, got %d", len(msgs))
		}

		// First message should be user type
		if msgs[0].Type != "user" {
			t.Errorf("Expected first message type 'user', got '%s'", msgs[0].Type)
		}
		if msgs[0].SenderProfileID != "p1" {
			t.Errorf("Expected first message sender 'p1', got '%s'", msgs[0].SenderProfileID)
		}

		// Second message should be system type with no sender
		if msgs[1].Type != "system" {
			t.Errorf("Expected second message type 'system', got '%s'", msgs[1].Type)
		}
		if msgs[1].SenderProfileID != "" {
			t.Errorf("Expected empty sender for system message, got '%s'", msgs[1].SenderProfileID)
		}
		if msgs[1].Content != "A thunderstorm rolls in" {
			t.Errorf("Expected system message content, got '%s'", msgs[1].Content)
		}
	})
}


func TestHandleSendMessage_UnreadFlag(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)
	
	mock := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mock, nil
	}

	// Inject mock profiles client for ownership verification
	oldPC := profilesClient
	profilesClient = &mockProfilesClient{
		GetProfileFunc: func(profileID string, token string) (*ProfileInfo, error) {
			return &ProfileInfo{ProfileID: profileID, UserID: "test-uid"}, nil
		},
	}
	defer func() { profilesClient = oldPC }()
	
	convID := "conv123"
	senderID := "p1"
	otherID := "p2"
	
	mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), Conversation{ID: convID, ParticipantIDs: []string{senderID, otherID}})
	mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(senderID+"_"+convID).Set(context.Background(), ProfileConversation{
		ProfileID: senderID, ConversationID: convID, Unread: true,
	})
	mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(otherID+"_"+convID).Set(context.Background(), ProfileConversation{
		ProfileID: otherID, ConversationID: convID, Unread: false,
	})
	
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("auth", AuthData{UID: "test-uid", Role: "user"})
	c.Params = []gin.Param{{Key: "id", Value: convID}}
	
	body := MessageCreate{SenderProfileID: senderID, Content: "Hello"}
	b, _ := json.Marshal(body)
	c.Request, _ = http.NewRequest("POST", "/conversations/"+convID+"/messages", bytes.NewBuffer(b))
	c.Request.Header.Set("Content-Type", "application/json")
	
	handleSendMessage(c)
	
	if w.Code != http.StatusCreated {
		t.Errorf("Expected 201, got %d. Body: %s", w.Code, w.Body.String())
	}
	
	s1, _ := mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(senderID+"_"+convID).Get(context.Background())
	s2, _ := mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(otherID+"_"+convID).Get(context.Background())
	
	if s1.Data()["unread"] != false {
		t.Errorf("Sender unread should be false, got %v", s1.Data()["unread"])
	}
	if s2.Data()["unread"] != true {
		t.Errorf("Other unread should be true, got %v", s2.Data()["unread"])
	}
}

func TestHandleGetMessages_ImplicitMarkRead(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)
	
	mock := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mock, nil
	}
	
	convID := "conv123"
	profileID := "p1"
	
	mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), map[string]interface{}{
		"id": convID,
		"participant_ids": []interface{}{profileID, "p2"},
	})
	mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(profileID+"_"+convID).Set(context.Background(), ProfileConversation{
		ProfileID: profileID, ConversationID: convID, Unread: true,
	})
	
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("auth", AuthData{Role: "user"})
	c.Params = []gin.Param{{Key: "id", Value: convID}}
	c.Request, _ = http.NewRequest("GET", "/conversations/"+convID+"/messages?profile_id="+profileID, nil)
	
	handleGetMessages(c)
	
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	
	s1, _ := mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(profileID+"_"+convID).Get(context.Background())
	if s1.Data()["unread"] != false {
		t.Errorf("Profile unread should be false after get, got %v", s1.Data()["unread"])
	}
}

func TestHandleListConversations_SurfacesUnread(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)
	
	mock := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mock, nil
	}

	// Inject mock profiles client for ownership verification
	oldPC := profilesClient
	profilesClient = &mockProfilesClient{
		GetProfileFunc: func(profileID string, token string) (*ProfileInfo, error) {
			return &ProfileInfo{ProfileID: profileID, UserID: "test-uid"}, nil
		},
	}
	defer func() { profilesClient = oldPC }()
	
	profileID := "p1"
	c1 := "conv1"
	c2 := "conv2"
	
	mock.Collection(COLLECTION_CONVERSATIONS).Doc(c1).Set(context.Background(), map[string]interface{}{
		"id": c1, "participant_ids": []interface{}{"p1", "p2"},
		"last_message_id": "msg1", "last_message_text": "Hello",
		"last_message_sent_at": time.Now(), "last_message_type": "user",
	})
	mock.Collection(COLLECTION_CONVERSATIONS).Doc(c2).Set(context.Background(), map[string]interface{}{
		"id": c2, "participant_ids": []interface{}{"p1", "p3"},
		"last_message_id": "msg2", "last_message_text": "Hi",
		"last_message_sent_at": time.Now(), "last_message_type": "user",
	})
	
	mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc("p1_"+c1).Set(context.Background(), ProfileConversation{
		ProfileID: "p1", ConversationID: c1, Unread: true,
	})
	// For c2, do not set Unread to test default false
	mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc("p1_"+c2).Set(context.Background(), map[string]interface{}{
		"profile_id": "p1", "conversation_id": c2, "role": "participant",
	})
	
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("auth", AuthData{UID: "test-uid", Role: "user"})
	c.Params = []gin.Param{{Key: "profile_id", Value: profileID}}
	
	handleListConversations(c)
	
	var resp []ConversationOut
	json.Unmarshal(w.Body.Bytes(), &resp)
	
	if len(resp) != 2 {
		t.Fatalf("Expected 2 conversations, got %d", len(resp))
	}
	
	var unreadC1, unreadC2 bool
	for _, conv := range resp {
		if conv.ID == c1 {
			unreadC1 = conv.Unread
		} else if conv.ID == c2 {
			unreadC2 = conv.Unread
		}
	}
	
	if !unreadC1 {
		t.Errorf("Expected c1 to be unread")
	}
	if unreadC2 {
		t.Errorf("Expected c2 to default to false for unread")
	}
}

func TestHandleListConversations_EmptyConversationsFiltered(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)

	mock := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mock, nil
	}

	profileID := "p1"
	now := time.Now()

	// Conversation WITH a message (should appear)
	mock.Collection(COLLECTION_CONVERSATIONS).Doc("conv_with_msg").Set(context.Background(), map[string]interface{}{
		"id": "conv_with_msg", "participant_ids": []interface{}{"p1", "p2"},
		"updated_at": now, "last_message_id": "msg1", "last_message_text": "Hello",
		"last_message_sent_at": now, "last_message_type": "user",
	})
	// Conversation WITHOUT a message (should be filtered out)
	mock.Collection(COLLECTION_CONVERSATIONS).Doc("conv_empty").Set(context.Background(), map[string]interface{}{
		"id": "conv_empty", "participant_ids": []interface{}{"p1", "p3"},
		"updated_at": now,
	})
	// Another conversation WITH a message (should appear)
	mock.Collection(COLLECTION_CONVERSATIONS).Doc("conv_with_msg2").Set(context.Background(), map[string]interface{}{
		"id": "conv_with_msg2", "participant_ids": []interface{}{"p1", "p4"},
		"updated_at": now.Add(-1 * time.Hour), "last_message_id": "msg2", "last_message_text": "Hey",
		"last_message_sent_at": now.Add(-1 * time.Hour), "last_message_type": "user",
	})

	mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc("p1_conv_with_msg").Set(context.Background(), ProfileConversation{
		ProfileID: "p1", ConversationID: "conv_with_msg",
	})
	mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc("p1_conv_empty").Set(context.Background(), ProfileConversation{
		ProfileID: "p1", ConversationID: "conv_empty",
	})
	mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc("p1_conv_with_msg2").Set(context.Background(), ProfileConversation{
		ProfileID: "p1", ConversationID: "conv_with_msg2",
	})

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("auth", AuthData{Role: "admin"})
	c.Params = []gin.Param{{Key: "profile_id", Value: profileID}}

	handleListConversations(c)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var resp []ConversationOut
	json.Unmarshal(w.Body.Bytes(), &resp)

	if len(resp) != 2 {
		t.Fatalf("Expected 2 conversations (empty one filtered), got %d", len(resp))
	}

	// Verify the empty one is not in results
	for _, conv := range resp {
		if conv.ID == "conv_empty" {
			t.Error("Empty conversation should have been filtered from listing")
		}
	}
}

func TestHandleListConversations_AllEmptyReturnsEmptyArray(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)

	mock := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mock, nil
	}

	profileID := "p1"

	// Two conversations, both empty (no messages)
	mock.Collection(COLLECTION_CONVERSATIONS).Doc("empty1").Set(context.Background(), map[string]interface{}{
		"id": "empty1", "participant_ids": []interface{}{"p1", "p2"},
	})
	mock.Collection(COLLECTION_CONVERSATIONS).Doc("empty2").Set(context.Background(), map[string]interface{}{
		"id": "empty2", "participant_ids": []interface{}{"p1", "p3"},
	})

	mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc("p1_empty1").Set(context.Background(), ProfileConversation{
		ProfileID: "p1", ConversationID: "empty1",
	})
	mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc("p1_empty2").Set(context.Background(), ProfileConversation{
		ProfileID: "p1", ConversationID: "empty2",
	})

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("auth", AuthData{Role: "admin"})
	c.Params = []gin.Param{{Key: "profile_id", Value: profileID}}

	handleListConversations(c)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var resp []ConversationOut
	json.Unmarshal(w.Body.Bytes(), &resp)

	if len(resp) != 0 {
		t.Errorf("Expected 0 conversations when all are empty, got %d", len(resp))
	}
}
