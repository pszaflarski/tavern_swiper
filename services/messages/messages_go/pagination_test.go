package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// helper: seed N messages into a mock conversation with incrementing timestamps
func seedMessages(mock *mockClient, convID string, n int, baseTime time.Time) {
	// Create conversation doc
	mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), map[string]interface{}{
		"id":              convID,
		"participant_ids": []interface{}{"p1", "p2"},
	})
	// Seed messages
	for i := 0; i < n; i++ {
		msgID := fmt.Sprintf("msg%03d", i)
		mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Collection(COLLECTION_MESSAGES).Doc(msgID).Set(context.Background(), map[string]interface{}{
			"sent_by":    "p1",
			"content":    fmt.Sprintf("Message %d", i),
			"type":       "user",
			"created_at": baseTime.Add(time.Duration(i) * time.Minute),
		})
	}
}

func TestHandleGetMessages_BackwardsCompat(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)

	t.Run("NoLimitParam_ReturnsBareArray", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		convID := "conv_compat"
		baseTime := time.Date(2026, 5, 17, 10, 0, 0, 0, time.UTC)
		seedMessages(mock, convID, 5, baseTime)

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "admin"})
		c.Params = []gin.Param{{Key: "id", Value: convID}}
		c.Request, _ = http.NewRequest("GET", "/conversations/"+convID+"/messages", nil)

		handleGetMessages(c)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
		}

		// Should be a bare array, NOT a paginated envelope
		var msgs []MessageOut
		if err := json.Unmarshal(w.Body.Bytes(), &msgs); err != nil {
			t.Fatalf("Expected bare array, got error: %v. Body: %s", err, w.Body.String())
		}
		if len(msgs) != 5 {
			t.Errorf("Expected 5 messages, got %d", len(msgs))
		}
		// Verify ASC order
		for i := 1; i < len(msgs); i++ {
			if msgs[i].SentAt < msgs[i-1].SentAt {
				t.Errorf("Messages not in ASC order at index %d", i)
			}
		}
	})
}

