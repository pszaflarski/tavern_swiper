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

// =============================================================================
// Checkpoint Tests
// =============================================================================

// setupCheckpointRouter creates a router with quest status + checkpoint routes
func setupCheckpointRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.Default()
	r.Use(AuthMiddleware())

	q := r.Group("/quests")
	{
		q.POST("/status/", handleUpdateQuestStatus)
		q.GET("/templates/:quest_id/checkpoints", handleListCheckpointTemplates)
		q.POST("/checkpoints/", handleCreateCheckpointTemplate)
		q.GET("/checkpoints/status/:user_id/:quest_id", handleGetCheckpointStatuses)
		q.GET("/checkpoints/by-bot/:bot_id", handleGetCheckpointsByBot)
	}
	return r
}

// routingMockClient dispatches Collection() calls based on the collection path,
// allowing different mock behaviors per collection.
type routingMockClient struct {
	FirestoreClient
	collections map[string]FirestoreCollection
}

func (r *routingMockClient) Collection(path string) FirestoreCollection {
	if c, ok := r.collections[path]; ok {
		return c
	}
	// Default: return empty collection
	return mockCollection{
		docFunc: func(id string) FirestoreDocument {
			return mockDoc{
				id: id,
				getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
					return nil, status.Error(codes.NotFound, "not found")
				},
				setFunc: func(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
					return nil, nil
				},
			}
		},
		documentsFunc: func(ctx context.Context) FirestoreDocumentIterator {
			return &mockIterator{getAllFunc: func() ([]FirestoreDocumentSnapshot, error) {
				return []FirestoreDocumentSnapshot{}, nil
			}}
		},
		whereFunc: func(p, op string, value interface{}) FirestoreQuery {
			return &mockQuery{
				documentsFunc: func(ctx context.Context) FirestoreDocumentIterator {
					return &mockIterator{getAllFunc: func() ([]FirestoreDocumentSnapshot, error) {
						return []FirestoreDocumentSnapshot{}, nil
					}}
				},
			}
		},
	}
}
func (r *routingMockClient) Batch() FirestoreWriteBatch { return mockBatch{} }
func (r *routingMockClient) Close() error               { return nil }

func TestQuestCompletion_SingleCheckpoint(t *testing.T) {
	// Test: completing a quest that has 1 checkpoint should complete the checkpoint
	// AND the quest in a single call (backward compatible behavior)

	var capturedQuestStatus interface{}
	var capturedCheckpointStatus interface{}

	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &routingMockClient{
			collections: map[string]FirestoreCollection{
				// quest_templates: return a valid quest template
				"quest_templates": mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							id: id,
							getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
								return mockSnapshot{
									exists: true,
									id:     "oi_ya_git",
									data: map[string]interface{}{
										"quest_id":   "oi_ya_git",
										"title":      "OI YA GIT!",
										"quest_type": "story",
										"status":     "active",
										"rewards": []interface{}{
											map[string]interface{}{"item_id": "dice_d6", "quantity": int64(1)},
										},
									},
								}, nil
							},
						}
					},
				},
				// checkpoint_templates: return 1 checkpoint
				"checkpoint_templates": mockCollection{
					whereFunc: func(p, op string, value interface{}) FirestoreQuery {
						return &mockQuery{
							documentsFunc: func(ctx context.Context) FirestoreDocumentIterator {
								return &mockIterator{
									getAllFunc: func() ([]FirestoreDocumentSnapshot, error) {
										return []FirestoreDocumentSnapshot{
											mockSnapshot{
												exists: true,
												id:     "send_message_to_grogmar",
												data: map[string]interface{}{
													"quest_id":    "oi_ya_git",
													"bot_id":      "grogmar",
													"description": "Send a message to Grogmar",
													"sort_order":  int64(1),
												},
											},
										}, nil
									},
								}
							},
						}
					},
				},
				// checkpoint_status: no completions yet
				"checkpoint_status": mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							id: id,
							setFunc: func(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
								capturedCheckpointStatus = data
								return nil, nil
							},
						}
					},
					whereFunc: func(p, op string, value interface{}) FirestoreQuery {
						return &mockQuery{
							whereFunc: func(p, op string, value interface{}) FirestoreQuery {
								return &mockQuery{
									documentsFunc: func(ctx context.Context) FirestoreDocumentIterator {
										return &mockIterator{
											getAllFunc: func() ([]FirestoreDocumentSnapshot, error) {
												return []FirestoreDocumentSnapshot{}, nil // no completions yet
											},
										}
									},
								}
							},
							documentsFunc: func(ctx context.Context) FirestoreDocumentIterator {
								return &mockIterator{
									getAllFunc: func() ([]FirestoreDocumentSnapshot, error) {
										return []FirestoreDocumentSnapshot{}, nil
									},
								}
							},
						}
					},
				},
				// quest_status: no existing status
				"quest_status": mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							id: id,
							getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
								return nil, status.Error(codes.NotFound, "not found")
							},
							setFunc: func(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
								capturedQuestStatus = data
								return nil, nil
							},
						}
					},
				},
				// user_inventory: for reward granting
				"user_inventory": mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							id: id,
							getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
								return nil, status.Error(codes.NotFound, "not found")
							},
							setFunc: func(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
								return nil, nil
							},
						}
					},
				},
				// item_definitions: for reward granting
				"item_definitions": mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							id: id,
							getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
								return mockSnapshot{
									exists: true,
									id:     "dice_d6",
									data: map[string]interface{}{
										"name":      "D6 Die",
										"max_stack": int64(0),
									},
								}, nil
							},
						}
					},
				},
			},
		}, nil
	}

	r := setupCheckpointRouter()
	w := httptest.NewRecorder()
	body := `{"quest_id":"oi_ya_git","user_id":"user1","profile_id":"profile1","status":"completed"}`
	req, _ := http.NewRequest("POST", "/quests/status/", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+signToken("bot1", "bot"))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	// Parse response — should show "completed" status
	var resp QuestStatus
	json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, "completed", resp.Status)
	assert.Equal(t, "oi_ya_git", resp.QuestID)
	assert.Equal(t, "user1", resp.UserID)

	// Verify checkpoint was written
	assert.NotNil(t, capturedCheckpointStatus)
	// Verify quest status was written
	assert.NotNil(t, capturedQuestStatus)
}

