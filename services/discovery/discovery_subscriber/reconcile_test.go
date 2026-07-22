package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"google.golang.org/api/iterator"
)

// Mock implementations for BigQuery
type mockBQIterator struct {
	rows  []interface{}
	index int
}

func (m *mockBQIterator) Next(dst interface{}) error {
	if m.index >= len(m.rows) {
		return iterator.Done
	}
	switch d := dst.(type) {
	case *ReconcileRow:
		*d = m.rows[m.index].(ReconcileRow)
	case *InitialLoadRow:
		*d = m.rows[m.index].(InitialLoadRow)
	default:
		return errors.New("unknown destination type")
	}
	m.index++
	return nil
}

type mockBQQuery struct {
	iterator BigQueryIterator
}

func (m *mockBQQuery) Read(ctx context.Context) (BigQueryIterator, error) {
	return m.iterator, nil
}

type mockBQClient struct {
	query *mockBQQuery
}

func (m *mockBQClient) Query(q string) BigQueryQuery {
	return m.query
}

func (m *mockBQClient) Close() error {
	return nil
}

// Helpers to mint test tokens
func mintTestToken(role string, expired bool) string {
	exp := time.Now().Add(time.Hour)
	if expired {
		exp = time.Now().Add(-time.Hour)
	}
	claims := jwt.MapClaims{
		"sub":   "test-user",
		"role":  role,
		"email": "test@example.com",
		"exp":   exp.Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	secret := []byte("super-secret-tavern-key-123")
	tStr, _ := token.SignedString(secret)
	return tStr
}

func TestAuthMiddleware_Unauthorized(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(AuthMiddleware())
	r.POST("/admin/reconcile", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	// Case 1: Missing token
	req, _ := http.NewRequest(http.MethodPost, "/admin/reconcile", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusUnauthorized, w.Code)

	// Case 2: Expired token
	expiredToken := mintTestToken("admin", true)
	req, _ = http.NewRequest(http.MethodPost, "/admin/reconcile", nil)
	req.Header.Set("Authorization", "Bearer "+expiredToken)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusUnauthorized, w.Code)

	// Case 3: Invalid role (user)
	userToken := mintTestToken("user", false)
	req, _ = http.NewRequest(http.MethodPost, "/admin/reconcile", nil)
	req.Header.Set("Authorization", "Bearer "+userToken)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestAuthMiddleware_Authorized(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(AuthMiddleware())
	r.POST("/admin/reconcile", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	adminToken := mintTestToken("admin", false)
	req, _ := http.NewRequest(http.MethodPost, "/admin/reconcile", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestHandleReconcile_SelfHeal(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/admin/reconcile", HandleReconcile)

	// Mock database setup
	mockDB := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mockDB, nil
	}

	// Preset records in mock Firestore database:
	// "p-skipped" is already newer than BQ event
	mockDB.Collection("profiles_profiles_cache").Doc("p-skipped").Set(context.Background(), map[string]interface{}{
		"profile_id": "p-skipped",
		"updated_at": time.Now().Add(time.Hour), // Future timestamp
	})
	// "p-delete" exists and needs to be deleted
	mockDB.Collection("profiles_profiles_cache").Doc("p-delete").Set(context.Background(), map[string]interface{}{
		"profile_id": "p-delete",
		"updated_at": time.Now().Add(-time.Hour),
	})

	// BQ event records to return
	eventTime := time.Now()
	rows := []interface{}{
		ReconcileRow{
			DocumentID:     "p-skipped",
			Action:         "UPSERT_CACHE",
			EventTimestamp: eventTime,
			Payload:        `{"profile_id":"p-skipped","display_name":"Old Name"}`,
		},
		ReconcileRow{
			DocumentID:     "p-delete",
			Action:         "DELETE_CACHE",
			EventTimestamp: eventTime,
			Payload:        "",
		},
		ReconcileRow{
			DocumentID:     "p-upsert",
			Action:         "UPSERT_CACHE",
			EventTimestamp: eventTime,
			Payload:        `{"profile_id":"p-upsert","display_name":"Healed Profile"}`,
		},
	}

	mockBQ := &mockBQClient{
		query: &mockBQQuery{
			iterator: &mockBQIterator{rows: rows},
		},
	}

	getBQClientFunc = func(ctx context.Context, projectID string) (BigQueryClient, error) {
		return mockBQ, nil
	}

	req, _ := http.NewRequest(http.MethodPost, "/admin/reconcile", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	assert.NoError(t, err)

	assert.Equal(t, float64(1), resp["upserts_healed"])
	assert.Equal(t, float64(1), resp["deletes_healed"])
	assert.Equal(t, float64(1), resp["skipped"])

	// Check final state of Firestore
	skippedDoc := mockDB.Collection("profiles_profiles_cache").Doc("p-skipped").(*mockDoc)
	assert.True(t, skippedDoc.exists)
	// Stale field should NOT be written (was skipped)
	assert.Nil(t, skippedDoc.data["display_name"])

	deletedDoc := mockDB.Collection("profiles_profiles_cache").Doc("p-delete").(*mockDoc)
	assert.False(t, deletedDoc.exists)

	upsertedDoc := mockDB.Collection("profiles_profiles_cache").Doc("p-upsert").(*mockDoc)
	assert.True(t, upsertedDoc.exists)
	assert.Equal(t, "Healed Profile", upsertedDoc.data["display_name"])
}

func TestHandleInitialLoad_Seeding(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/admin/initial-load", HandleInitialLoad)

	// Mock database setup
	mockDB := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mockDB, nil
	}

	// Preset a newer record to trigger skip
	mockDB.Collection("profiles_profiles_cache").Doc("p-exists-newer").Set(context.Background(), map[string]interface{}{
		"profile_id": "p-exists-newer",
		"updated_at": time.Now().Add(time.Hour),
	})

	// BQ event records to return
	eventTime := time.Now()
	rows := []interface{}{
		InitialLoadRow{
			DocumentID:     "p-exists-newer",
			EventTimestamp: eventTime,
			Payload:        `{"profile_id":"p-exists-newer","display_name":"Should skip"}`,
		},
		InitialLoadRow{
			DocumentID:     "p-new",
			EventTimestamp: eventTime,
			Payload:        `{"profile_id":"p-new","display_name":"Seeded"}`,
		},
	}

	mockBQ := &mockBQClient{
		query: &mockBQQuery{
			iterator: &mockBQIterator{rows: rows},
		},
	}

	getBQClientFunc = func(ctx context.Context, projectID string) (BigQueryClient, error) {
		return mockBQ, nil
	}

	req, _ := http.NewRequest(http.MethodPost, "/admin/initial-load", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	assert.NoError(t, err)

	assert.Equal(t, float64(1), resp["total_seeded"])
	assert.Equal(t, float64(1), resp["skipped"])

	// Check final state
	newDoc := mockDB.Collection("profiles_profiles_cache").Doc("p-new").(*mockDoc)
	assert.True(t, newDoc.exists)
	assert.Equal(t, "Seeded", newDoc.data["display_name"])

	skippedDoc := mockDB.Collection("profiles_profiles_cache").Doc("p-exists-newer").(*mockDoc)
	assert.True(t, skippedDoc.exists)
	assert.Nil(t, skippedDoc.data["display_name"])
}
