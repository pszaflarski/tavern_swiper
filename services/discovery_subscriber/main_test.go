package discovery_subscriber

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/cloudevents/sdk-go/v2/event"
	"google.golang.org/protobuf/proto"

	pb "tavern-swiper.app/discovery_subscriber/proto"
)

func TestUnmarshalEvent(t *testing.T) {
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
	ctx := context.Background()
	event := &pb.ProfileEvent{Type: pb.ProfileEvent_ALL_DELETED}

	// Passing nil client for ALL_DELETED should not fail
	err := processEvent(ctx, nil, event)
	if err != nil {
		t.Errorf("Expected nil error for ALL_DELETED, got %v", err)
	}
}

func TestHandleProfileEvent_NestedFormat(t *testing.T) {
	ctx := context.Background()
	
	// Create a real ProfileEvent
	pe := &pb.ProfileEvent{
		Type: pb.ProfileEvent_UPSERTED,
		Event: &pb.ProfileEvent_Upserted{
			Upserted: &pb.ProfileUpserted{
				ProfileId: "nested-123",
				DisplayName: "Nested Hero",
			},
		},
	}
	peBytes, _ := proto.Marshal(pe)
	
	// Wrap it in the Nested Eventarc structure
	// Note: JSON marshaling peBytes (which is []byte) will base64 it automatically
	nestedJSON := map[string]interface{}{
		"message": map[string]interface{}{
			"data": peBytes,
		},
	}
	jsonData, _ := json.Marshal(nestedJSON)
	
	e := event.New()
	e.SetID("12345")
	e.SetSource("test-source")
	e.SetData(event.ApplicationJSON, jsonData)
	
	// We check for nil error (which means it found the data and didn't crash)
	// Since we pass nil to firestore in subsequent logic, it will log a warning but return nil
	err := handleProfileEvent(ctx, e)
	if err != nil {
		t.Errorf("handleProfileEvent failed on nested format: %v", err)
	}
}

func TestHandleProfileEvent_FlatFormat(t *testing.T) {
	ctx := context.Background()
	
	pe := &pb.ProfileEvent{
		Type: pb.ProfileEvent_UPSERTED,
		Event: &pb.ProfileEvent_Upserted{
			Upserted: &pb.ProfileUpserted{
				ProfileId: "flat-123",
				DisplayName: "Flat Hero",
			},
		},
	}
	peBytes, _ := proto.Marshal(pe)
	
	// Wrap it in the Flat Pub/Sub structure
	flatJSON := map[string]interface{}{
		"data": peBytes,
	}
	jsonData, _ := json.Marshal(flatJSON)
	
	e := event.New()
	e.SetData(event.ApplicationJSON, jsonData)
	
	err := handleProfileEvent(ctx, e)
	if err != nil {
		t.Errorf("handleProfileEvent failed on flat format: %v", err)
	}
}

func TestHandleProfileEvent_InvalidData(t *testing.T) {
	ctx := context.Background()
	
	e := event.New()
	e.SetData(event.ApplicationJSON, []byte(`{"not_what_we_expect": "true"}`))
	
	// Should return nil (with warning log) rather than crashing or erroring
	err := handleProfileEvent(ctx, e)
	if err != nil {
		t.Errorf("handleProfileEvent should handle invalid JSON gracefully, got %v", err)
	}
}

func TestProcessEvent_Upserted(t *testing.T) {
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
