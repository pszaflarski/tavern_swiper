package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/googleapis/google-cloudevents-go/cloud/firestoredata"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type MockBQClient struct {
	mock.Mock
}

func (m *MockBQClient) EnsureDatasetAndTables(ctx context.Context) error {
	args := m.Called(ctx)
	return args.Error(0)
}

func (m *MockBQClient) InsertRow(ctx context.Context, row *ChangelogRow) error {
	args := m.Called(ctx, row)
	return args.Error(0)
}

func (m *MockBQClient) Close() error {
	args := m.Called()
	return args.Error(0)
}

func TestHandleMatchesEvent_Insert(t *testing.T) {
	gin.SetMode(gin.TestMode)
	
	// Create test event data
	docData := &firestoredata.DocumentEventData{
		Value: &firestoredata.Document{
			Name: "projects/tavern-swiper-dev/databases/messages-dev/documents/discovery_matches_cache/match_123",
			Fields: map[string]*firestoredata.Value{
				"match_id": {
					ValueType: &firestoredata.Value_StringValue{
						StringValue: "match_123",
					},
				},
				"profile_ids": {
					ValueType: &firestoredata.Value_ArrayValue{
						ArrayValue: &firestoredata.ArrayValue{
							Values: []*firestoredata.Value{
								{ValueType: &firestoredata.Value_StringValue{StringValue: "p1"}},
								{ValueType: &firestoredata.Value_StringValue{StringValue: "p2"}},
							},
						},
					},
				},
			},
			CreateTime: timestamppb.Now(),
			UpdateTime: timestamppb.Now(),
		},
	}

	bodyBytes, err := proto.Marshal(docData)
	assert.NoError(t, err)

	// Mock BQ Client
	mockBQ := new(MockBQClient)
	mockBQ.On("InsertRow", mock.Anything, mock.MatchedBy(func(row *ChangelogRow) bool {
		assert.Equal(t, "match_123", row.DocumentID)
		assert.Equal(t, "INSERT", row.Operation)
		
		var dataMap map[string]interface{}
		err := json.Unmarshal([]byte(row.Data), &dataMap)
		assert.NoError(t, err)
		assert.Equal(t, "match_123", dataMap["match_id"])
		
		profileIds := dataMap["profile_ids"].([]interface{})
		assert.Len(t, profileIds, 2)
		assert.Equal(t, "p1", profileIds[0])
		assert.Equal(t, "p2", profileIds[1])

		return true
	})).Return(nil)

	// Set up Gin Router
	r := gin.Default()
	handlers := NewHandlers(mockBQ)
	r.POST("/", handlers.HandleFirestoreEvent)

	// Perform Request
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/protobuf")
	req.Header.Set("ce-id", "event-12345")
	req.Header.Set("ce-type", "google.cloud.firestore.document.v1.written")
	req.Header.Set("ce-source", "//firestore.googleapis.com/projects/tavern-swiper-dev/databases/messages-dev")
	req.Header.Set("ce-specversion", "1.0")
	req.Header.Set("ce-time", "2026-06-26T12:00:00Z")

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	mockBQ.AssertExpectations(t)
}

func TestHandleMatchesEvent_Delete(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// Create delete event data (only OldValue is present)
	docData := &firestoredata.DocumentEventData{
		OldValue: &firestoredata.Document{
			Name: "projects/tavern-swiper-dev/databases/messages-dev/documents/discovery_matches_cache/match_999",
			Fields: map[string]*firestoredata.Value{
				"match_id": {
					ValueType: &firestoredata.Value_StringValue{
						StringValue: "match_999",
					},
				},
			},
			CreateTime: timestamppb.Now(),
			UpdateTime: timestamppb.Now(),
		},
	}

	bodyBytes, err := proto.Marshal(docData)
	assert.NoError(t, err)

	// Mock BQ Client
	mockBQ := new(MockBQClient)
	mockBQ.On("InsertRow", mock.Anything, mock.MatchedBy(func(row *ChangelogRow) bool {
		assert.Equal(t, "match_999", row.DocumentID)
		assert.Equal(t, "DELETE", row.Operation)
		assert.Equal(t, "{}", row.Data)
		
		var oldDataMap map[string]interface{}
		err := json.Unmarshal([]byte(row.OldData), &oldDataMap)
		assert.NoError(t, err)
		assert.Equal(t, "match_999", oldDataMap["match_id"])

		return true
	})).Return(nil)

	// Set up Gin Router
	r := gin.Default()
	handlers := NewHandlers(mockBQ)
	r.POST("/", handlers.HandleFirestoreEvent)

	// Perform Request
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/protobuf")
	req.Header.Set("ce-id", "event-67890")
	req.Header.Set("ce-type", "google.cloud.firestore.document.v1.deleted")
	req.Header.Set("ce-source", "//firestore.googleapis.com/projects/tavern-swiper-dev/databases/messages-dev")
	req.Header.Set("ce-specversion", "1.0")
	req.Header.Set("ce-time", time.Now().Format(time.RFC3339))

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	mockBQ.AssertExpectations(t)
}
