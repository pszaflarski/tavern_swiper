package main

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
)

// TestIntegration_FirestoreCRUD exercises the Firestore operations used by the auth service
// against a real database. The auth service uses Firestore only for reading user roles
// via getUsersDBInternal. Only runs when -real-db flag is set.
//
// Run: go test -v -run TestIntegration -args -real-db
func TestIntegration_FirestoreCRUD(t *testing.T) {
	if !*useRealDB {
		t.Skip("Skipping integration test (use -real-db to run)")
	}
	setupRealDBEnv(t)
	// Auth service uses USERS_DATABASE_ID for its users DB client
	os.Setenv("USERS_DATABASE_ID", *firestoreDB)

	ctx := context.Background()
	// Auth service uses getUsersDBInternal (raw *firestore.Client)
	client, err := getUsersDBInternal(ctx)
	if err != nil {
		t.Fatalf("Failed to connect to real Firestore (users DB): %v", err)
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

	t.Run("Collection_Doc_Get_pattern", func(t *testing.T) {
		// This is the exact pattern used in verifyTokenHandler:
		// uDB.Collection("users").Doc(uid).Get(ctx)
		snap, err := col.Doc(testID).Get(ctx)
		if err != nil {
			t.Fatalf("Collection.Doc.Get failed: %v", err)
		}
		if !snap.Exists() {
			t.Fatal("Document should exist")
		}
		if r, ok := snap.Data()["user_type"].(string); !ok || r != "user" {
			t.Errorf("Expected user_type string 'user', got %v", snap.Data()["user_type"])
		}
	})

	t.Run("Delete", func(t *testing.T) {
		if _, err := ref.Delete(ctx); err != nil {
			t.Fatalf("Delete failed: %v", err)
		}
	})
}
