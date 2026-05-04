package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
)

func TestUsersResilience_Health(t *testing.T) {
	skipIfRealDB(t)
	r := setupTest()
	req, _ := http.NewRequest("GET", "/users/health", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp HealthResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Service != "users" {
		t.Errorf("Expected service 'users', got %s", resp.Service)
	}
}

func TestUsersResilience_CreateRootAdminSuccess(t *testing.T) {
	skipIfRealDB(t)
	r := setupTest()

	// Mock DB logic
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &mockClient{
			collectionFunc: func(path string) CollectionRef {
				return &mockCollection{
					// Root Admin Check
					whereFunc: func(path, op string, value interface{}) Query {
						return &mockQuery{
							limitFunc: func(n int) Query {
								return &mockQuery{
									documentsFunc: func(ctx context.Context) DocumentIterator {
										return &mockIterator{
											nextFunc: func() (DocumentSnapshot, error) {
												return nil, iterator.Done // No existing root admin
											},
										}
									},
								}
							},
						}
					},
					// Document Check
					docFunc: func(path string) DocumentRef {
						return &mockDoc{
							getFunc: func(ctx context.Context) (DocumentSnapshot, error) {
								return &mockSnapshot{exists: false}, nil // User doesn't exist
							},
							setFunc: func(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
								return nil, nil
							},
						}
					},
				}
			},
		}, nil
	}

	payload := map[string]interface{}{
		"email":     "root@example.com",
		"user_type": "root_admin",
	}
	jsonBody, _ := json.Marshal(payload)
	
	// Root admin type requires a token in the request but the logic checks context auth
	// Sign token for a user (any user can try to create root if none exists)
	token := signGoTestToken("new-root-uid", RootAdmin, "root@example.com")
	
	req, _ := http.NewRequest("POST", "/users/", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("Expected 201, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestUsersResilience_CreateRootAdminFailsIfExists(t *testing.T) {
	skipIfRealDB(t)
	r := setupTest()

	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &mockClient{
			collectionFunc: func(path string) CollectionRef {
				return &mockCollection{
					whereFunc: func(p, o string, v interface{}) Query {
						return &mockQuery{
							limitFunc: func(n int) Query {
								return &mockQuery{
									documentsFunc: func(ctx context.Context) DocumentIterator {
										return &mockIterator{
											nextFunc: func() (DocumentSnapshot, error) {
												// Root exists
												return &mockSnapshot{exists: true, id: "existing-root"}, nil
											},
										}
									},
								}
							},
						}
					},
				}
			},
		}, nil
	}

	payload := map[string]interface{}{"email": "root2@example.com", "user_type": "root_admin"}
	jsonBody, _ := json.Marshal(payload)
	token := signGoTestToken("u1", User, "u1@e.com")
	
	req, _ := http.NewRequest("POST", "/users/", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400, got %d", w.Code)
	}
}

func TestUsersResilience_GetMeSelfHealing(t *testing.T) {
	skipIfRealDB(t)
	r := setupTest()

	var setCalled bool
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &mockClient{
			collectionFunc: func(path string) CollectionRef {
				return &mockCollection{
					docFunc: func(path string) DocumentRef {
						return &mockDoc{
							getFunc: func(ctx context.Context) (DocumentSnapshot, error) {
								return nil, errors.New("code = NotFound")
							},
							setFunc: func(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
								setCalled = true
								return nil, nil
							},
						}
					},
				}
			},
		}, nil
	}

	token := signGoTestToken("u1", User, "new@example.com")
	req, _ := http.NewRequest("GET", "/users/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	if !setCalled {
		t.Errorf("Expected self-healing set operation to be called")
	}
}

func TestUsersResilience_CheckRootAdminExists(t *testing.T) {
	skipIfRealDB(t)
	r := setupTest()

	// 1. Exists
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &mockClient{
			collectionFunc: func(path string) CollectionRef {
				return &mockCollection{
					whereFunc: func(p, o string, v interface{}) Query {
						return &mockQuery{
							limitFunc: func(n int) Query {
								return &mockQuery{
									documentsFunc: func(ctx context.Context) DocumentIterator {
										return &mockIterator{
											nextFunc: func() (DocumentSnapshot, error) {
												return &mockSnapshot{exists: true}, nil
											},
										}
									},
								}
							},
						}
					},
				}
			},
		}, nil
	}

	req, _ := http.NewRequest("GET", "/users/root-admin-exists", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	
	var resp RootAdminExistsResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if !resp.Exists {
		t.Errorf("Expected True")
	}

	// 2. Not Exists
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &mockClient{
			collectionFunc: func(path string) CollectionRef {
				return &mockCollection{
					whereFunc: func(p, o string, v interface{}) Query {
						return &mockQuery{
							limitFunc: func(n int) Query {
								return &mockQuery{
									documentsFunc: func(ctx context.Context) DocumentIterator {
										return &mockIterator{
											nextFunc: func() (DocumentSnapshot, error) {
												return nil, iterator.Done
											},
										}
									},
								}
							},
						}
					},
				}
			},
		}, nil
	}

	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req)
	json.Unmarshal(w2.Body.Bytes(), &resp)
	if resp.Exists {
		t.Errorf("Expected False")
	}
}