func TestQuestCompletion_NoCheckpoints_BackwardCompat(t *testing.T) {
	// Test: quest with NO checkpoints should complete directly (old behavior)

	var capturedQuestStatus interface{}

	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &routingMockClient{
			collections: map[string]FirestoreCollection{
				"quest_templates": mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							id: id,
							getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
								return mockSnapshot{
									exists: true,
									id:     "legacy_quest",
									data: map[string]interface{}{
										"quest_id":   "legacy_quest",
										"title":      "Legacy Quest",
										"quest_type": "story",
										"status":     "active",
										"rewards":    []interface{}{},
									},
								}, nil
							},
						}
					},
				},
				// checkpoint_templates: empty — no checkpoints
				"checkpoint_templates": mockCollection{
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
				},
				"quest_status": mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							id: id,
							getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
								return nil, status.Error(codes.NotFound, "not found")
							},
							setFunc: func(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
								capturedQuestStatus = data
								return nil, nil
							},
						}
					},
				},
			},
		}, nil
	}

	r := setupCheckpointRouter()
	w := httptest.NewRecorder()
	body := `{"quest_id":"legacy_quest","user_id":"user1","profile_id":"profile1","status":"completed"}`
	req, _ := http.NewRequest("POST", "/quests/status/", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+signToken("bot1", "bot"))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp QuestStatus
	json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, "completed", resp.Status, "Quest with no checkpoints should complete directly")
	assert.NotNil(t, capturedQuestStatus)
}

func TestQuestCompletion_AlreadyCompleted_409(t *testing.T) {
	// Test: calling complete on an already-completed quest returns 409

	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &routingMockClient{
			collections: map[string]FirestoreCollection{
				"quest_templates": mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							id: id,
							getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
								return mockSnapshot{
									exists: true,
									id:     "oi_ya_git",
									data: map[string]interface{}{
										"quest_id":   "oi_ya_git",
										"quest_type": "story",
										"status":     "active",
										"rewards":    []interface{}{},
									},
								}, nil
							},
						}
					},
				},
				"quest_status": mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							id: id,
							getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
								return mockSnapshot{
									exists: true,
									id:     id,
									data: map[string]interface{}{
										"quest_id":   "oi_ya_git",
										"user_id":    "user1",
										"profile_id": "profile1",
										"status":     "completed",
									},
								}, nil
							},
							setFunc: func(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
								return nil, nil
							},
						}
					},
				},
			},
		}, nil
	}

	r := setupCheckpointRouter()
	w := httptest.NewRecorder()
	body := `{"quest_id":"oi_ya_git","user_id":"user1","profile_id":"profile1","status":"completed"}`
	req, _ := http.NewRequest("POST", "/quests/status/", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+signToken("bot1", "bot"))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusConflict, w.Code, "Already-completed quest should return 409")
}

