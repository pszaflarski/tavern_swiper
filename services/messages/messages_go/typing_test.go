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

func TestFilterTypingMap(t *testing.T) {
	skipIfRealDB(t)

	fixedNow := time.Date(2026, 5, 29, 12, 0, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	t.Run("NilWhenNoTypingField", func(t *testing.T) {
		data := map[string]interface{}{
			"id": "conv1",
		}
		result := filterTypingMap(data)
		if result != nil {
			t.Errorf("Expected nil, got %v", result)
		}
	})

	t.Run("NilWhenTypingIsEmpty", func(t *testing.T) {
		data := map[string]interface{}{
			"typing": map[string]interface{}{},
		}
		result := filterTypingMap(data)
		if result != nil {
			t.Errorf("Expected nil, got %v", result)
		}
	})

	t.Run("ReturnsActiveTypers", func(t *testing.T) {
		recent := fixedNow.Add(-3 * time.Second).Format(time.RFC3339)
		data := map[string]interface{}{
			"typing": map[string]interface{}{
				"profile_a": recent,
			},
		}
		result := filterTypingMap(data)
		if result == nil {
			t.Fatal("Expected non-nil result")
		}
		if _, ok := result["profile_a"]; !ok {
			t.Error("Expected profile_a in result")
		}
	})

	t.Run("FiltersExpiredTypers", func(t *testing.T) {
		stale := fixedNow.Add(-typingTTL - 5*time.Second).Format(time.RFC3339)
		data := map[string]interface{}{
			"typing": map[string]interface{}{
				"profile_stale": stale,
			},
		}
		result := filterTypingMap(data)
		if result != nil {
			t.Errorf("Expected nil for expired typing, got %v", result)
		}
	})

	t.Run("MixedActiveAndExpired", func(t *testing.T) {
		recent := fixedNow.Add(-2 * time.Second).Format(time.RFC3339)
		stale := fixedNow.Add(-typingTTL - 10*time.Second).Format(time.RFC3339)
		data := map[string]interface{}{
			"typing": map[string]interface{}{
				"active_user": recent,
				"stale_user":  stale,
			},
		}
		result := filterTypingMap(data)
		if result == nil {
			t.Fatal("Expected non-nil result")
		}
		if len(result) != 1 {
			t.Errorf("Expected 1 active typer, got %d", len(result))
		}
		if _, ok := result["active_user"]; !ok {
			t.Error("Expected active_user in result")
		}
		if _, ok := result["stale_user"]; ok {
			t.Error("stale_user should have been filtered out")
		}
	})

	t.Run("HandlesTimeTypeDirectly", func(t *testing.T) {
		// Firestore returns time.Time values, not strings
		recent := fixedNow.Add(-1 * time.Second)
		data := map[string]interface{}{
			"typing": map[string]interface{}{
				"profile_a": recent,
			},
		}
		result := filterTypingMap(data)
		if result == nil {
			t.Fatal("Expected non-nil result for time.Time value")
		}
		if _, ok := result["profile_a"]; !ok {
			t.Error("Expected profile_a in result")
		}
	})

	t.Run("BoundaryAtExactTTL", func(t *testing.T) {
		// Exactly at 10s boundary should still be included (<=)
		atBoundary := fixedNow.Add(-10 * time.Second).Format(time.RFC3339)
		data := map[string]interface{}{
			"typing": map[string]interface{}{
				"boundary_user": atBoundary,
			},
		}
		result := filterTypingMap(data)
		if result == nil {
			t.Fatal("Expected non-nil result at exact TTL boundary")
		}
	})
}

func TestHandleTyping(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)

	t.Run("SetsTypingState", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		// Inject mock profiles client
		oldPC := profilesClient
		profilesClient = &mockProfilesClient{
			GetProfileFunc: func(profileID string, token string) (*ProfileInfo, error) {
				return &ProfileInfo{ProfileID: profileID, UserID: "test-uid"}, nil
			},
		}
		defer func() { profilesClient = oldPC }()

		convID := "conv_typing"
		profileID := "p1"

		// Setup conversation and participant mapping
		mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), map[string]interface{}{
			"id":              convID,
			"participant_ids": []interface{}{"p1", "p2"},
		})
		mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(profileID+"_"+convID).Set(context.Background(), ProfileConversation{
			ProfileID: profileID, ConversationID: convID,
		})

		// Use a router so gin properly flushes the 204 status header
		r := gin.New()
		r.Use(func(c *gin.Context) {
			c.Set("auth", AuthData{UID: "test-uid", Role: "user"})
			c.Next()
		})
		r.POST("/conversations/:id/typing", handleTyping)

		body := map[string]string{"profile_id": profileID}
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest("POST", "/conversations/"+convID+"/typing", bytes.NewBuffer(b))
		req.Header.Set("Content-Type", "application/json")

		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusNoContent {
			t.Errorf("Expected 204, got %d. Body: %s", w.Code, w.Body.String())
		}

		// Verify typing field was set on conversation doc
		convSnap, _ := mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Get(context.Background())
		data := convSnap.Data()
		typingMap, ok := data["typing"].(map[string]interface{})
		if !ok {
			t.Fatal("Expected typing map on conversation doc")
		}
		if _, exists := typingMap[profileID]; !exists {
			t.Error("Expected profile_id in typing map")
		}
	})

	t.Run("RejectsMissingProfileID", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "user"})
		c.Params = []gin.Param{{Key: "id", Value: "conv123"}}

		body := map[string]string{}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/conversations/conv123/typing", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")

		handleTyping(c)

		if w.Code != http.StatusBadRequest {
			t.Errorf("Expected 400, got %d", w.Code)
		}
	})

	t.Run("RejectsNonParticipant", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		oldPC := profilesClient
		profilesClient = &mockProfilesClient{
			GetProfileFunc: func(profileID string, token string) (*ProfileInfo, error) {
				return &ProfileInfo{ProfileID: profileID, UserID: "test-uid"}, nil
			},
		}
		defer func() { profilesClient = oldPC }()

		convID := "conv_typing2"

		// No participant mapping exists for this profile
		mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), map[string]interface{}{
			"id": convID,
		})

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{UID: "test-uid", Role: "user"})
		c.Params = []gin.Param{{Key: "id", Value: convID}}

		body := map[string]string{"profile_id": "p_stranger"}
		b, _ := json.Marshal(body)
		c.Request, _ = http.NewRequest("POST", "/conversations/"+convID+"/typing", bytes.NewBuffer(b))
		c.Request.Header.Set("Content-Type", "application/json")

		handleTyping(c)

		if w.Code != http.StatusForbidden {
			t.Errorf("Expected 403, got %d. Body: %s", w.Code, w.Body.String())
		}
	})
}

