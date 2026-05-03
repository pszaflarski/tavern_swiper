package main

import (
	"context"
	"fmt"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
)

// TestIntegration_FirestoreCRUD exercises all Firestore operations used by the discovery service
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
			"swiper_profile_id": "profile-A",
			"swiped_profile_id": "profile-B",
			"direction":         "right",
			"created_at":        firestore.ServerTimestamp,
			"modified_at":       firestore.ServerTimestamp,
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
		if snap.Data()["direction"] != "right" {
			t.Errorf("Expected direction='right', got %v", snap.Data()["direction"])
		}
	})

	t.Run("Where_equality", func(t *testing.T) {
		iter := col.Where("swiper_profile_id", "==", "profile-A").Documents(ctx)
		docs, err := iter.GetAll()
		if err != nil {
			t.Fatalf("Where query failed: %v", err)
		}
		found := false
		for _, d := range docs {
			if d.ID() == testID {
				found = true
			}
		}
		if !found {
			t.Errorf("Where query should find document %s", testID)
		}
	})

	t.Run("Where_chained_with_limit", func(t *testing.T) {
		iter := col.Where("swiper_profile_id", "==", "profile-A").
			Where("swiped_profile_id", "==", "profile-B").
			Where("direction", "==", "right").
			Limit(1).
			Documents(ctx)
		docs, err := iter.GetAll()
		if err != nil {
			t.Fatalf("Chained Where+Limit failed: %v", err)
		}
		if len(docs) != 1 {
			t.Errorf("Expected 1 result, got %d", len(docs))
		}
	})

	t.Run("Where_array_contains", func(t *testing.T) {
		matchID := testID + "-match"
		matchRef := col.Doc(matchID)
		t.Cleanup(func() { matchRef.Delete(context.Background()) })

		matchData := map[string]interface{}{
			"profiles":   []interface{}{"profile-A", "profile-B"},
			"created_at": firestore.ServerTimestamp,
		}
		if _, err := matchRef.Set(ctx, matchData); err != nil {
			t.Fatalf("Set match failed: %v", err)
		}

		iter := col.Where("profiles", "array-contains", "profile-A").Documents(ctx)
		docs, err := iter.GetAll()
		if err != nil {
			t.Fatalf("array-contains query failed: %v", err)
		}
		found := false
		for _, d := range docs {
			if d.ID() == matchID {
				found = true
			}
		}
		if !found {
			t.Error("array-contains query should find the match document")
		}
	})

	t.Run("Collection_Limit", func(t *testing.T) {
		iter := col.Limit(5).Documents(ctx)
		docs, err := iter.GetAll()
		if err != nil {
			t.Fatalf("Collection Limit query failed: %v", err)
		}
		if len(docs) > 5 {
			t.Errorf("Limit(5) returned %d documents", len(docs))
		}
	})

	t.Run("Batch_operations", func(t *testing.T) {
		b1 := col.Doc(testID + "-b1")
		b2 := col.Doc(testID + "-b2")
		t.Cleanup(func() {
			b1.Delete(context.Background())
			b2.Delete(context.Background())
		})

		batch := client.Batch()
		batch.Set(b1, map[string]interface{}{"val": 1})
		batch.Set(b2, map[string]interface{}{"val": 2})
		if _, err := batch.Commit(ctx); err != nil {
			t.Fatalf("Batch Set+Commit failed: %v", err)
		}

		snap1, _ := b1.Get(ctx)
		snap2, _ := b2.Get(ctx)
		if !snap1.Exists() || !snap2.Exists() {
			t.Error("Both batch-written documents should exist")
		}

		batch2 := client.Batch()
		batch2.Delete(b1)
		batch2.Delete(b2)
		if _, err := batch2.Commit(ctx); err != nil {
			t.Fatalf("Batch Delete+Commit failed: %v", err)
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
