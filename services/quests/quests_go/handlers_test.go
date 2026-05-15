package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func signToken(uid, role string) string {
	claims := jwt.MapClaims{
		"sub":  uid,
		"role": role,
		"iat":  time.Now().Unix(),
		"exp":  time.Now().Add(time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := token.SignedString(jwtSecret)
	return s
}

func setupTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.Default()
	r.Use(AuthMiddleware())

	r.GET("/quests/health", handleHealth)
	q := r.Group("/quests")
	{
		q.POST("/items/", handleCreateItem)
		q.GET("/items/", handleListItems)
		q.GET("/items/:item_id", handleGetItem)
		q.PUT("/items/:item_id", handleUpdateItem)
		q.DELETE("/items/:item_id", handleDeleteItem)
		q.GET("/inventory/:user_id", handleGetInventory)
		q.POST("/inventory/grant", handleGrantItem)
		q.POST("/inventory/deduct", handleDeductItem)
	}

	return r
}

// =============================================================================
// Health
// =============================================================================

func TestHealth(t *testing.T) {
	r := setupTestRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/quests/health", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
}

// =============================================================================
// Item Definition CRUD
// =============================================================================

func TestCreateItem_AdminOnly(t *testing.T) {
	// Mock DB
	var capturedData interface{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &mockClient{
			collectionFunc: func(path string) FirestoreCollection {
				return mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							id: id,
							setFunc: func(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
								capturedData = data
								return nil, nil
							},
						}
					},
				}
			},
		}, nil
	}

	r := setupTestRouter()

	// Non-admin should be rejected
	w := httptest.NewRecorder()
	body := `{"name":"Gold Coin","category":"currency","rarity":"common"}`
	req, _ := http.NewRequest("POST", "/quests/items/", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+signToken("user1", "user"))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusForbidden, w.Code)

	// Admin should succeed
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("POST", "/quests/items/", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+signToken("admin1", "root_admin"))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusCreated, w.Code)
	assert.NotNil(t, capturedData)

	var resp ItemDefinition
	json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, "Gold Coin", resp.Name)
	assert.Equal(t, "currency", resp.Category)
	assert.Equal(t, "common", resp.Rarity)
}

func TestCreateItem_InvalidCategory(t *testing.T) {
	r := setupTestRouter()
	w := httptest.NewRecorder()
	body := `{"name":"Bad Item","category":"invalid","rarity":"common"}`
	req, _ := http.NewRequest("POST", "/quests/items/", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+signToken("admin1", "root_admin"))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestListItems_BotAllowed(t *testing.T) {
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &mockClient{
			collectionFunc: func(path string) FirestoreCollection {
				return mockCollection{
					documentsFunc: func(ctx context.Context) FirestoreDocumentIterator {
						return &mockIterator{
							getAllFunc: func() ([]FirestoreDocumentSnapshot, error) {
								return []FirestoreDocumentSnapshot{
									mockSnapshot{
										exists: true,
										id:     "item1",
										data: map[string]interface{}{
											"name":     "Gold Coin",
											"category": "currency",
											"rarity":   "common",
										},
									},
								}, nil
							},
						}
					},
				}
			},
		}, nil
	}

	r := setupTestRouter()

	// Bot should be allowed
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/quests/items/", nil)
	req.Header.Set("Authorization", "Bearer "+signToken("bot1", "bot"))
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Code)

	// Regular user should be rejected
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", "/quests/items/", nil)
	req.Header.Set("Authorization", "Bearer "+signToken("user1", "user"))
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestGetItem_NotFound(t *testing.T) {
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &mockClient{
			collectionFunc: func(path string) FirestoreCollection {
				return mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							id: id,
							getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
								return nil, status.Error(codes.NotFound, "not found")
							},
						}
					},
				}
			},
		}, nil
	}

	r := setupTestRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/quests/items/nonexistent", nil)
	req.Header.Set("Authorization", "Bearer "+signToken("admin1", "admin"))
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

// =============================================================================
// Inventory
// =============================================================================

func TestGetInventory_OwnOnly(t *testing.T) {
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &mockClient{
			collectionFunc: func(path string) FirestoreCollection {
				return mockCollection{
					whereFunc: func(p, op string, value interface{}) FirestoreQuery {
						return &mockQuery{
							documentsFunc: func(ctx context.Context) FirestoreDocumentIterator {
								return &mockIterator{
									getAllFunc: func() ([]FirestoreDocumentSnapshot, error) {
										return []FirestoreDocumentSnapshot{}, nil
									},
								}
							},
						}
					},
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{id: id}
					},
				}
			},
		}, nil
	}

	r := setupTestRouter()

	// User viewing own inventory should work
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/quests/inventory/user1", nil)
	req.Header.Set("Authorization", "Bearer "+signToken("user1", "user"))
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Code)

	// User viewing someone else's inventory should be rejected
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", "/quests/inventory/user2", nil)
	req.Header.Set("Authorization", "Bearer "+signToken("user1", "user"))
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusForbidden, w.Code)

	// Admin viewing anyone's inventory should work
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", "/quests/inventory/user2", nil)
	req.Header.Set("Authorization", "Bearer "+signToken("admin1", "admin"))
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestGrantItem_UserRejected(t *testing.T) {
	r := setupTestRouter()
	w := httptest.NewRecorder()
	body := `{"user_id":"user1","item_id":"gold","quantity":10}`
	req, _ := http.NewRequest("POST", "/quests/inventory/grant", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+signToken("user1", "user"))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestDeductItem_UserRejected(t *testing.T) {
	r := setupTestRouter()
	w := httptest.NewRecorder()
	body := `{"user_id":"user1","item_id":"gold","quantity":10}`
	req, _ := http.NewRequest("POST", "/quests/inventory/deduct", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+signToken("user1", "user"))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusForbidden, w.Code)
}
