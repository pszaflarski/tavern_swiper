package main

import (
	"context"
	"fmt"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
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
