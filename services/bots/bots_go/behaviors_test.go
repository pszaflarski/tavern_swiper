package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"cloud.google.com/go/firestore"
)

func TestHandleBehaviorTrigger_Success(t *testing.T) {
	originalDBFunc := getDBFunc
	defer func() { getDBFunc = originalDBFunc }()

	mockDB := &mockClient{
		collectionFunc: func(path string) FirestoreCollection {
			return mockCollection{
				docFunc: func(id string) FirestoreDocument {
					return mockDoc{
						getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
							return mockSnapshot{exists: false}, nil
						},
						setFunc: func(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
							return &firestore.WriteResult{}, nil
						},
					}
				},
			}
		},
	}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mockDB, nil
	}
	router := setupTestRouter()

	reqPayload := BehaviorTriggerRequest{
		Trigger:      "profile_created",
		Context: map[string]interface{}{
			"profile_id": "test-prof-123",
		},
	}
	body, _ := json.Marshal(reqPayload)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/bots/behaviors/trigger", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")

	// We don't need real auth here since setupTestRouter mocks it
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestHandleBehaviorTrigger_InvalidJSON(t *testing.T) {
	router := setupTestRouter()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/bots/behaviors/trigger", bytes.NewBuffer([]byte("{invalid-json}")))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Code)
	}
}

func TestHandleBehaviorTrigger_DBError(t *testing.T) {
	originalDBFunc := getDBFunc
	defer func() { getDBFunc = originalDBFunc }()

	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return nil, context.DeadlineExceeded // simulate DB error
	}
	router := setupTestRouter()

	reqPayload := BehaviorTriggerRequest{Trigger: "profile_created", Context: map[string]interface{}{}}
	body, _ := json.Marshal(reqPayload)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/bots/behaviors/trigger", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("Expected status 500, got %d", w.Code)
	}
}
