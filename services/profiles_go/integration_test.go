package main

import (
	"context"
	"fmt"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
)

// TestIntegration_FirestoreCRUD exercises all Firestore operations used by the profiles service
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

	// Cleanup after test
	t.Cleanup(func() {
		ref.Delete(context.Background())
	})

	t.Run("Set_and_Get", func(t *testing.T) {
		data := map[string]interface{}{
			"display_name": "Test Profile",
			"user_id":      "test-user-123",
			"is_active":    true,
			"created_at":   firestore.ServerTimestamp,
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
		if snap.Data()["display_name"] != "Test Profile" {
			t.Errorf("Expected display_name='Test Profile', got %v", snap.Data()["display_name"])
		}
		if snap.ID() != testID {
			t.Errorf("Expected ID=%s, got %s", testID, snap.ID())
		}
		// Verify ServerTimestamp was resolved
		if snap.Data()["created_at"] == nil {
			t.Error("ServerTimestamp should have been resolved to a time value")
		}
	})

	t.Run("Update", func(t *testing.T) {
		updates := []firestore.Update{
			{Path: "display_name", Value: "Updated Name"},
			{Path: "updated_at", Value: firestore.ServerTimestamp},
		}
		if _, err := ref.Update(ctx, updates); err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		snap, err := ref.Get(ctx)
		if err != nil {
			t.Fatalf("Get after Update failed: %v", err)
		}
		if snap.Data()["display_name"] != "Updated Name" {
			t.Errorf("Expected display_name='Updated Name', got %v", snap.Data()["display_name"])
		}
	})

	t.Run("Where_equality", func(t *testing.T) {
		iter := col.Where("user_id", "==", "test-user-123").Documents(ctx)
		docs, err := iter.GetAll()
		if err != nil {
			t.Fatalf("Where query failed: %v", err)
		}
		if len(docs) == 0 {
			t.Error("Where query should return at least 1 document")
		}
		found := false
		for _, d := range docs {
			if d.ID() == testID {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("Where query results should contain document %s", testID)
		}
	})

	t.Run("Where_chained", func(t *testing.T) {
		iter := col.Where("user_id", "==", "test-user-123").
			Where("is_active", "==", true).
			Limit(1).
			Documents(ctx)
		docs, err := iter.GetAll()
		if err != nil {
			t.Fatalf("Chained Where+Limit query failed: %v", err)
		}
		if len(docs) != 1 {
			t.Errorf("Expected exactly 1 result, got %d", len(docs))
		}
	})

	t.Run("Batch_write", func(t *testing.T) {
		batchID1 := testID + "-batch1"
		batchID2 := testID + "-batch2"
		ref1 := col.Doc(batchID1)
		ref2 := col.Doc(batchID2)
		t.Cleanup(func() {
			ref1.Delete(context.Background())
			ref2.Delete(context.Background())
		})

		batch := client.Batch()
		batch.Delete(ref1)
		batch.Delete(ref2)
		if _, err := batch.Commit(ctx); err != nil {
			t.Fatalf("Batch commit failed: %v", err)
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
