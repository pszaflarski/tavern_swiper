package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/stretchr/testify/assert"
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

	// Setup Router with real client
	oldGetDB := getDBFunc
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return client, nil }
	defer func() { getDBFunc = oldGetDB }()

	mockPub := &mockPublisher{}
	r := setupTest(mockPub)
	now := time.Now()
	token := signGoTestTokenWithTimes("integration-user", "user", now, now.Add(30*time.Minute))

	t.Run("CreateProfile_WithCategorizedTags", func(t *testing.T) {
		// 1. Seed some tags
		t1ID := seedTag(t, ctx, client, "gender", "Male", "gender__male", false)
		t2ID := seedTag(t, ctx, client, "fandom", "Star Wars", "fandom__star_wars", true)

		body := ProfileCreate{
			DisplayName: "Integration Hero",
			Age:         ptrInt(25),
			IsOC:        ptrBool(true),
			Gender: []ProfileTag{
				{ID: t1ID, Category: "gender", Name: "Male", Slug: "gender__male", Status: "active"},
			},
			Fandom: []ProfileTag{
				{ID: t2ID, Category: "fandom", Name: "Star Wars", Slug: "fandom__star_wars", Status: "active"},
			},
		}
		jsonBody, _ := json.Marshal(body)

		req, _ := http.NewRequest("POST", "/profiles/", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusCreated, w.Code)
		var res ProfileOut
		json.Unmarshal(w.Body.Bytes(), &res)

		assert.Len(t, res.Gender, 1)
		assert.Equal(t, "Male", res.Gender[0].Name)
		assert.Len(t, res.Fandom, 1)

		// 2. Verify Firestore raw data
		profDoc, _ := client.Collection(COLLECTION).Doc(res.ProfileID).Get(ctx)
		data := profDoc.Data()

		genderTags := data["gender"].([]interface{})
		assert.Len(t, genderTags, 1)
		assert.Equal(t, "Male", genderTags[0].(map[string]interface{})["name"])

		fandomTags := data["fandom"].([]interface{})
		assert.Len(t, fandomTags, 1)
		assert.Equal(t, "Star Wars", fandomTags[0].(map[string]interface{})["name"])

		assert.Equal(t, int64(25), data["age"]) // Firestore ints come back as int64
	})

	t.Run("UpdateProfile_SwapGenderTag", func(t *testing.T) {
		// Create initial
		t1ID := seedTag(t, ctx, client, "gender", "Male", "gender__male", false)
		t2ID := seedTag(t, ctx, client, "gender", "Female", "gender__female", false)

		body := ProfileCreate{
			DisplayName: "Swapper",
			Gender: []ProfileTag{
				{ID: t1ID, Category: "gender", Name: "Male", Slug: "gender__male", Status: "active"},
			},
		}
		jsonBody, _ := json.Marshal(body)
		req, _ := http.NewRequest("POST", "/profiles/", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+token)
		w1 := httptest.NewRecorder()
		r.ServeHTTP(w1, req)
		var p1 ProfileOut
		json.Unmarshal(w1.Body.Bytes(), &p1)

		// Update
		updateBody := ProfileUpdate{
			Gender: &[]ProfileTag{
				{ID: t2ID, Category: "gender", Name: "Female", Slug: "gender__female", Status: "active"},
			},
		}
		jsonUpdate, _ := json.Marshal(updateBody)
		reqU, _ := http.NewRequest("PUT", "/profiles/"+p1.ProfileID, bytes.NewBuffer(jsonUpdate))
		reqU.Header.Set("Authorization", "Bearer "+token)
		w2 := httptest.NewRecorder()
		r.ServeHTTP(w2, reqU)

		assert.Equal(t, http.StatusOK, w2.Code)
		var p2 ProfileOut
		json.Unmarshal(w2.Body.Bytes(), &p2)
		assert.Len(t, p2.Gender, 1)
		assert.Equal(t, "Female", p2.Gender[0].Name)
	})

	t.Run("CreateProfile_SingleSelectEnforcement", func(t *testing.T) {
		t1ID := seedTag(t, ctx, client, "gender", "Male", "gender__male", false)
		t2ID := seedTag(t, ctx, client, "gender", "Female", "gender__female", false)

		body := ProfileCreate{
			DisplayName: "Illegal",
			Gender: []ProfileTag{
				{ID: t1ID, Category: "gender", Name: "Male", Slug: "gender__male", Status: "active"},
				{ID: t2ID, Category: "gender", Name: "Female", Slug: "gender__female", Status: "active"},
			},
		}
		jsonBody, _ := json.Marshal(body)
		req, _ := http.NewRequest("POST", "/profiles/", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
		assert.Contains(t, w.Body.String(), "only allows one tag")
	})

	t.Run("ReadProfile_EmptyCategories", func(t *testing.T) {
		body := ProfileCreate{DisplayName: "Empty"}
		jsonBody, _ := json.Marshal(body)
		req, _ := http.NewRequest("POST", "/profiles/", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var res ProfileOut
		json.Unmarshal(w.Body.Bytes(), &res)

		assert.NotNil(t, res.Gender)
		assert.Len(t, res.Gender, 0)
		assert.NotNil(t, res.Fandom)
		assert.Len(t, res.Fandom, 0)
	})
}

func seedTag(t *testing.T, ctx context.Context, client FirestoreClient, category, name, slug string, multi bool) string {
	id := "tag-" + slug
	_, err := client.Collection(TAGS_COLLECTION).Doc(id).Set(ctx, map[string]interface{}{
		"category":     category,
		"name":         name,
		"slug":         slug,
		"multi_select": multi,
		"status":       "active",
	})
	if err != nil {
		t.Fatalf("Failed to seed tag: %v", err)
	}
	t.Cleanup(func() {
		client.Collection(TAGS_COLLECTION).Doc(id).Delete(context.Background())
	})
	return id
}
