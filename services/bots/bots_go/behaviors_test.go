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
		BehaviorType: "tavern_keeper",
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
