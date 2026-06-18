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

// TestCreateConversation_DedupPreventsRace verifies that the dedup mechanism
// prevents a second conversation from being created for the same participant
// pair. After the first creation succeeds, a second attempt should return
// the existing conversation_id (200 OK), not create a new one (201).
func TestCreateConversation_DedupPreventsRace(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)

	mock := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mock, nil
	}

	// Seed match so the creation is allowed
	matchID := "match_alice_bob"
	mock.Collection(COLLECTION_CACHE).Doc(matchID).Set(context.Background(), map[string]interface{}{
		"profile_ids": []interface{}{"alice", "bob"},
	})

	// --- First request: should create the conversation (201) ---
	w1 := httptest.NewRecorder()
	c1, _ := gin.CreateTestContext(w1)
	c1.Set("auth", AuthData{Role: "admin"})

	body := ConversationCreate{ParticipantProfileIDs: []string{"alice", "bob"}}
	b, _ := json.Marshal(body)
	c1.Request, _ = http.NewRequest("POST", "/conversations", bytes.NewBuffer(b))
	c1.Request.Header.Set("Content-Type", "application/json")

	handleCreateConversation(c1)

	if w1.Code != http.StatusCreated {
		t.Fatalf("First request: expected 201, got %d. Body: %s", w1.Code, w1.Body.String())
	}

	var resp1 map[string]string
	json.Unmarshal(w1.Body.Bytes(), &resp1)
	firstConvID := resp1["conversation_id"]
	if firstConvID == "" {
		t.Fatal("First request returned empty conversation_id")
	}

	// --- Second request: same participants, should return existing (200) ---
	w2 := httptest.NewRecorder()
	c2, _ := gin.CreateTestContext(w2)
	c2.Set("auth", AuthData{Role: "admin"})

	b2, _ := json.Marshal(body)
	c2.Request, _ = http.NewRequest("POST", "/conversations", bytes.NewBuffer(b2))
	c2.Request.Header.Set("Content-Type", "application/json")

	handleCreateConversation(c2)

	if w2.Code != http.StatusOK {
		t.Errorf("Second request: expected 200 (existing), got %d. Body: %s", w2.Code, w2.Body.String())
	}

	var resp2 map[string]string
	json.Unmarshal(w2.Body.Bytes(), &resp2)
	secondConvID := resp2["conversation_id"]

	if secondConvID != firstConvID {
		t.Errorf("Second request returned different conversation_id: %s vs %s", secondConvID, firstConvID)
	}

	// Verify only one conversation doc exists in the collection
	convCount := 0
	for _, d := range mock.Collection(COLLECTION_CONVERSATIONS).(*mockCollection).docs {
		if d.exists {
			convCount++
		}
	}
	if convCount != 1 {
		t.Errorf("Expected exactly 1 conversation document, found %d", convCount)
	}
}

// TestCreateConversation_DedupBackfillsWelcomeMessage verifies that when dedup
// returns an existing conversation that has no messages, a welcome system
// message is backfilled so it passes the empty-conversation filter in listing.
func TestCreateConversation_DedupBackfillsWelcomeMessage(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)

	mock := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mock, nil
	}

	// Pre-seed a dedup entry pointing to an empty conversation (no last_message_id)
	existingConvID := "conv-empty-legacy"
	mock.Collection("conversation_dedup").Doc("alpha_beta").Set(context.Background(), map[string]interface{}{
		"conversation_id":  existingConvID,
		"participants_key": "alpha_beta",
	})
	mock.Collection(COLLECTION_CONVERSATIONS).Doc(existingConvID).Set(context.Background(), map[string]interface{}{
		"id":               existingConvID,
		"participants_key": "alpha_beta",
		"participant_ids":  []interface{}{"alpha", "beta"},
	})

	// Request to create conversation for same participants — dedup will return existing
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("auth", AuthData{Role: "admin"})

	body := ConversationCreate{ParticipantProfileIDs: []string{"alpha", "beta"}}
	b, _ := json.Marshal(body)
	c.Request, _ = http.NewRequest("POST", "/conversations", bytes.NewBuffer(b))
	c.Request.Header.Set("Content-Type", "application/json")

	handleCreateConversation(c)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 (dedup), got %d. Body: %s", w.Code, w.Body.String())
	}

	// Verify the welcome message was backfilled
	convSnap, _ := mock.Collection(COLLECTION_CONVERSATIONS).Doc(existingConvID).Get(context.Background())
	data := convSnap.Data()

	if data["last_message_id"] == nil || data["last_message_id"] == "" {
		t.Error("Expected last_message_id to be backfilled on empty conversation")
	}
	if data["last_message_type"] != MessageTypeSystem {
		t.Errorf("Expected last_message_type '%s', got '%v'", MessageTypeSystem, data["last_message_type"])
	}

	// Verify the message exists in the sub-collection
	msgIter := mock.Collection(COLLECTION_CONVERSATIONS).Doc(existingConvID).Collection(COLLECTION_MESSAGES).Documents(context.Background())
	msgs, _ := msgIter.GetAll()
	if len(msgs) != 1 {
		t.Fatalf("Expected 1 backfilled message, got %d", len(msgs))
	}
}

