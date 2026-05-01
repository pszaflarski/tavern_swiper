package main

import (
	"context"
	"fmt"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
)

// TestIntegration_FirestoreCRUD exercises all Firestore operations used by the messages service
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
			"participants_key": "profileA:profileB",
			"participant_ids":  []interface{}{"profileA", "profileB"},
			"created_at":       firestore.ServerTimestamp,
			"updated_at":       firestore.ServerTimestamp,
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
		if snap.Data()["participants_key"] != "profileA:profileB" {
			t.Errorf("Expected participants_key='profileA:profileB', got %v", snap.Data()["participants_key"])
		}
	})

	t.Run("Set_with_MergeAll", func(t *testing.T) {
		mergeData := map[string]interface{}{
			"last_message": "hello",
			"updated_at":   firestore.ServerTimestamp,
		}
		if _, err := ref.Set(ctx, mergeData, firestore.MergeAll); err != nil {
			t.Fatalf("Set with MergeAll failed: %v", err)
		}

		snap, err := ref.Get(ctx)
		if err != nil {
			t.Fatalf("Get after MergeAll failed: %v", err)
		}
		// Original field should still exist
		if snap.Data()["participants_key"] != "profileA:profileB" {
			t.Error("MergeAll should preserve existing fields")
		}
		// New field should exist
		if snap.Data()["last_message"] != "hello" {
			t.Error("MergeAll should add new fields")
		}
	})

	t.Run("Where_equality_with_limit", func(t *testing.T) {
		iter := col.Where("participants_key", "==", "profileA:profileB").
			Limit(1).Documents(ctx)
		docs, err := iter.GetAll()
		if err != nil {
			t.Fatalf("Where+Limit query failed: %v", err)
		}
		if len(docs) != 1 {
			t.Errorf("Expected 1 result, got %d", len(docs))
		}
	})

	t.Run("Where_array_contains", func(t *testing.T) {
		cacheID := testID + "-cache"
		cacheRef := col.Doc(cacheID)
		t.Cleanup(func() { cacheRef.Delete(context.Background()) })

		cacheData := map[string]interface{}{
			"profile_ids": []interface{}{"profileA", "profileB"},
		}
		if _, err := cacheRef.Set(ctx, cacheData); err != nil {
			t.Fatalf("Set cache doc failed: %v", err)
		}

		iter := col.Where("profile_ids", "array-contains", "profileA").Documents(ctx)
		docs, err := iter.GetAll()
		if err != nil {
			t.Fatalf("array-contains query failed: %v", err)
		}
		found := false
		for _, d := range docs {
			if d.ID() == cacheID {
				found = true
			}
		}
		if !found {
			t.Error("array-contains should find the cache document")
		}
	})

	t.Run("SubCollection", func(t *testing.T) {
		msgRef := ref.Collection("messages").Doc("msg-1")
		t.Cleanup(func() { msgRef.Delete(context.Background()) })

		msgData := map[string]interface{}{
			"sent_by":    "profileA",
			"content":    "Hello!",
			"created_at": firestore.ServerTimestamp,
		}
		if _, err := msgRef.Set(ctx, msgData); err != nil {
			t.Fatalf("SubCollection Set failed: %v", err)
		}

		snap, err := msgRef.Get(ctx)
		if err != nil {
			t.Fatalf("SubCollection Get failed: %v", err)
		}
		if snap.Data()["content"] != "Hello!" {
			t.Errorf("Expected content='Hello!', got %v", snap.Data()["content"])
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
		batch.Set(b1, map[string]interface{}{"val": "a"})
		batch.Set(b2, map[string]interface{}{"val": "b"})
		if _, err := batch.Commit(ctx); err != nil {
			t.Fatalf("Batch commit failed: %v", err)
		}

		snap1, _ := b1.Get(ctx)
		snap2, _ := b2.Get(ctx)
		if !snap1.Exists() || !snap2.Exists() {
			t.Error("Both batch docs should exist")
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
