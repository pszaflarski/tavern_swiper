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
			"t1": {id: "t1", exists: true, data: map[string]interface{}{"category": "fandom", "name": "Star Wars", "slug": "fandom__star_wars", "multi_select": true}},
		}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		body := ProfileCreate{
			DisplayName: "Hero",
			Age:         ptrInt(25),
			IsOC:        ptrBool(true),
			Tags: []ProfileTag{
				{ID: "t1", Category: "fandom", Name: "Star Wars", Slug: "fandom__star_wars"},
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
		assert.Len(t, res.Tags, 1)
		assert.Equal(t, "Star Wars", res.Tags[0].Name)
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
			"t1": {id: "t1", exists: true, data: map[string]interface{}{"category": "gender", "name": "Male", "slug": "gender__male", "multi_select": false}},
		}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		body := ProfileCreate{
			DisplayName: "Hero",
			Tags: []ProfileTag{
				{ID: "t1", Category: "gender", Name: "Male", Slug: "gender__male"},
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
		assert.Equal(t, "Male", *res.Gender)
		
		// Verify Firestore data sync
		profDoc, _ := mock.Collection(COLLECTION).Doc(res.ProfileID).Get(context.Background())
		genderVal := profDoc.Data()["gender"]
		if ptr, ok := genderVal.(*string); ok {
			assert.Equal(t, "Male", *ptr)
		} else {
			assert.Equal(t, "Male", genderVal)
		}
	})

	t.Run("CreateProfile_SingleSelectViolation_Returns400", func(t *testing.T) {
		mock := &mockClient{collections: make(map[string]*mockCollection)}
		col := mock.Collection(TAGS_COLLECTION).(*mockCollection)
		col.docs = map[string]*mockDoc{
			"t1": {id: "t1", exists: true, data: map[string]interface{}{"category": "gender", "name": "Male", "slug": "gender__male", "multi_select": false}},
			"t2": {id: "t2", exists: true, data: map[string]interface{}{"category": "gender", "name": "Female", "slug": "gender__female", "multi_select": false}},
		}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) { return mock, nil }

		body := ProfileCreate{
			DisplayName: "Hero",
			Tags: []ProfileTag{
				{ID: "t1", Category: "gender", Name: "Male", Slug: "gender__male"},
				{ID: "t2", Category: "gender", Name: "Female", Slug: "gender__female"},
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
}