func TestCreateCheckpointTemplate_AdminOnly(t *testing.T) {
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &routingMockClient{
			collections: map[string]FirestoreCollection{
				"quest_templates": mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							id: id,
							getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
								return mockSnapshot{exists: true, id: id, data: map[string]interface{}{}}, nil
							},
						}
					},
				},
				"checkpoint_templates": mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							id: id,
							setFunc: func(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
								return nil, nil
							},
						}
					},
				},
			},
		}, nil
	}

	r := setupCheckpointRouter()

	// Non-admin should be rejected
	w := httptest.NewRecorder()
	body := `{"checkpoint_id":"cp1","quest_id":"q1","description":"Test checkpoint"}`
	req, _ := http.NewRequest("POST", "/quests/checkpoints/", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+signToken("user1", "user"))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusForbidden, w.Code)

	// Admin should succeed
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("POST", "/quests/checkpoints/", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+signToken("admin1", "root_admin"))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusCreated, w.Code)

	var resp CheckpointTemplate
	json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, "cp1", resp.CheckpointID)
	assert.Equal(t, "q1", resp.QuestID)
	assert.Equal(t, "Test checkpoint", resp.Description)
}

func TestQuestCompletion_MultiCheckpoint_AdvancesOneAtATime(t *testing.T) {
	// Test: quest with 2 checkpoints — first call completes checkpoint 1
	// and returns "started" (not "completed")

	var capturedQuestStatus interface{}

	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &routingMockClient{
			collections: map[string]FirestoreCollection{
				"quest_templates": mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							id: id,
							getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
								return mockSnapshot{
									exists: true,
									id:     "multi_quest",
									data: map[string]interface{}{
										"quest_id":   "multi_quest",
										"quest_type": "story",
										"status":     "active",
										"rewards":    []interface{}{},
									},
								}, nil
							},
						}
					},
				},
				// 2 checkpoints
				"checkpoint_templates": mockCollection{
					whereFunc: func(p, op string, value interface{}) FirestoreQuery {
						return &mockQuery{
							documentsFunc: func(ctx context.Context) FirestoreDocumentIterator {
								return &mockIterator{
									getAllFunc: func() ([]FirestoreDocumentSnapshot, error) {
										return []FirestoreDocumentSnapshot{
											mockSnapshot{exists: true, id: "cp1", data: map[string]interface{}{
												"quest_id": "multi_quest", "sort_order": int64(1), "description": "Step 1",
											}},
											mockSnapshot{exists: true, id: "cp2", data: map[string]interface{}{
												"quest_id": "multi_quest", "sort_order": int64(2), "description": "Step 2",
											}},
										}, nil
									},
								}
							},
						}
					},
				},
				// No completions yet
				"checkpoint_status": mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							id: id,
							setFunc: func(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
								return nil, nil
							},
						}
					},
					whereFunc: func(p, op string, value interface{}) FirestoreQuery {
						return &mockQuery{
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
							documentsFunc: func(ctx context.Context) FirestoreDocumentIterator {
								return &mockIterator{
									getAllFunc: func() ([]FirestoreDocumentSnapshot, error) {
										return []FirestoreDocumentSnapshot{}, nil
									},
								}
							},
						}
					},
				},
				"quest_status": mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							id: id,
							getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
								return nil, status.Error(codes.NotFound, "not found")
							},
							setFunc: func(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
								capturedQuestStatus = data
								return nil, nil
							},
						}
					},
				},
			},
		}, nil
	}

	r := setupCheckpointRouter()
	w := httptest.NewRecorder()
	body := `{"quest_id":"multi_quest","user_id":"user1","profile_id":"profile1","status":"completed"}`
	req, _ := http.NewRequest("POST", "/quests/status/", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+signToken("bot1", "bot"))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp QuestStatus
	json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, "started", resp.Status, "Multi-checkpoint quest should return 'started' after completing only 1 of 2 checkpoints")
	assert.NotNil(t, capturedQuestStatus)
}

// =============================================================================
// Bot Checkpoint Discovery
// =============================================================================

