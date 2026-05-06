package main

import (
	"context"
	"fmt"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
	pb "tavern-swiper.app/discovery_subscriber/proto"
)

// TestIntegration_FirestoreCRUD exercises all Firestore operations used by the discovery subscriber
// against a real database. Only runs when -real-db flag is set.
//
// Run: go test -v -run TestIntegration -args -real-db
func TestIntegration_FirestoreCRUD(t *testing.T) {
	if !*useRealDB {
		t.Skip("Skipping integration test (use -real-db to run)")
	}
	setupRealDBEnv(t)

	ctx := context.Background()
	client, err := getDBInternal(ctx)
	if err != nil {
		t.Fatalf("Failed to connect to real Firestore: %v", err)
	}

	testID := fmt.Sprintf("integration-test-%d", time.Now().UnixNano())
	col := client.Collection("_integration_tests")
	ref := col.Doc(testID)

	t.Cleanup(func() {
		ref.Delete(context.Background())
	})

	t.Run("Set_and_Get", func(t *testing.T) {
		data := map[string]interface{}{
			"display_name": "Cached Profile",
			"updated_at":   firestore.ServerTimestamp,
		}
		if _, err := ref.Set(ctx, data); err != nil {
			t.Fatalf("Set failed: %v", err)
		}

		snap, err := ref.Get(ctx)
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}
		if !snap.Exists() {
			t.Fatal("Document should exist after Set")
		}
	})

	t.Run("Delete", func(t *testing.T) {
		if _, err := ref.Delete(ctx); err != nil {
			t.Fatalf("Delete failed: %v", err)
		}
		snap, err := ref.Get(ctx)
		if err == nil && snap.Exists() {
			t.Error("Document should not exist after Delete")
		}
	})
}

func TestIntegration_CategorizedTags(t *testing.T) {
	if !*useRealDB {
		t.Skip("Skipping integration test (use -real-db to run)")
	}
	setupRealDBEnv(t)

	ctx := context.Background()
	client, err := getDBInternal(ctx)
	if err != nil {
		t.Fatalf("Failed to connect to real Firestore: %v", err)
	}

	profileID := fmt.Sprintf("it-profile-%d", time.Now().UnixNano())
	t.Cleanup(func() {
		client.Collection("profiles_profiles_cache").Doc(profileID).Delete(context.Background())
	})

	t.Run("ProcessUpserted_CategorizedTags", func(t *testing.T) {
		event := &pb.ProfileEvent{
			Type: pb.ProfileEvent_UPSERTED,
			Event: &pb.ProfileEvent_Upserted{
				Upserted: &pb.ProfileUpserted{
					ProfileId:   profileID,
					DisplayName: "IT Hero",
					Age:         toPtrInt32(30),
					Gender: []*pb.ProfileTag{
						{Id: "g1", Name: "Male", Slug: "gender__male"},
					},
					Fandom: []*pb.ProfileTag{
						{Id: "f1", Name: "Star Wars", Slug: "fandom__star_wars"},
					},
				},
			},
		}

		err := processEvent(ctx, client, event)
		if err != nil {
			t.Fatalf("processEvent failed: %v", err)
		}

		// Verify Cache
		snap, _ := client.Collection("profiles_profiles_cache").Doc(profileID).Get(ctx)
		data := snap.Data()
		if data["display_name"] != "IT Hero" {
			t.Errorf("Expected display_name='IT Hero', got %v", data["display_name"])
		}
		if data["age"].(int64) != 30 {
			t.Errorf("Expected age=30, got %v", data["age"])
		}
		
		fandom := data["fandom"].([]interface{})
		if len(fandom) != 1 {
			t.Errorf("Expected 1 fandom tag, got %d", len(fandom))
		}
	})

	t.Run("ProcessUpserted_EmptyTags", func(t *testing.T) {
		pid := profileID + "-empty"
		t.Cleanup(func() { client.Collection("profiles_profiles_cache").Doc(pid).Delete(context.Background()) })

		event := &pb.ProfileEvent{
			Type: pb.ProfileEvent_UPSERTED,
			Event: &pb.ProfileEvent_Upserted{
				Upserted: &pb.ProfileUpserted{
					ProfileId:   pid,
					DisplayName: "Empty",
				},
			},
		}

		processEvent(ctx, client, event)
		snap, _ := client.Collection("profiles_profiles_cache").Doc(pid).Get(ctx)
		data := snap.Data()
		
		// Verify categories are empty arrays, not nil
		for _, cat := range []string{"gender", "race", "fandom", "interests", "events"} {
			val := data[cat]
			if val == nil {
				t.Errorf("Category %s should be empty array, got nil", cat)
			}
		}
	})
}
