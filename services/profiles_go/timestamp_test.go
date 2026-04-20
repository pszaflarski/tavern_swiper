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

func TestProfileTimestamps(t *testing.T) {
	mockPub := &mockPublisher{}
	r := setupTest(mockPub)
	
	// Mock _now to ensure our test tokens (which use a fixed 2026-04-17 date) are valid
	fixedNow := time.Date(2026, 4, 17, 10, 0, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	t.Run("CreateProfile_PopulatesTimestamps", func(t *testing.T) {
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return &mockClient{
				collections: map[string]*mockCollection{
					COLLECTION: {
						docs: make(map[string]*mockDoc),
					},
				},
			}, nil
		}
		
		payload := ProfileCreate{
			DisplayName: "Timestamp Hero",
		}
		body, _ := json.Marshal(payload)
		req, _ := http.NewRequest("POST", "/profiles/", bytes.NewBuffer(body))
		req.Header.Set("Authorization", "Bearer "+signGoTestToken("u1", "user"))
		req.Header.Set("Content-Type", "application/json")
		
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		
		assert.Equal(t, http.StatusCreated, w.Code)
		
		var resp ProfileOut
		err := json.Unmarshal(w.Body.Bytes(), &resp)
		assert.NoError(t, err)
		
		assert.NotNil(t, resp.CreatedAt, "CreatedAt should not be nil")
		assert.NotNil(t, resp.UpdatedAt, "UpdatedAt should not be nil")
		
		if resp.CreatedAt != nil {
			// Mock ServerTimestamp behaves like time.Now(), which we mocked to fixedNow
			assert.WithinDuration(t, fixedNow, *resp.CreatedAt, time.Second)
		}
		if resp.UpdatedAt != nil {
			assert.WithinDuration(t, fixedNow, *resp.UpdatedAt, time.Second)
		}
	})

	t.Run("UpdateProfile_RefreshesUpdatedAt", func(t *testing.T) {
		oldTime := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
		profileID := "p-update"
		
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return &mockClient{
				collections: map[string]*mockCollection{
					COLLECTION: {
						docs: map[string]*mockDoc{
							profileID: {
								id: profileID,
								exists: true,
								data: map[string]interface{}{
									"user_id":      "u1",
									"display_name": "Old Name",
									"created_at":   oldTime,
									"updated_at":   oldTime,
								},
							},
						},
					},
				},
			}, nil
		}
		
		payload := ProfileUpdate{
			DisplayName: strPtr("New Name"),
		}
		body, _ := json.Marshal(payload)
		req, _ := http.NewRequest("PUT", "/profiles/"+profileID, bytes.NewBuffer(body))
		req.Header.Set("Authorization", "Bearer "+signGoTestToken("u1", "user"))
		req.Header.Set("Content-Type", "application/json")
		
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		
		assert.Equal(t, http.StatusOK, w.Code)
		
		var resp ProfileOut
		err := json.Unmarshal(w.Body.Bytes(), &resp)
		assert.NoError(t, err)
		
		assert.NotNil(t, resp.CreatedAt, "CreatedAt should not be nil")
		assert.NotNil(t, resp.UpdatedAt, "UpdatedAt should not be nil")
		
		if resp.CreatedAt != nil {
			assert.Equal(t, oldTime, *resp.CreatedAt)
		}
		if resp.UpdatedAt != nil {
			assert.True(t, resp.UpdatedAt.After(oldTime), "UpdatedAt should be refreshed")
			assert.WithinDuration(t, fixedNow, *resp.UpdatedAt, time.Second)
		}
	})
}

func strPtr(s string) *string {
	return &s
}