func TestGetCheckpointsByBot_BotOnly(t *testing.T) {
	// Mock profile resolution
	origResolve := resolveProfileFunc
	resolveProfileFunc = func(token, profileID string) (string, error) {
		return "user1", nil
	}
	defer func() { resolveProfileFunc = origResolve }()

	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &routingMockClient{
			collections: map[string]FirestoreCollection{
				"checkpoint_templates": mockCollection{
					whereFunc: func(p, op string, value interface{}) FirestoreQuery {
						return &mockQuery{
							documentsFunc: func(ctx context.Context) FirestoreDocumentIterator {
								return &mockIterator{
									getAllFunc: func() ([]FirestoreDocumentSnapshot, error) {
										return []FirestoreDocumentSnapshot{
											mockSnapshot{
												exists: true,
												id:     "send_message_to_grogmar",
												data: map[string]interface{}{
													"quest_id":             "oi_ya_git",
													"bot_id":               "grogmar",
													"description":          "Talk to Grogmar",
													"detailed_description": "Grogmar is a cantankerous orc barkeep",
													"success_criteria":     "User sent a message and Grogmar replied",
													"sort_order":           int64(1),
												},
											},
										}, nil
									},
								}
							},
						}
					},
				},
				"quest_templates": mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							id: id,
							getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
								return mockSnapshot{
									exists: true,
									id:     "oi_ya_git",
									data: map[string]interface{}{
										"title":      "OI YA GIT!",
										"quest_type": "story",
										"status":     "active",
										"rewards": []interface{}{
											map[string]interface{}{"item_id": "dice_d6", "quantity": int64(1)},
										},
									},
								}, nil
							},
						}
					},
				},
				"quest_status": mockCollection{
					whereFunc: func(p, op string, value interface{}) FirestoreQuery {
						return &mockQuery{
							documentsFunc: func(ctx context.Context) FirestoreDocumentIterator {
								return &mockIterator{
									getAllFunc: func() ([]FirestoreDocumentSnapshot, error) {
										return []FirestoreDocumentSnapshot{}, nil // no quest status yet
									},
								}
							},
						}
					},
				},
				"checkpoint_status": mockCollection{
					whereFunc: func(p, op string, value interface{}) FirestoreQuery {
						return &mockQuery{
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
						}
					},
				},
			},
		}, nil
	}

	r := setupCheckpointRouter()

	// Regular user should be rejected
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/quests/checkpoints/by-bot/grogmar?profile_id=profile1", nil)
	req.Header.Set("Authorization", "Bearer "+signToken("user1", "user"))
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusForbidden, w.Code)

	// Bot should succeed and get merged checkpoint data
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", "/quests/checkpoints/by-bot/grogmar?profile_id=profile1", nil)
	req.Header.Set("Authorization", "Bearer "+signToken("bot1", "bot"))
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Code)

	var views []BotCheckpointView
	json.Unmarshal(w.Body.Bytes(), &views)
	assert.Equal(t, 1, len(views))
	assert.Equal(t, "oi_ya_git", views[0].QuestID)
	assert.Equal(t, "OI YA GIT!", views[0].QuestTitle)
	assert.Equal(t, "send_message_to_grogmar", views[0].CheckpointID)
	assert.Equal(t, "Talk to Grogmar", views[0].Description)
	assert.Equal(t, "Grogmar is a cantankerous orc barkeep", views[0].DetailedDescription)
	assert.Equal(t, "User sent a message and Grogmar replied", views[0].SuccessCriteria)
	assert.Equal(t, "not_completed", views[0].Status)
	assert.Equal(t, "not_started", views[0].QuestStatus)
	assert.Equal(t, 1, len(views[0].QuestRewards))
	assert.Equal(t, "dice_d6", views[0].QuestRewards[0].ItemID)
}

func TestGetCheckpointsByBot_MissingProfileID(t *testing.T) {
	r := setupCheckpointRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/quests/checkpoints/by-bot/grogmar", nil)
	req.Header.Set("Authorization", "Bearer "+signToken("bot1", "bot"))
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestGetCheckpointsByBot_NoBotCheckpoints(t *testing.T) {
	origResolve := resolveProfileFunc
	resolveProfileFunc = func(token, profileID string) (string, error) {
		return "user1", nil
	}
	defer func() { resolveProfileFunc = origResolve }()

	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &routingMockClient{
			collections: map[string]FirestoreCollection{
				"checkpoint_templates": mockCollection{
					whereFunc: func(p, op string, value interface{}) FirestoreQuery {
						return &mockQuery{
							documentsFunc: func(ctx context.Context) FirestoreDocumentIterator {
								return &mockIterator{
									getAllFunc: func() ([]FirestoreDocumentSnapshot, error) {
										return []FirestoreDocumentSnapshot{}, nil // no checkpoints
									},
								}
							},
						}
					},
				},
			},
		}, nil
	}

	r := setupCheckpointRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/quests/checkpoints/by-bot/unknown_bot?profile_id=profile1", nil)
	req.Header.Set("Authorization", "Bearer "+signToken("bot1", "bot"))
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Code)

	var views []BotCheckpointView
	json.Unmarshal(w.Body.Bytes(), &views)
	assert.Equal(t, 0, len(views))
}
