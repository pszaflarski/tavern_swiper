package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"cloud.google.com/go/firestore"
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
		b.POST("/:id/profile", handleCreateBotProfile)
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

func TestCreateBotProfile_BotNotFound(t *testing.T) {
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
	// Must pass valid JSON to bypass ShouldBindJSON
	req, _ := http.NewRequest("POST", "/bots/missing-id/profile", bytes.NewBuffer([]byte(`{"display_name": "Test"}`)))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("Expected status 404, got %d", w.Code)
	}
}

func TestCreateBotProfile_Success(t *testing.T) {
	// 1. Setup mock external server for auth, profiles, and image downloading
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" && r.URL.Path == "/test-image.jpg" {
			w.Header().Set("Content-Type", "image/jpeg")
			w.Write([]byte("fake-image-bytes"))
			return
		}

		if r.Method == "POST" && r.URL.Path == "/auth/login" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"id_token": "fake-id-token", "uid": "fake-uid"}`))
			return
		}

		if r.Method == "POST" && r.URL.Path == "/auth/verify" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"token": "fake-jwt"}`))
			return
		}

		if r.Method == "POST" && r.URL.Path == "/profiles/" {
			w.Header().Set("Content-Type", "application/json")
			// Return a profile_id
			w.Write([]byte(`{"profile_id": "test-profile-id", "display_name": "Test Bot"}`))
			return
		}

		if r.Method == "POST" && strings.HasPrefix(r.URL.Path, "/profiles/test-profile-id/image") {
			w.Header().Set("Content-Type", "application/json")
			// Return updated profile
			w.Write([]byte(`{"profile_id": "test-profile-id", "display_name": "Test Bot", "image_urls": ["http://fake.url/image.jpg"]}`))
			return
		}

		w.WriteHeader(http.StatusNotFound)
	}))
	defer mockServer.Close()

	// 2. Set up serviceURLs and KMS fallback
	os.Setenv("FIREBASE_AUTH_EMULATOR_HOST", "localhost:9099")
	serviceURLs.mu.Lock()
	serviceURLs.urls["auth"] = mockServer.URL
	serviceURLs.urls["profiles"] = mockServer.URL
	serviceURLs.mu.Unlock()

	r := setupTestRouter()

	// 3. Mock DB
	originalDBFunc := getDBFunc
	defer func() { getDBFunc = originalDBFunc }()

	var savedBotProfileData map[string]interface{}

	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &mockClient{
			collectionFunc: func(path string) FirestoreCollection {
				return mockCollection{
					docFunc: func(docPath string) FirestoreDocument {
						return mockDoc{
							getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
								if path == BOT_USERS_COLLECTION {
									return mockSnapshot{
										exists: true,
										data: map[string]interface{}{
											"slug":               "testbot",
											"email":              "testbot@test.com",
											"encrypted_password": "cGFzc3dvcmQxMjM=",
										},
									}, nil
								}
								return mockSnapshot{exists: false}, nil
							},
							setFunc: func(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
								if path == BOT_PROFILES_COLLECTION {
									if m, ok := data.(map[string]interface{}); ok {
										savedBotProfileData = m
									}
								}
								return nil, nil
							},
						}
					},
				}
			},
		}, nil
	}

	w := httptest.NewRecorder()
	
	payload := BotProfileCreate{
		DisplayName:  "Test Bot",
		BehaviorType: "tavern_keeper",
		ImageLinks:   []string{mockServer.URL + "/test-image.jpg"},
	}
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequest("POST", "/bots/valid-id/profile", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("Expected status 201, got %d: %s", w.Code, w.Body.String())
	}

	// Verify bot_profile record was saved with correct data
	if savedBotProfileData != nil {
		if savedBotProfileData["bot_user_id"] != "valid-id" {
			t.Errorf("Expected bot_user_id 'valid-id', got '%v'", savedBotProfileData["bot_user_id"])
		}
		if savedBotProfileData["profile_id"] != "test-profile-id" {
			t.Errorf("Expected profile_id 'test-profile-id', got '%v'", savedBotProfileData["profile_id"])
		}
		if savedBotProfileData["behavior_type"] != "tavern_keeper" {
			t.Errorf("Expected behavior_type 'tavern_keeper', got '%v'", savedBotProfileData["behavior_type"])
		}
	}
}
