package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"cloud.google.com/go/firestore"
)

// mockBehaviorDB returns a mock client that handles both bot_events (idempotency)
// and bot_profiles (tavern keeper query).
func mockBehaviorDB(profiles []map[string]interface{}) *mockClient {
	return &mockClient{
		collectionFunc: func(path string) FirestoreCollection {
			switch path {
			case "bot_events":
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
			case BOT_PROFILES_COLLECTION:
				// Build an iterator that returns the provided profiles
				idx := 0
				return mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
								return mockSnapshot{exists: false}, nil
							},
						}
					},
					whereFunc: func(p, op string, val interface{}) FirestoreQuery {
						if p == "profile_id" {
							// Bot check query — target is NOT a bot, return empty
							return &mockQuery{
								documentsFunc: func(ctx context.Context) FirestoreDocumentIterator {
									return &mockIterator{
										nextFunc: func() (FirestoreDocumentSnapshot, error) {
											return nil, fmt.Errorf("not found")
										},
									}
								},
							}
						}
						// behavior_type query — return the tavern keeper profiles
						return &mockQuery{
							documentsFunc: func(ctx context.Context) FirestoreDocumentIterator {
								return &mockIterator{
									nextFunc: func() (FirestoreDocumentSnapshot, error) {
										if idx >= len(profiles) {
											return nil, fmt.Errorf("iterator done")
										}
										snap := mockSnapshot{
											exists: true,
											data:   profiles[idx],
											id:     fmt.Sprintf("bp-%d", idx),
										}
										idx++
										return snap, nil
									},
								}
							},
						}
					},
				}
			case BOT_USERS_COLLECTION:
				return mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
								return mockSnapshot{
									exists: true,
									data: map[string]interface{}{
										"email":              "bot-test@bots.tavernswiper.internal",
										"encrypted_password": "test-encrypted",
									},
								}, nil
							},
						}
					},
				}
			default:
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
			}
		},
	}
}

func TestHandleBehaviorTrigger_Success_NoProfiles(t *testing.T) {
	originalDBFunc := getDBFunc
	defer func() { getDBFunc = originalDBFunc }()

	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mockBehaviorDB(nil), nil // no tavern keeper profiles
	}
	router := setupTestRouter()

	reqPayload := BehaviorTriggerRequest{
		Trigger: "profile_created",
		Context: map[string]interface{}{
			"profile_id": "test-prof-123",
		},
	}
	body, _ := json.Marshal(reqPayload)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/bots/behaviors/trigger", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var resp BehaviorTriggerResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Triggered != 0 {
		t.Errorf("Expected 0 triggered, got %d", resp.Triggered)
	}
}

func TestHandleBehaviorTrigger_WithTavernKeeper(t *testing.T) {
	originalDBFunc := getDBFunc
	defer func() { getDBFunc = originalDBFunc }()

	// Mock a tavern keeper profile
	profiles := []map[string]interface{}{
		{
			"bot_user_id":   "bot-user-1",
			"profile_id":    "keeper-profile-1",
			"agent_name":    "grogmar",
			"behavior_type": "tavern_keeper",
		},
	}

	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mockBehaviorDB(profiles), nil
	}
	router := setupTestRouter()

	reqPayload := BehaviorTriggerRequest{
		Trigger: "profile_created",
		Context: map[string]interface{}{
			"profile_id": "new-user-profile-42",
		},
	}
	body, _ := json.Marshal(reqPayload)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/bots/behaviors/trigger", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	// The swipe itself will fail because we don't have real auth/discovery services,
	// but the handler should still return 200 with error details in the response.
	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var resp BehaviorTriggerResponse
	json.Unmarshal(w.Body.Bytes(), &resp)

	// Should have attempted 1 profile (even if auth fails)
	if len(resp.Details) == 0 {
		t.Error("Expected at least one detail message")
	}
}

func TestHandleBehaviorTrigger_SkipsBotProfile(t *testing.T) {
	originalDBFunc := getDBFunc
	defer func() { getDBFunc = originalDBFunc }()

	// The target profile_id exists in bot_profiles — should be skipped entirely
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &mockClient{
			collectionFunc: func(path string) FirestoreCollection {
				switch path {
				case "bot_events":
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
				case BOT_PROFILES_COLLECTION:
					return mockCollection{
						docFunc: func(id string) FirestoreDocument {
							return mockDoc{
								getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
									return mockSnapshot{exists: false}, nil
								},
							}
						},
						whereFunc: func(p, op string, val interface{}) FirestoreQuery {
							// When checking profile_id == target, return a match
							if p == "profile_id" {
								return &mockQuery{
									documentsFunc: func(ctx context.Context) FirestoreDocumentIterator {
										called := false
										return &mockIterator{
											nextFunc: func() (FirestoreDocumentSnapshot, error) {
												if called {
													return nil, fmt.Errorf("done")
												}
												called = true
												return mockSnapshot{
													exists: true,
													data:   map[string]interface{}{"profile_id": "bot-target-profile"},
												}, nil
											},
										}
									},
								}
							}
							// behavior_type query — shouldn't be reached
							return &mockQuery{}
						},
					}
				default:
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
				}
			},
		}, nil
	}
	router := setupTestRouter()

	reqPayload := BehaviorTriggerRequest{
		Trigger: "profile_created",
		Context: map[string]interface{}{
			"profile_id": "bot-target-profile", // this is a bot profile
		},
	}
	body, _ := json.Marshal(reqPayload)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/bots/behaviors/trigger", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var resp BehaviorTriggerResponse
	json.Unmarshal(w.Body.Bytes(), &resp)

	if resp.Triggered != 0 {
		t.Errorf("Expected 0 triggered (bot profile should be skipped), got %d", resp.Triggered)
	}
	if len(resp.Details) == 0 || resp.Details[0] != "Target profile bot-target-profile belongs to a bot, skipping" {
		t.Errorf("Expected bot-skip detail message, got %v", resp.Details)
	}
}

func TestHandleBehaviorTrigger_Idempotent(t *testing.T) {
	originalDBFunc := getDBFunc
	defer func() { getDBFunc = originalDBFunc }()

	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &mockClient{
			collectionFunc: func(path string) FirestoreCollection {
				return mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
								// Event already exists
								return mockSnapshot{exists: true}, nil
							},
						}
					},
				}
			},
		}, nil
	}
	router := setupTestRouter()

	reqPayload := BehaviorTriggerRequest{Trigger: "profile_created", Context: map[string]interface{}{"profile_id": "x"}}
	body, _ := json.Marshal(reqPayload)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/bots/behaviors/trigger", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}

	var resp BehaviorTriggerResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Triggered != 0 {
		t.Errorf("Idempotent replay should trigger 0, got %d", resp.Triggered)
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
		return nil, context.DeadlineExceeded
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
