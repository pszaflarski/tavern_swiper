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
	// "m-skipped" is already newer than BQ event
	mockDB.Collection("discovery_matches_cache").Doc("m-skipped").Set(context.Background(), map[string]interface{}{
		"match_id":   "m-skipped",
		"updated_at": time.Now().Add(time.Hour), // Future timestamp
	})
	// "m-delete" exists and needs to be deleted
	mockDB.Collection("discovery_matches_cache").Doc("m-delete").Set(context.Background(), map[string]interface{}{
		"match_id":   "m-delete",
		"updated_at": time.Now().Add(-time.Hour),
	})

	// BQ event records to return
	eventTime := time.Now()
	rows := []interface{}{
		ReconcileRow{
			DocumentID:     "m-skipped",
			Action:         "UPSERT_CACHE",
			EventTimestamp: eventTime,
			Payload:        `{"match_id":"m-skipped","profile_ids":["p1","p2"]}`,
		},
		ReconcileRow{
			DocumentID:     "m-delete",
			Action:         "DELETE_CACHE",
			EventTimestamp: eventTime,
			Payload:        "",
		},
		ReconcileRow{
			DocumentID:     "m-upsert",
			Action:         "UPSERT_CACHE",
			EventTimestamp: eventTime,
			Payload:        `{"match_id":"m-upsert","profile_ids":["p3","p4"]}`,
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
	skippedDoc := mockDB.Collection("discovery_matches_cache").Doc("m-skipped").(*mockDoc)
	assert.True(t, skippedDoc.exists)
	assert.Nil(t, skippedDoc.data["profile_ids"])

	deletedDoc := mockDB.Collection("discovery_matches_cache").Doc("m-delete").(*mockDoc)
	assert.False(t, deletedDoc.exists)

	upsertedDoc := mockDB.Collection("discovery_matches_cache").Doc("m-upsert").(*mockDoc)
	assert.True(t, upsertedDoc.exists)
	assert.Equal(t, []interface{}{"p3", "p4"}, upsertedDoc.data["profile_ids"])
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
	mockDB.Collection("discovery_matches_cache").Doc("m-exists-newer").Set(context.Background(), map[string]interface{}{
		"match_id":   "m-exists-newer",
		"updated_at": time.Now().Add(time.Hour),
	})

	// BQ event records to return
	eventTime := time.Now()
	rows := []interface{}{
		InitialLoadRow{
			DocumentID:     "m-exists-newer",
			EventTimestamp: eventTime,
			Payload:        `{"match_id":"m-exists-newer","profile_ids":["p1","p2"]}`,
		},
		InitialLoadRow{
			DocumentID:     "m-new",
			EventTimestamp: eventTime,
			Payload:        `{"match_id":"m-new","profile_ids":["p3","p4"]}`,
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
	newDoc := mockDB.Collection("discovery_matches_cache").Doc("m-new").(*mockDoc)
	assert.True(t, newDoc.exists)
	assert.Equal(t, []interface{}{"p3", "p4"}, newDoc.data["profile_ids"])

	skippedDoc := mockDB.Collection("discovery_matches_cache").Doc("m-exists-newer").(*mockDoc)
	assert.True(t, skippedDoc.exists)
	assert.Nil(t, skippedDoc.data["profile_ids"])
}