func TestUsersResilience_ListUsersUnauthorized(t *testing.T) {
	skipIfRealDB(t)
	r := setupTest()
	token := signGoTestToken("u1", User, "u1@e.com")
	req, _ := http.NewRequest("GET", "/users/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("Expected 403, got %d", w.Code)
	}
}

func TestUsersResilience_SelfRegistrationAsAdminFails(t *testing.T) {
	skipIfRealDB(t)
	r := setupTest()

	payload := map[string]interface{}{"email": "hacker@example.com", "user_type": "admin"}
	jsonBody, _ := json.Marshal(payload)
	token := signGoTestToken("u1", User, "u1@e.com")

	req, _ := http.NewRequest("POST", "/users/", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("Expected 403, got %d", w.Code)
	}
}

func TestUsersResilience_AdminCreationSuccess(t *testing.T) {
	skipIfRealDB(t)
	r := setupTest()

	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &mockClient{
			collectionFunc: func(path string) CollectionRef {
				return &mockCollection{
					docFunc: func(p string) DocumentRef {
						return &mockDoc{
							getFunc: func(ctx context.Context) (DocumentSnapshot, error) {
								if p == "admin-uid" {
									return &mockSnapshot{exists: true, data: map[string]interface{}{"user_type": "admin"}}, nil
								}
								return &mockSnapshot{exists: false}, nil // Target doesn't exist
							},
							setFunc: func(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
								return nil, nil
							},
						}
					},
				}
			},
		}, nil
	}

	payload := map[string]interface{}{"email": "new@e.com", "user_type": "user", "uid": "target-uid"}
	jsonBody, _ := json.Marshal(payload)
	token := signGoTestToken("admin-uid", Admin, "admin@e.com")

	req, _ := http.NewRequest("POST", "/users/", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("Expected 201, got %d", w.Code)
	}
}

func TestUsersResilience_ListUsersAdmin(t *testing.T) {
	skipIfRealDB(t)
	r := setupTest()

	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &mockClient{
			collectionFunc: func(path string) CollectionRef {
				return &mockCollection{
					documentsFunc: func(ctx context.Context) DocumentIterator {
						count := 0
						return &mockIterator{
							nextFunc: func() (DocumentSnapshot, error) {
								if count > 0 {
									return nil, iterator.Done
								}
								count++
								return &mockSnapshot{id: "u1", data: map[string]interface{}{"email": "u1@e.com", "user_type": "user"}}, nil
							},
						}
					},
				}
			},
		}, nil
	}

	token := signGoTestToken("admin-uid", Admin, "admin@e.com")
	req, _ := http.NewRequest("GET", "/users/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func TestUsersResilience_PurgeAllUsersNonRootFails(t *testing.T) {
	skipIfRealDB(t)
	r := setupTest()
	token := signGoTestToken("admin-uid", Admin, "admin@e.com")
	req, _ := http.NewRequest("DELETE", "/users/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("Expected 403, got %d", w.Code)
	}
}

func TestEmptyArrayConsistency(t *testing.T) {
	skipIfRealDB(t)
	r := setupTest()

	t.Run("ListUsers_EmptyArray", func(t *testing.T) {
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return &mockClient{
				collectionFunc: func(path string) CollectionRef {
					return &mockCollection{
						documentsFunc: func(ctx context.Context) DocumentIterator {
							return &mockIterator{
								nextFunc: func() (DocumentSnapshot, error) {
									return nil, iterator.Done // No users
								},
							}
						},
					}
				},
			}, nil
		}

		token := signGoTestToken("admin-uid", Admin, "admin@e.com")
		req, _ := http.NewRequest("GET", "/users/", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200, got %d: %s", w.Code, w.Body.String())
		}

		if w.Body.String() != "[]" {
			t.Errorf("Expected empty array '[]', got '%s'", w.Body.String())
		}
	})
}
