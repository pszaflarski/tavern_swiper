package discovery_subscriber

import (
	"context"
	"os"
	"testing"

	"google.golang.org/protobuf/proto"

	pb "discovery_subscriber/proto"
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

func TestProcessEventUpsertLogic(t *testing.T) {
	// This test is mostly a placeholder for functional logic verification
}