func TestHandleGetMessages_Paginated(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)

	t.Run("InitialLoad_ReturnsNewestMessages", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		convID := "conv_paginated"
		baseTime := time.Date(2026, 5, 17, 10, 0, 0, 0, time.UTC)
		seedMessages(mock, convID, 10, baseTime) // 10 messages

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "admin"})
		c.Params = []gin.Param{{Key: "id", Value: convID}}
		c.Request, _ = http.NewRequest("GET", "/conversations/"+convID+"/messages?limit=5", nil)

		handleGetMessages(c)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
		}

		var resp PaginatedMessagesResponse
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("Failed to decode paginated response: %v", err)
		}

		if len(resp.Messages) != 5 {
			t.Errorf("Expected 5 messages, got %d", len(resp.Messages))
		}
		if !resp.HasMore {
			t.Error("Expected has_more=true (10 messages, limit=5)")
		}

		// Messages should be in ASC order (oldest first in the returned page)
		for i := 1; i < len(resp.Messages); i++ {
			if resp.Messages[i].SentAt < resp.Messages[i-1].SentAt {
				t.Errorf("Messages not in ASC order at index %d", i)
			}
		}

		// Should contain the 5 newest messages (Message 5..9)
		if resp.Messages[0].Content != "Message 5" {
			t.Errorf("Expected oldest in page to be 'Message 5', got '%s'", resp.Messages[0].Content)
		}
		if resp.Messages[4].Content != "Message 9" {
			t.Errorf("Expected newest in page to be 'Message 9', got '%s'", resp.Messages[4].Content)
		}
	})

	t.Run("BeforeCursor_LoadsOlderMessages", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		convID := "conv_before"
		baseTime := time.Date(2026, 5, 17, 10, 0, 0, 0, time.UTC)
		seedMessages(mock, convID, 10, baseTime)

		// Use Message 5's timestamp as the cursor (10:05:00)
		cursorTime := baseTime.Add(5 * time.Minute).Format(time.RFC3339)
		url := fmt.Sprintf("/conversations/%s/messages?limit=3&before=%s", convID, cursorTime)

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "admin"})
		c.Params = []gin.Param{{Key: "id", Value: convID}}
		c.Request, _ = http.NewRequest("GET", url, nil)

		handleGetMessages(c)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
		}

		var resp PaginatedMessagesResponse
		json.Unmarshal(w.Body.Bytes(), &resp)

		if len(resp.Messages) != 3 {
			t.Errorf("Expected 3 messages before cursor, got %d", len(resp.Messages))
		}
		if !resp.HasMore {
			t.Error("Expected has_more=true (5 messages before cursor, limit=3)")
		}

		// Should contain Messages 2, 3, 4 (the 3 newest before the cursor)
		if resp.Messages[0].Content != "Message 2" {
			t.Errorf("Expected 'Message 2', got '%s'", resp.Messages[0].Content)
		}
		if resp.Messages[2].Content != "Message 4" {
			t.Errorf("Expected 'Message 4', got '%s'", resp.Messages[2].Content)
		}

		// Verify ASC order within the page
		for i := 1; i < len(resp.Messages); i++ {
			if resp.Messages[i].SentAt < resp.Messages[i-1].SentAt {
				t.Errorf("Messages not in ASC order at index %d", i)
			}
		}
	})

	t.Run("AfterCursor_LoadsNewerMessages", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		convID := "conv_after"
		baseTime := time.Date(2026, 5, 17, 10, 0, 0, 0, time.UTC)
		seedMessages(mock, convID, 10, baseTime)

		// Use Message 7's timestamp as the cursor (10:07:00)
		cursorTime := baseTime.Add(7 * time.Minute).Format(time.RFC3339)
		url := fmt.Sprintf("/conversations/%s/messages?limit=50&after=%s", convID, cursorTime)

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "admin"})
		c.Params = []gin.Param{{Key: "id", Value: convID}}
		c.Request, _ = http.NewRequest("GET", url, nil)

		handleGetMessages(c)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
		}

		var resp PaginatedMessagesResponse
		json.Unmarshal(w.Body.Bytes(), &resp)

		// Messages 8 and 9 are after the cursor
		if len(resp.Messages) != 2 {
			t.Errorf("Expected 2 messages after cursor, got %d", len(resp.Messages))
		}
		if !resp.HasMore {
			// 2 messages returned, limit is 50, so has_more should be false
			t.Log("Note: has_more should be false when fewer results than limit")
		}
		if resp.HasMore {
			t.Error("Expected has_more=false (only 2 messages after cursor, limit=50)")
		}

		if len(resp.Messages) > 0 && resp.Messages[0].Content != "Message 8" {
			t.Errorf("Expected 'Message 8', got '%s'", resp.Messages[0].Content)
		}
	})

	t.Run("HasMore_False_WhenExhausted", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		convID := "conv_exhausted"
		baseTime := time.Date(2026, 5, 17, 10, 0, 0, 0, time.UTC)
		seedMessages(mock, convID, 3, baseTime) // Only 3 messages

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "admin"})
		c.Params = []gin.Param{{Key: "id", Value: convID}}
		c.Request, _ = http.NewRequest("GET", "/conversations/"+convID+"/messages?limit=50", nil)

		handleGetMessages(c)

		var resp PaginatedMessagesResponse
		json.Unmarshal(w.Body.Bytes(), &resp)

		if len(resp.Messages) != 3 {
			t.Errorf("Expected 3 messages, got %d", len(resp.Messages))
		}
		if resp.HasMore {
			t.Error("Expected has_more=false (3 messages, limit=50)")
		}
	})

	t.Run("LimitCap_100", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		convID := "conv_cap"
		baseTime := time.Date(2026, 5, 17, 10, 0, 0, 0, time.UTC)
		seedMessages(mock, convID, 5, baseTime)

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "admin"})
		c.Params = []gin.Param{{Key: "id", Value: convID}}
		// Request limit=999 — should be capped to 100
		c.Request, _ = http.NewRequest("GET", "/conversations/"+convID+"/messages?limit=999", nil)

		handleGetMessages(c)

		var resp PaginatedMessagesResponse
		json.Unmarshal(w.Body.Bytes(), &resp)

		// With only 5 messages, the capped limit of 100 should still return all
		if len(resp.Messages) != 5 {
			t.Errorf("Expected 5 messages (capped limit), got %d", len(resp.Messages))
		}
		if resp.HasMore {
			t.Error("Expected has_more=false")
		}
	})

	t.Run("InvalidLimit_DefaultsTo50", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		convID := "conv_invalid_limit"
		baseTime := time.Date(2026, 5, 17, 10, 0, 0, 0, time.UTC)
		seedMessages(mock, convID, 3, baseTime)

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "admin"})
		c.Params = []gin.Param{{Key: "id", Value: convID}}
		c.Request, _ = http.NewRequest("GET", "/conversations/"+convID+"/messages?limit=abc", nil)

		handleGetMessages(c)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200, got %d", w.Code)
		}

		var resp PaginatedMessagesResponse
		json.Unmarshal(w.Body.Bytes(), &resp)

		// Should still work with default limit of 50
		if len(resp.Messages) != 3 {
			t.Errorf("Expected 3 messages with default limit, got %d", len(resp.Messages))
		}
	})

	t.Run("Timestamps_Populated", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		convID := "conv_timestamps"
		baseTime := time.Date(2026, 5, 17, 10, 0, 0, 0, time.UTC)
		seedMessages(mock, convID, 5, baseTime)

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "admin"})
		c.Params = []gin.Param{{Key: "id", Value: convID}}
		c.Request, _ = http.NewRequest("GET", "/conversations/"+convID+"/messages?limit=3", nil)

		handleGetMessages(c)

		var resp PaginatedMessagesResponse
		json.Unmarshal(w.Body.Bytes(), &resp)

		if resp.OldestTimestamp == "" {
			t.Error("Expected oldest_timestamp to be set")
		}
		if resp.NewestTimestamp == "" {
			t.Error("Expected newest_timestamp to be set")
		}
		// Oldest should be before newest
		if resp.OldestTimestamp >= resp.NewestTimestamp {
			t.Errorf("oldest_timestamp (%s) should be before newest_timestamp (%s)",
				resp.OldestTimestamp, resp.NewestTimestamp)
		}
	})

	t.Run("EmptyConversation_Paginated", func(t *testing.T) {
		mock := &mockClient{}
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return mock, nil
		}

		convID := "conv_empty"
		mock.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(context.Background(), map[string]interface{}{
			"id":              convID,
			"participant_ids": []interface{}{"p1", "p2"},
		})

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("auth", AuthData{Role: "admin"})
		c.Params = []gin.Param{{Key: "id", Value: convID}}
		c.Request, _ = http.NewRequest("GET", "/conversations/"+convID+"/messages?limit=50", nil)

		handleGetMessages(c)

		var resp PaginatedMessagesResponse
		json.Unmarshal(w.Body.Bytes(), &resp)

		if len(resp.Messages) != 0 {
			t.Errorf("Expected 0 messages, got %d", len(resp.Messages))
		}
		if resp.HasMore {
			t.Error("Expected has_more=false for empty conversation")
		}
		if resp.OldestTimestamp != "" || resp.NewestTimestamp != "" {
			t.Error("Expected empty timestamps for empty conversation")
		}
	})
}