func TestSendMessageClearsTyping(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)

	mock := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mock, nil
	}

	oldPC := profilesClient
	profilesClient = &mockProfilesClient{
		GetProfileFunc: func(profileID string, token string) (*ProfileInfo, error) {
			return &ProfileInfo{ProfileID: profileID, UserID: "test-uid"}, nil
		},
	}
	defer func() { profilesClient = oldPC }()

	convID := "conv_clear"
	senderID := "p1"

	// Setup conversation with an active typing indicator
	mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), map[string]interface{}{
		"id":              convID,
		"participant_ids": []interface{}{senderID, "p2"},
		"typing": map[string]interface{}{
			senderID: time.Now().UTC().Format(time.RFC3339),
		},
	})
	mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(senderID+"_"+convID).Set(context.Background(), ProfileConversation{
		ProfileID: senderID, ConversationID: convID,
	})
	mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc("p2_"+convID).Set(context.Background(), ProfileConversation{
		ProfileID: "p2", ConversationID: convID,
	})

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("auth", AuthData{UID: "test-uid", Role: "user"})
	c.Params = []gin.Param{{Key: "id", Value: convID}}

	body := MessageCreate{SenderProfileID: senderID, Content: "Hello!"}
	b, _ := json.Marshal(body)
	c.Request, _ = http.NewRequest("POST", "/conversations/"+convID+"/messages", bytes.NewBuffer(b))
	c.Request.Header.Set("Content-Type", "application/json")

	handleSendMessage(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("Expected 201, got %d. Body: %s", w.Code, w.Body.String())
	}

	// Verify the typing entry was cleared
	convSnap, _ := mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Get(context.Background())
	data := convSnap.Data()

	if typingRaw, ok := data["typing"]; ok {
		if typingMap, ok := typingRaw.(map[string]interface{}); ok {
			if _, exists := typingMap[senderID]; exists {
				t.Error("Sender's typing entry should have been cleared after sending a message")
			}
		}
	}
	// If typing field is completely absent, that's also correct
}

