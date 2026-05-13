package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"google.golang.org/api/iterator"
)

func setupTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()

	r.GET("/bots/health", handleHealth)
	
	// Mock auth middleware for testing
	authMiddleware := func(role string) gin.HandlerFunc {
		return func(c *gin.Context) {
			c.Set("auth", AuthData{
				UID:   "test-user-id",
				Role:  role,
				Email: "test@example.com",
			})
			c.Next()
		}
	}

	b := r.Group("/bots")
	b.Use(authMiddleware("admin"))
	{
		b.GET("/", handleListBots)
		b.GET("/:id", handleGetBot)
	}

	return r
}

func TestHealthCheck(t *testing.T) {
	r := setupTestRouter()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/bots/health", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var response HealthResponse
	err := json.Unmarshal(w.Body.Bytes(), &response)
	if err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if response.Status != "ok" || response.Service != "bots" {
		t.Errorf("Unexpected response body: %v", response)
	}
}

func TestListBots(t *testing.T) {
	r := setupTestRouter()

	// Mock DB
	originalDBFunc := getDBFunc
	defer func() { getDBFunc = originalDBFunc }()

	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		docs := []FirestoreDocumentSnapshot{
			mockSnapshot{
				id:     "bot-1",
				exists: true,
				data: map[string]interface{}{
					"slug":         "testbot1",
					"firebase_uid": "uid-1",
					"email":        "bot-testbot1@bots.tavernswiper.internal",
					"state":        "active",
				},
			},
			mockSnapshot{
				id:     "bot-2",
				exists: true,
				data: map[string]interface{}{
					"slug":         "testbot2",
					"firebase_uid": "uid-2",
					"email":        "bot-testbot2@bots.tavernswiper.internal",
					"state":        "inactive",
				},
			},
		}
		
		idx := 0
		mockIter := &mockIterator{
			nextFunc: func() (FirestoreDocumentSnapshot, error) {
				if idx >= len(docs) {
					return nil, iterator.Done
				}
				doc := docs[idx]
				idx++
				return doc, nil
			},
		}

		return &mockClient{
			collectionFunc: func(path string) FirestoreCollection {
				return mockCollection{
					documentsFunc: func(ctx context.Context) FirestoreDocumentIterator {
						return mockIter
					},
				}
			},
		}, nil
	}

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/bots/", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var response []BotOut
	err := json.Unmarshal(w.Body.Bytes(), &response)
	if err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if len(response) != 2 {
		t.Errorf("Expected 2 bots, got %d", len(response))
	}
	
	if response[0].Slug != "testbot1" || response[1].Slug != "testbot2" {
		t.Errorf("Unexpected bot data: %v", response)
	}
}

func TestGetBot_NotFound(t *testing.T) {
	r := setupTestRouter()

	// Mock DB
	originalDBFunc := getDBFunc
	defer func() { getDBFunc = originalDBFunc }()

	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &mockClient{
			collectionFunc: func(path string) FirestoreCollection {
				return mockCollection{
					docFunc: func(path string) FirestoreDocument {
						return mockDoc{
							getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
								return mockSnapshot{exists: false}, nil
							},
						}
					},
				}
			},
		}, nil
	}

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/bots/missing-id", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("Expected status 404, got %d", w.Code)
	}
}
