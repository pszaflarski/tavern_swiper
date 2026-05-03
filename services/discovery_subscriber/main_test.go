package main

import (
	"tavern-swiper.app/firestoreutil"
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

	pb "tavern-swiper.app/discovery_subscriber/proto"
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
	event := &pb.ProfileEvent{
		Type: pb.ProfileEvent_UPSERTED,
		Event: &pb.ProfileEvent_Upserted{
			Upserted: &pb.ProfileUpserted{
				ProfileId:   "test-123",
				DisplayName: "Test Hero",
				IsActive:    true,
			},
		},
	}

	data, err := proto.Marshal(event)
	if err != nil {
		t.Fatalf("Failed to marshal event: %v", err)
	}

	var parsed pb.ProfileEvent
	if err := proto.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal event: %v", err)
	}

	if parsed.Type != pb.ProfileEvent_UPSERTED {
		t.Errorf("Expected type UPSERTED, got %v", parsed.Type)
	}

	upserted := parsed.GetUpserted()
	if upserted.DisplayName != "Test Hero" {
		t.Errorf("Expected name 'Test Hero', got '%s'", upserted.DisplayName)
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
	event := &pb.ProfileEvent{Type: pb.ProfileEvent_ALL_DELETED}

	// Passing nil client for ALL_DELETED should not fail
	err := processEvent(ctx, nil, event)
	if err != nil {
		t.Errorf("Expected nil error for ALL_DELETED, got %v", err)
	}
}

func TestHandlePubSubPush_Success(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/", handlePubSubPush)

	pe := &pb.ProfileEvent{
		Type: pb.ProfileEvent_UPSERTED,
		Event: &pb.ProfileEvent_Upserted{
			Upserted: &pb.ProfileUpserted{
				ProfileId: "p-123",
			},
		},
	}
	peBytes, _ := proto.Marshal(pe)

	pushReq := PubSubPushRequest{}
	pushReq.Message.Data = peBytes
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

func TestProcessSerializedEvent_ProtoError(t *testing.T) {
	skipIfRealDB(t)
	err := processSerializedEvent(context.Background(), []byte("not-a-proto"))
	if err == nil {
		t.Errorf("Expected error for invalid proto data, got nil")
	}
}

func TestProcessEvent_Upserted(t *testing.T) {
	skipIfRealDB(t)
	ctx := context.Background()
	event := &pb.ProfileEvent{
		Type: pb.ProfileEvent_UPSERTED,
		Event: &pb.ProfileEvent_Upserted{
			Upserted: &pb.ProfileUpserted{
				ProfileId:   "p1",
				DisplayName: "Hero",
			},
		},
	}

	// Passing nil client: should log and return nil (no crash)
	err := processEvent(ctx, nil, event)
	if err != nil {
		t.Errorf("processEvent failed on UPSERTED with nil client: %v", err)
	}
}

func TestProcessEvent_Deleted(t *testing.T) {
	skipIfRealDB(t)
	ctx := context.Background()
	event := &pb.ProfileEvent{
		Type: pb.ProfileEvent_DELETED,
		Event: &pb.ProfileEvent_Deleted{
			Deleted: &pb.ProfileDeleted{
				ProfileId: "p1",
			},
		},
	}

	// Passing nil client: should log and return nil (no crash)
	err := processEvent(ctx, nil, event)
	if err != nil {
		t.Errorf("processEvent failed on DELETED with nil client: %v", err)
	}
}