func TestGetMessages_IncludesTypingMap(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)

	fixedNow := time.Date(2026, 5, 29, 12, 0, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	mock := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mock, nil
	}

	convID := "conv_typing_poll"

	// Setup conversation with an active typing indicator
	recentTyping := fixedNow.Add(-2 * time.Second).Format(time.RFC3339)
	mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), map[string]interface{}{
		"id":              convID,
		"participant_ids": []interface{}{"p1", "p2"},
		"typing": map[string]interface{}{
			"p2": recentTyping,
		},
	})
	mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc("p1_"+convID).Set(context.Background(), ProfileConversation{
		ProfileID: "p1", ConversationID: convID,
	})

	// Add a message so the response isn't empty
	mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Collection(COLLECTION_MESSAGES).Doc("msg1").Set(context.Background(), map[string]interface{}{
		"sent_by":    "p1",
		"content":    "Hey there",
		"type":       "user",
		"created_at": fixedNow.Add(-1 * time.Minute),
	})

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("auth", AuthData{Role: "admin"})
	c.Params = []gin.Param{{Key: "id", Value: convID}}
	c.Request, _ = http.NewRequest("GET", "/conversations/"+convID+"/messages?limit=50", nil)

	handleGetMessages(c)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var resp PaginatedMessagesResponse
	json.Unmarshal(w.Body.Bytes(), &resp)

	if resp.Typing == nil {
		t.Fatal("Expected typing map in response")
	}
	if _, ok := resp.Typing["p2"]; !ok {
		t.Error("Expected p2 in typing map")
	}
}

func TestGetMessages_ExcludesExpiredTyping(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)

	fixedNow := time.Date(2026, 5, 29, 12, 0, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	mock := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mock, nil
	}

	convID := "conv_typing_expired"

	staleTyping := fixedNow.Add(-typingTTL - 10*time.Second).Format(time.RFC3339)
	mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), map[string]interface{}{
		"id":              convID,
		"participant_ids": []interface{}{"p1", "p2"},
		"typing": map[string]interface{}{
			"p2": staleTyping,
		},
	})
	mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc("p1_"+convID).Set(context.Background(), ProfileConversation{
		ProfileID: "p1", ConversationID: convID,
	})

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("auth", AuthData{Role: "admin"})
	c.Params = []gin.Param{{Key: "id", Value: convID}}
	c.Request, _ = http.NewRequest("GET", "/conversations/"+convID+"/messages?limit=50", nil)

	handleGetMessages(c)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", w.Code)
	}

	var resp PaginatedMessagesResponse
	json.Unmarshal(w.Body.Bytes(), &resp)

	if resp.Typing != nil {
		t.Errorf("Expected nil typing for expired entries, got %v", resp.Typing)
	}
}

func TestListConversations_IncludesTyping(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)

	fixedNow := time.Date(2026, 5, 29, 12, 0, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	mock := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mock, nil
	}

	oldPC := profilesClient
	profilesClient = &mockProfilesClient{
		GetProfileFunc: func(profileID string, token string) (*ProfileInfo, error) {
			return &ProfileInfo{ProfileID: profileID, UserID: "test-uid"}, nil
		},
	}
	defer func() { profilesClient = oldPC }()

	convID := "conv_list_typing"
	profileID := "p1"
	recentTyping := fixedNow.Add(-3 * time.Second).Format(time.RFC3339)

	mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), map[string]interface{}{
		"id":              convID,
		"participant_ids": []interface{}{"p1", "p2"},
		"updated_at":      fixedNow,
		"last_message_id": "msg1", "last_message_text": "Hello",
		"last_message_sent_at": fixedNow, "last_message_type": "user",
		"typing": map[string]interface{}{
			"p2": recentTyping,
		},
	})
	mock.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(profileID+"_"+convID).Set(context.Background(), ProfileConversation{
		ProfileID: profileID, ConversationID: convID,
	})

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("auth", AuthData{UID: "test-uid", Role: "user"})
	c.Params = []gin.Param{{Key: "profile_id", Value: profileID}}

	handleListConversations(c)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var resp []ConversationOut
	json.Unmarshal(w.Body.Bytes(), &resp)

	if len(resp) != 1 {
		t.Fatalf("Expected 1 conversation, got %d", len(resp))
	}

	if resp[0].Typing == nil {
		t.Fatal("Expected typing map in conversation list response")
	}
	if _, ok := resp[0].Typing["p2"]; !ok {
		t.Error("Expected p2 in typing map")
	}
}