// TestCreateConversation_LegacyFallback verifies that a conversation created
// BEFORE the dedup collection existed is correctly detected via the fallback
// query on participants_key, and that a dedup entry is backfilled.
func TestCreateConversation_LegacyFallback(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)

	mock := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mock, nil
	}

	// Pre-seed a "legacy" conversation (exists in conversations, but NOT in conversation_dedup)
	legacyConvID := "legacy-conv-123"
	mock.Collection(COLLECTION_CONVERSATIONS).Doc(legacyConvID).Set(context.Background(), map[string]interface{}{
		"id":               legacyConvID,
		"participants_key": "legacyA_legacyB",
		"participant_ids":  []interface{}{"legacyA", "legacyB"},
	})

	// Seed match so the creation is allowed (shouldn't reach this check due to fallback)
	matchID := "match_legacyA_legacyB"
	mock.Collection(COLLECTION_CACHE).Doc(matchID).Set(context.Background(), map[string]interface{}{
		"profile_ids": []interface{}{"legacyA", "legacyB"},
	})

	// --- Request to create conversation for same participants ---
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("auth", AuthData{Role: "admin"})

	body := ConversationCreate{ParticipantProfileIDs: []string{"legacyA", "legacyB"}}
	b, _ := json.Marshal(body)
	c.Request, _ = http.NewRequest("POST", "/conversations", bytes.NewBuffer(b))
	c.Request.Header.Set("Content-Type", "application/json")

	handleCreateConversation(c)

	// Should return the existing conversation (200 OK, not 201 Created)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 for legacy fallback, got %d. Body: %s", w.Code, w.Body.String())
	}

	var resp map[string]string
	json.Unmarshal(w.Body.Bytes(), &resp)

	if resp["conversation_id"] != legacyConvID {
		t.Errorf("Expected legacy conversation_id %s, got %s", legacyConvID, resp["conversation_id"])
	}

	// Verify the dedup entry was backfilled
	dedupSnap, _ := mock.Collection("conversation_dedup").Doc("legacyA_legacyB").Get(context.Background())
	if !dedupSnap.Exists() {
		t.Error("Expected dedup entry to be backfilled, but it was not created")
	} else {
		dedupData := dedupSnap.Data()
		if dedupData["conversation_id"] != legacyConvID {
			t.Errorf("Dedup entry points to wrong conversation: %v", dedupData["conversation_id"])
		}
	}
}

// TestCreateConversation_BatchCreateFailsOnExistingDedup verifies that the
// mockBatch.Create method correctly simulates Firestore's fail-if-exists
// behavior by failing the batch commit when the dedup doc already exists.
func TestCreateConversation_BatchCreateFailsOnExistingDedup(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)

	mock := &mockClient{}

	// Pre-seed the dedup doc (simulating a concurrent winner)
	winnerConvID := "winner-conv"
	mock.Collection("conversation_dedup").Doc("raceA_raceB").Set(context.Background(), map[string]interface{}{
		"conversation_id":  winnerConvID,
		"participants_key": "raceA_raceB",
	})

	// Attempt to Create on the same dedup doc — should fail
	batch := mock.Batch()
	dedupRef := mock.Collection("conversation_dedup").Doc("raceA_raceB")
	batch.Create(dedupRef, map[string]interface{}{
		"conversation_id":  "loser-conv",
		"participants_key": "raceA_raceB",
	})

	_, err := batch.Commit(context.Background())
	if err == nil {
		t.Fatal("Expected batch.Commit to fail when Create targets an existing doc, but it succeeded")
	}
}
