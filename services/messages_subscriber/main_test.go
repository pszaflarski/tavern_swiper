package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
	"google.golang.org/protobuf/proto"

	"tavern-swiper.app/firestoreutil"
	pb "tavern-swiper.app/messages_subscriber/proto"
)

func init() {
	// Silence logger for tests
	log.SetOutput(bytes.NewBuffer(nil))
	
	// Set mock database
	getDBFunc = func(ctx context.Context) (firestoreutil.FirestoreClient, error) {
		return &mockClient{}, nil
	}
}

func TestUnmarshalEvent(t *testing.T) {
	skipIfRealDB(t)
	event := &pb.MatchEvent{
		Type: pb.MatchEvent_CREATED,
		Event: &pb.MatchEvent_Created{
			Created: &pb.MatchCreated{
				MatchId:    "match-123",
				ProfileIds: []string{"p1", "p2"},
				CreatedAt:  "2026-04-19T10:00:00Z",
			},
		},
	}

	data, err := proto.Marshal(event)
	if err != nil {
		t.Fatalf("Failed to marshal event: %v", err)
	}

	var parsed pb.MatchEvent
	if err := proto.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal event: %v", err)
	}

	if parsed.Type != pb.MatchEvent_CREATED {
		t.Errorf("Expected type CREATED, got %v", parsed.Type)
	}

	created := parsed.GetCreated()
	if created.MatchId != "match-123" {
		t.Errorf("Expected match_id 'match-123', got '%s'", created.MatchId)
	}
}

func TestGetEnv(t *testing.T) {
	skipIfRealDB(t)
	key := "TEST_ENV_VAR"
	val := "test_val"
	os.Setenv(key, val)
	defer os.Unsetenv(key)

	if got := getEnv(key, "fallback"); got != val {
		t.Errorf("getEnv(%s) = %s; want %s", key, got, val)
	}

	if got := getEnv("NON_EXISTENT", "fallback"); got != "fallback" {
		t.Errorf("getEnv(NON_EXISTENT) = %s; want fallback", got)
	}
}

func TestProcessEventBasic(t *testing.T) {
	skipIfRealDB(t)
	ctx := context.Background()
	event := &pb.MatchEvent{Type: pb.MatchEvent_UNKNOWN}

	// Passing nil client for UNKNOWN should not fail
	err := processEvent(ctx, nil, event)
	if err != nil {
		t.Errorf("Expected nil error for UNKNOWN, got %v", err)
	}
}

func TestHandlePubSubPush_Success(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/", handlePubSubPush)

	me := &pb.MatchEvent{
		Type: pb.MatchEvent_CREATED,
		Event: &pb.MatchEvent_Created{
			Created: &pb.MatchCreated{
				MatchId: "m-123",
			},
		},
	}
	meBytes, _ := proto.Marshal(me)

	pushReq := PubSubPushRequest{}
	pushReq.Message.Data = meBytes
	jsonBody, _ := json.Marshal(pushReq)

	req, _ := http.NewRequest(http.MethodPost, "/", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}
}

func TestHandlePubSubPush_InvalidJSON(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/", handlePubSubPush)

	req, _ := http.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{"bad": "json"`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	
	r.ServeHTTP(w, req)

	// We return 200 for malformed JSON to avoid Pub/Sub retries
	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200 for invalid JSON, got %d", w.Code)
	}
}

func TestHandlePubSubPush_EmptyData(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/", handlePubSubPush)

	pushReq := PubSubPushRequest{}
	jsonBody, _ := json.Marshal(pushReq)

	req, _ := http.NewRequest(http.MethodPost, "/", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200 for empty data, got %d", w.Code)
	}
}

func TestProcessSerializedEvent_ProtoError(t *testing.T) {
	skipIfRealDB(t)
	err := processSerializedEvent(context.Background(), []byte("not-a-proto"))
	if err == nil {
		t.Errorf("Expected error for invalid proto data, got nil")
	}
}

func TestProcessEvent_Created(t *testing.T) {
	skipIfRealDB(t)
	ctx := context.Background()
	event := &pb.MatchEvent{
		Type: pb.MatchEvent_CREATED,
		Event: &pb.MatchEvent_Created{
			Created: &pb.MatchCreated{
				MatchId: "m1",
			},
		},
	}

	// Passing nil client: should log and return nil (no crash)
	err := processEvent(ctx, nil, event)
	if err != nil {
		t.Errorf("processEvent failed on CREATED with nil client: %v", err)
	}
}

func TestProcessEvent_Deleted(t *testing.T) {
	skipIfRealDB(t)
	ctx := context.Background()
	event := &pb.MatchEvent{
		Type: pb.MatchEvent_DELETED,
		Event: &pb.MatchEvent_Deleted{
			Deleted: &pb.MatchDeleted{
				MatchId: "m1",
			},
		},
	}

	// Passing nil client: should log and return nil (no crash)
	err := processEvent(ctx, nil, event)
	if err != nil {
		t.Errorf("processEvent failed on DELETED with nil client: %v", err)
	}
}
