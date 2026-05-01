package main

import (
	"context"
	"fmt"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
)

// TestIntegration_FirestoreCRUD exercises all Firestore operations used by the users service
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
			"user_type":  "user",
			"email":      "test@example.com",
			"is_deleted": false,
			"created_at": firestore.ServerTimestamp,
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
		if snap.Data()["user_type"] != "user" {
			t.Errorf("Expected user_type='user', got %v", snap.Data()["user_type"])
		}
	})

	t.Run("Update", func(t *testing.T) {
		updates := []firestore.Update{
			{Path: "is_deleted", Value: true},
		}
		if _, err := ref.Update(ctx, updates); err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		snap, err := ref.Get(ctx)
		if err != nil {
			t.Fatalf("Get after Update failed: %v", err)
		}
		if snap.Data()["is_deleted"] != true {
			t.Errorf("Expected is_deleted=true, got %v", snap.Data()["is_deleted"])
		}
	})

	t.Run("Where_with_limit", func(t *testing.T) {
		iter := col.Where("user_type", "==", "user").Limit(1).Documents(ctx)
		docs, err := iter.GetAll()
		if err != nil {
			t.Fatalf("Where+Limit query failed: %v", err)
		}
		if len(docs) == 0 {
			t.Error("Where query should return at least 1 document")
		}
	})

	t.Run("Batch_delete", func(t *testing.T) {
		batchID := testID + "-batch"
		batchRef := col.Doc(batchID)
		batchRef.Set(ctx, map[string]interface{}{"temp": true})
		t.Cleanup(func() { batchRef.Delete(context.Background()) })

		batch := client.Batch()
		batch.Delete(batchRef)
		if _, err := batch.Commit(ctx); err != nil {
			t.Fatalf("Batch delete commit failed: %v", err)
		}

		snap, _ := batchRef.Get(ctx)
		if snap != nil && snap.Exists() {
			t.Error("Document should not exist after batch delete")
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
