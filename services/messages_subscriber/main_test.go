package messages_subscriber

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/cloudevents/sdk-go/v2/event"
	"google.golang.org/protobuf/proto"

	pb "tavern-swiper.app/messages_subscriber/proto"
)

func TestUnmarshalEvent(t *testing.T) {
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
	event := &pb.MatchEvent{Type: pb.MatchEvent_UNKNOWN}

	// Passing nil client for UNKNOWN should not fail
	err := processEvent(ctx, nil, event)
	if err != nil {
		t.Errorf("Expected nil error for UNKNOWN, got %v", err)
	}
}

func TestHandleMatchEvent_NestedFormat(t *testing.T) {
	ctx := context.Background()
	
	// Create a real MatchEvent
	me := &pb.MatchEvent{
		Type: pb.MatchEvent_CREATED,
		Event: &pb.MatchEvent_Created{
			Created: &pb.MatchCreated{
				MatchId: "nested-123",
				ProfileIds: []string{"p1", "p2"},
			},
		},
	}
	meBytes, _ := proto.Marshal(me)
	
	// Wrap it in the Nested Eventarc structure
	nestedJSON := map[string]interface{}{
		"message": map[string]interface{}{
			"data": meBytes,
		},
	}
	jsonData, _ := json.Marshal(nestedJSON)
	
	e := event.New()
	e.SetID("12345")
	e.SetSource("test-source")
	e.SetData(event.ApplicationJSON, jsonData)
	
	err := handleMatchEvent(ctx, e)
	if err != nil {
		t.Errorf("handleMatchEvent failed on nested format: %v", err)
	}
}

func TestHandleMatchEvent_FlatFormat(t *testing.T) {
	ctx := context.Background()
	
	me := &pb.MatchEvent{
		Type: pb.MatchEvent_CREATED,
		Event: &pb.MatchEvent_Created{
			Created: &pb.MatchCreated{
				MatchId: "flat-123",
				ProfileIds: []string{"p1", "p2"},
			},
		},
	}
	meBytes, _ := proto.Marshal(me)
	
	// Wrap it in the Flat Pub/Sub structure
	flatJSON := map[string]interface{}{
		"data": meBytes,
	}
	jsonData, _ := json.Marshal(flatJSON)
	
	e := event.New()
	e.SetData(event.ApplicationJSON, jsonData)
	
	err := handleMatchEvent(ctx, e)
	if err != nil {
		t.Errorf("handleMatchEvent failed on flat format: %v", err)
	}
}

func TestHandleMatchEvent_InvalidData(t *testing.T) {
	ctx := context.Background()
	
	e := event.New()
	e.SetData(event.ApplicationJSON, []byte(`{"not_what_we_expect": "true"}`))
	
	// Should return nil (with warning log) rather than crashing or erroring
	err := handleMatchEvent(ctx, e)
	if err != nil {
		t.Errorf("handleMatchEvent should handle invalid JSON gracefully, got %v", err)
	}
}

func TestProcessEvent_Created(t *testing.T) {
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
