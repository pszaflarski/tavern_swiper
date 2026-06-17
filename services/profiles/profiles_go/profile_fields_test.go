package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestProfileNewFields(t *testing.T) {
	// Mock _now to match test token generation
	fixedNow := time.Date(2026, 4, 17, 10, 0, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	mockPub := &mockPublisher{}
	r := setupTest(mockPub)
	
	oldGetDB := getDBFunc
	defer func() { getDBFunc = oldGetDB }()

	token := signGoTestToken("user-123", "user")

	t.Run("CreateProfileWithNewFields", func(t *testing.T) {
		mock := &mockClient{collections: make(map[string]*mockCollection)}
		// Mock tag existence
		col := mock.Collection(TAGS_COLLECTION).(*mockCollection)
		col.docs = map[string]*mockDoc{
			"t1": {id: "t1", exists: true, data: map[string]interface{}{"category": "fandom", "name": "Star Wars", "slug": "fandom__star_wars", "multi_select": true, "status": "active"}},
		}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		body := ProfileCreate{
			DisplayName: "Hero",
			Age:         ptrInt(25),
			IsOC:        ptrBool(true),
			Fandom: []ProfileTag{
				{ID: "t1", Category: "fandom", Name: "Star Wars", Slug: "fandom__star_wars", Status: "active"},
			},
		}
		jsonBody, _ := json.Marshal(body)

		req, _ := http.NewRequest("POST", "/profiles/", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if !assert.Equal(t, http.StatusCreated, w.Code) {
			t.Logf("Response: %s", w.Body.String())
			return
		}
		var res ProfileOut
		json.Unmarshal(w.Body.Bytes(), &res)
		assert.Equal(t, 25, *res.Age)
		assert.True(t, *res.IsOC)
		assert.Len(t, res.Fandom, 1)
		assert.Equal(t, "Star Wars", res.Fandom[0].Name)
	})

	t.Run("UpdateProfileWithNewFields", func(t *testing.T) {
		mock := &mockClient{collections: map[string]*mockCollection{
			COLLECTION: {
				docs: map[string]*mockDoc{
					"p1": {
						id: "p1",
						exists: true,
						data: map[string]interface{}{
							"user_id": "user-123",
							"display_name": "Hero",
						},
					},
				},
			},
			TAGS_COLLECTION: {
				docs: map[string]*mockDoc{
					"t1": {id: "t1", exists: true, data: map[string]interface{}{"category": "fandom", "name": "Star Wars", "slug": "fandom__star_wars", "multi_select": true}},
				},
			},
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		body := ProfileUpdate{
			Age: ptrInt(30),
		}
		jsonBody, _ := json.Marshal(body)

		req, _ := http.NewRequest("PUT", "/profiles/p1", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if !assert.Equal(t, http.StatusOK, w.Code) {
			t.Logf("Response: %s", w.Body.String())
			return
		}
		var res ProfileOut
		json.Unmarshal(w.Body.Bytes(), &res)
		assert.Equal(t, 30, *res.Age)
	})

	t.Run("CreateProfile_GenderSyncedToFirestore", func(t *testing.T) {
		mock := &mockClient{collections: make(map[string]*mockCollection)}
		// Mock the tag existence check
		col := mock.Collection(TAGS_COLLECTION).(*mockCollection)
		col.docs = map[string]*mockDoc{
			"t1": {id: "t1", exists: true, data: map[string]interface{}{"category": "gender", "name": "Male", "slug": "gender__male", "multi_select": false, "status": "active"}},
		}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		body := ProfileCreate{
			DisplayName: "Hero",
			Gender: []ProfileTag{
				{ID: "t1", Category: "gender", Name: "Male", Slug: "gender__male", Status: "active"},
			},
		}
		jsonBody, _ := json.Marshal(body)

		req, _ := http.NewRequest("POST", "/profiles/", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusCreated, w.Code)
		var res ProfileOut
		json.Unmarshal(w.Body.Bytes(), &res)
		assert.Len(t, res.Gender, 1)
		assert.Equal(t, "Male", res.Gender[0].Name)
		
		// Verify Firestore data sync
		profDoc, _ := mock.Collection(COLLECTION).Doc(res.ProfileID).Get(context.Background())
		genderVal := profDoc.Data()["gender"]
		gSlice, ok := genderVal.([]interface{})
		assert.True(t, ok)
		assert.Len(t, gSlice, 1)
		gMap := gSlice[0].(map[string]interface{})
		assert.Equal(t, "Male", gMap["name"])
	})

	t.Run("CreateProfile_SingleSelectViolation_Returns400", func(t *testing.T) {
		mock := &mockClient{collections: make(map[string]*mockCollection)}
		col := mock.Collection(TAGS_COLLECTION).(*mockCollection)
		col.docs = map[string]*mockDoc{
			"t1": {id: "t1", exists: true, data: map[string]interface{}{"category": "gender", "name": "Male", "slug": "gender__male", "multi_select": false, "status": "active"}},
			"t2": {id: "t2", exists: true, data: map[string]interface{}{"category": "gender", "name": "Female", "slug": "gender__female", "multi_select": false, "status": "active"}},
		}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		body := ProfileCreate{
			DisplayName: "Hero",
			Gender: []ProfileTag{
				{ID: "t1", Category: "gender", Name: "Male", Slug: "gender__male", Status: "active"},
				{ID: "t2", Category: "gender", Name: "Female", Slug: "gender__female", Status: "active"},
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

	t.Run("CreateProfile_AdminUserIdOverride", func(t *testing.T) {
		mock := &mockClient{collections: make(map[string]*mockCollection)}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }
		adminToken := signGoTestToken("admin", "admin")

		body := ProfileCreate{
			DisplayName: "Overridden",
			UserID:      ptrStr("target-user"),
		}
		jsonBody, _ := json.Marshal(body)

		req, _ := http.NewRequest("POST", "/profiles/", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+adminToken)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusCreated, w.Code)
		var res ProfileOut
		json.Unmarshal(w.Body.Bytes(), &res)
		assert.Equal(t, "target-user", res.UserID)
	})

	t.Run("CreateProfile_NonAdminUserIdReturns403", func(t *testing.T) {
		token := signGoTestToken("user-1", "user")
		body := ProfileCreate{
			DisplayName: "Fails",
			UserID:      ptrStr("target-user"),
		}
		jsonBody, _ := json.Marshal(body)

		req, _ := http.NewRequest("POST", "/profiles/", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("CreateProfile_LookingForSyncedToFirestore", func(t *testing.T) {
		mock := &mockClient{collections: make(map[string]*mockCollection)}
		col := mock.Collection(TAGS_COLLECTION).(*mockCollection)
		col.docs = map[string]*mockDoc{
			"lf1": {id: "lf1", exists: true, data: map[string]interface{}{"category": "looking_for", "name": "New Friends", "slug": "looking_for__new_friends", "multi_select": true, "status": "active"}},
			"lf2": {id: "lf2", exists: true, data: map[string]interface{}{"category": "looking_for", "name": "Roleplay", "slug": "looking_for__roleplay", "multi_select": true, "status": "active"}},
		}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		body := ProfileCreate{
			DisplayName: "Quest Seeker",
			LookingFor: []ProfileTag{
				{ID: "lf1", Category: "looking_for", Name: "New Friends", Slug: "looking_for__new_friends", Status: "active"},
				{ID: "lf2", Category: "looking_for", Name: "Roleplay", Slug: "looking_for__roleplay", Status: "active"},
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
		assert.Len(t, res.LookingFor, 2)
		assert.Equal(t, "New Friends", res.LookingFor[0].Name)
		assert.Equal(t, "Roleplay", res.LookingFor[1].Name)

		// Verify Firestore data sync
		profDoc, _ := mock.Collection(COLLECTION).Doc(res.ProfileID).Get(context.Background())
		lfVal := profDoc.Data()["looking_for"]
		lfSlice, ok := lfVal.([]interface{})
		assert.True(t, ok)
		assert.Len(t, lfSlice, 2)
		lfMap := lfSlice[0].(map[string]interface{})
		assert.Equal(t, "New Friends", lfMap["name"])
	})

	t.Run("UpdateProfile_LookingForTags", func(t *testing.T) {
		mock := &mockClient{collections: map[string]*mockCollection{
			COLLECTION: {
				docs: map[string]*mockDoc{
					"p-lf": {
						id: "p-lf",
						exists: true,
						data: map[string]interface{}{
							"user_id":      "user-123",
							"display_name": "Quest Seeker",
						},
					},
				},
			},
			TAGS_COLLECTION: {
				docs: map[string]*mockDoc{
					"lf3": {id: "lf3", exists: true, data: map[string]interface{}{"category": "looking_for", "name": "Join a Clan", "slug": "looking_for__join_a_clan", "multi_select": true, "status": "active"}},
				},
			},
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		lfTags := []ProfileTag{
			{ID: "lf3", Category: "looking_for", Name: "Join a Clan", Slug: "looking_for__join_a_clan", Status: "active"},
		}
		body := ProfileUpdate{
			LookingFor: &lfTags,
		}
		jsonBody, _ := json.Marshal(body)

		req, _ := http.NewRequest("PUT", "/profiles/p-lf", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if !assert.Equal(t, http.StatusOK, w.Code) {
			t.Logf("Response: %s", w.Body.String())
			return
		}
		var res ProfileOut
		json.Unmarshal(w.Body.Bytes(), &res)
		assert.Len(t, res.LookingFor, 1)
		assert.Equal(t, "Join a Clan", res.LookingFor[0].Name)
	})

	t.Run("CreateProfile_NoLookingFor_DefaultsEmpty", func(t *testing.T) {
		mock := &mockClient{collections: make(map[string]*mockCollection)}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		body := ProfileCreate{
			DisplayName: "Minimalist",
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
		assert.Empty(t, res.LookingFor)
	})

	t.Run("UpdateProfile_GeneratedProfileCannotBeEdited", func(t *testing.T) {
		mock := &mockClient{collections: map[string]*mockCollection{
			COLLECTION: {
				docs: map[string]*mockDoc{
					"p-gen": {
						id: "p-gen",
						exists: true,
						data: map[string]interface{}{
							"user_id":      "user-123",
							"display_name": "Generated Hero",
							"generated":    true,
						},
					},
				},
			},
		}}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		// 1. Try to edit DisplayName -> should return 400
		body := ProfileUpdate{
			DisplayName: ptrStr("Edited Name"),
		}
		jsonBody, _ := json.Marshal(body)

		req, _ := http.NewRequest("PUT", "/profiles/p-gen", bytes.NewBuffer(jsonBody))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
		assert.Contains(t, w.Body.String(), "Generated profiles cannot be edited")

		// 2. Try to toggle IsActive -> should succeed
		bodyActive := ProfileUpdate{
			IsActive: ptrBool(true),
		}
		jsonBodyActive, _ := json.Marshal(bodyActive)

		reqActive, _ := http.NewRequest("PUT", "/profiles/p-gen", bytes.NewBuffer(jsonBodyActive))
		reqActive.Header.Set("Authorization", "Bearer "+token)
		reqActive.Header.Set("Content-Type", "application/json")
		wActive := httptest.NewRecorder()
		r.ServeHTTP(wActive, reqActive)

		assert.Equal(t, http.StatusOK, wActive.Code)
	})
}
