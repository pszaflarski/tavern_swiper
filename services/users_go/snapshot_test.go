//go:build snapshot
// +build snapshot

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/google/go-cmp/cmp"
	"google.golang.org/api/iterator"
)

type Snapshots map[string]interface{}

func loadSnapshots(t *testing.T) Snapshots {
	data, err := os.ReadFile("snapshots.json")
	if err != nil {
		t.Fatalf("Failed to read snapshots.json: %v", err)
	}
	var s Snapshots
	if err := json.Unmarshal(data, &s); err != nil {
		t.Fatalf("Failed to unmarshal snapshots.json: %v", err)
	}
	return s
}

func TestSnapshotsParity(t *testing.T) {
	r := setupTest()
	snaps := loadSnapshots(t)
	var body []byte
	var req *http.Request
	var w *httptest.ResponseRecorder

	// Mock _now to match snapshots
	fixedNow := time.Date(2026, 4, 17, 10, 0, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	t.Run("Health", func(t *testing.T) {
		req, _ = http.NewRequest("GET", "/users/health", nil)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)

		var resp interface{}
		json.Unmarshal(w.Body.Bytes(), &resp)
		if diff := cmp.Diff(snaps["test_health"], resp); diff != "" {
			t.Errorf("Health snapshot mismatch (-want +got):\n%s", diff)
		}
	})

	t.Run("RootAdminExists", func(t *testing.T) {
		// 1. Exists
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return &mockClient{
				collectionFunc: func(p string) CollectionRef {
					return &mockCollection{
						whereFunc: func(path, op string, val interface{}) Query {
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
		req, _ = http.NewRequest("GET", "/users/root-admin-exists", nil)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assertParity(t, "test_check_root_admin_exists", w.Body.Bytes(), snaps)

		// 2. Not Exists (matches test_check_root_admin_exists.1)
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return &mockClient{
				collectionFunc: func(p string) CollectionRef {
					return &mockCollection{
						whereFunc: func(path, op string, val interface{}) Query {
							return &mockQuery{
								limitFunc: func(n int) Query {
									return &mockQuery{
										documentsFunc: func(ctx context.Context) DocumentIterator {
											return &mockIterator{
												nextFunc: func() (DocumentSnapshot, error) {
													return nil, fmt.Errorf("done") // matches iterator.Done behavior
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
		req, _ = http.NewRequest("GET", "/users/root-admin-exists", nil)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assertParity(t, "test_check_root_admin_exists.1", w.Body.Bytes(), snaps)
	})

	t.Run("GetMe", func(t *testing.T) {
		token := signGoTestToken("test-user-123", User, "test@example.com")
		
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return &mockClient{
				collectionFunc: func(path string) CollectionRef {
					return &mockCollection{
						docFunc: func(p string) DocumentRef {
							return &mockDoc{
								getFunc: func(ctx context.Context) (DocumentSnapshot, error) {
									return &mockSnapshot{
										exists: true,
										id:     "test-user-123",
										data: map[string]interface{}{
											"email":      "test@example.com",
											"is_premium": true,
											"user_type":  "user",
											"is_deleted": false,
											"created_at": time.Date(2026, 3, 26, 12, 0, 0, 0, time.UTC),
										},
									}, nil
								},
							}
						},
					}
				},
			}, nil
		}

		req, _ := http.NewRequest("GET", "/users/me", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assertParity(t, "test_get_me", w.Body.Bytes(), snaps)
	})

	t.Run("GetMeSelfHealing", func(t *testing.T) {
		token := signGoTestToken("test-user-123", User, "new@e.com")
		
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return &mockClient{
				collectionFunc: func(path string) CollectionRef {
					return &mockCollection{
						docFunc: func(p string) DocumentRef {
							return &mockDoc{
								getFunc: func(ctx context.Context) (DocumentSnapshot, error) {
									return nil, fmt.Errorf("code = NotFound")
								},
								setFunc: func(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
									return nil, nil // Success
								},
							}
						},
					}
				},
			}, nil
		}

		req, _ := http.NewRequest("GET", "/users/me", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assertParity(t, "test_get_me_self_healing", w.Body.Bytes(), snaps)
	})

	t.Run("ListUsers", func(t *testing.T) {
		token := signGoTestToken("admin-uid", Admin, "admin@test.com")
		var docs []DocumentSnapshot
		var idx int

		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return &mockClient{
				collectionFunc: func(path string) CollectionRef {
					return &mockCollection{
						documentsFunc: func(ctx context.Context) DocumentIterator {
							return &mockIterator{
								nextFunc: func() (DocumentSnapshot, error) {
									if idx >= len(docs) {
										return nil, iterator.Done
									}
									d := docs[idx]
									idx++
									return d, nil
								},
							}
						},
					}
				},
			}, nil
		}

		// 1. Admin List (test_list_users_admin)
		docs = []DocumentSnapshot{
			&mockSnapshot{id: "user1", data: map[string]interface{}{"email": "u1@e.com", "is_premium": false, "user_type": "user", "is_deleted": false, "created_at": time.Date(2026, 3, 26, 12, 0, 0, 0, time.UTC)}},
		}
		idx = 0
		req, _ := http.NewRequest("GET", "/users/", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assertParity(t, "test_list_users_admin", w.Body.Bytes(), snaps)

		// 2. Include Deleted (test_list_users_include_deleted)
		docs = []DocumentSnapshot{
			&mockSnapshot{id: "u1", data: map[string]interface{}{"email": "u1@e.com", "is_premium": false, "user_type": "user", "is_deleted": false, "created_at": time.Date(2026, 3, 26, 12, 0, 0, 0, time.UTC)}},
			&mockSnapshot{id: "u2", data: map[string]interface{}{"email": "u2@e.com", "is_premium": false, "user_type": "user", "is_deleted": true, "created_at": time.Date(2026, 3, 26, 12, 0, 0, 0, time.UTC)}},
		}
		idx = 0
		req, _ = http.NewRequest("GET", "/users/?include_deleted=true", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assertParity(t, "test_list_users_include_deleted", w.Body.Bytes(), snaps)
	})

	t.Run("CreateUser", func(t *testing.T) {
		token := signGoTestToken("test-user-123", RootAdmin, "root@e.com")
		var rootExists bool
		var docExists bool
		
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			idx := 0
			return &mockClient{
				collectionFunc: func(p string) CollectionRef {
					return &mockCollection{
						whereFunc: func(path, op string, val interface{}) Query {
							return &mockQuery{
								limitFunc: func(n int) Query {
									return &mockQuery{
										documentsFunc: func(ctx context.Context) DocumentIterator {
											return &mockIterator{
												nextFunc: func() (DocumentSnapshot, error) {
													if idx > 0 || !rootExists { return nil, iterator.Done }
													idx++
													return &mockSnapshot{exists: true, id: "test-user-123"}, nil
												},
											}
										},
									}
								},
							}
						},
						docFunc: func(p string) DocumentRef {
							return &mockDoc{
								getFunc: func(ctx context.Context) (DocumentSnapshot, error) {
									return &mockSnapshot{exists: docExists}, nil
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

		// 1. Root Admin Success
		rootExists = false
		docExists = false
		body, _ := json.Marshal(map[string]interface{}{
			"email": "root@e.com", "user_type": "root_admin", "is_premium": false, "is_deleted": false,
		})
		req, _ := http.NewRequest("POST", "/users/", bytes.NewBuffer(body))
		req.Header.Set("Authorization", "Bearer "+token)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assertParity(t, "test_consolidated_create_root_admin", w.Body.Bytes(), snaps)

		// 2. Root Admin Fails if exists
		rootExists = true
		tokenOther := signGoTestToken("other-uid", RootAdmin, "other@e.com")
		req, _ = http.NewRequest("POST", "/users/", bytes.NewBuffer(body))
		req.Header.Set("Authorization", "Bearer "+tokenOther)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assertParity(t, "test_consolidated_create_root_admin_fails_if_exists", w.Body.Bytes(), snaps)

		// 3. Self Registration
		tokenUser := signGoTestToken("test-user-123", User, "user@e.com")
		rootExists = false
		body, _ = json.Marshal(map[string]interface{}{
			"email": "user@e.com", "user_type": "user", "is_premium": false, "is_deleted": false,
		})
		req, _ = http.NewRequest("POST", "/users/", bytes.NewBuffer(body))
		req.Header.Set("Authorization", "Bearer "+tokenUser)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assertParity(t, "test_consolidated_self_registration", w.Body.Bytes(), snaps)
	})

	t.Run("UpdateMe", func(t *testing.T) {
		token := signGoTestToken("test-user-123", User, "test@e.com")
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return &mockClient{
				collectionFunc: func(p string) CollectionRef {
					return &mockCollection{
						docFunc: func(p string) DocumentRef {
							return &mockDoc{
								getFunc: func(ctx context.Context) (DocumentSnapshot, error) {
									return &mockSnapshot{
										id: "test-user-123", exists: true,
										data: map[string]interface{}{
											"email": "test@e.com", "is_premium": true, "user_type": "user", "is_deleted": false, 
											"created_at": time.Date(2026, 4, 17, 10, 0, 0, 0, time.UTC),
										},
									}, nil
								},
								updateFunc: func(ctx context.Context, updates []firestore.Update, opts ...firestore.Precondition) (*firestore.WriteResult, error) {
									return nil, nil
								},
							}
						},
					}
				},
			}, nil
		}
		body, _ := json.Marshal(map[string]interface{}{"is_premium": true})
		req, _ := http.NewRequest("PUT", "/users/me", bytes.NewBuffer(body))
		req.Header.Set("Authorization", "Bearer "+token)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assertParity(t, "test_update_me_success", w.Body.Bytes(), snaps)
	})

	t.Run("DeleteRestore", func(t *testing.T) {
		tokenAdmin := signGoTestToken("admin-uid", Admin, "admin@test.com")
		tokenRoot := signGoTestToken("root-uid", RootAdmin, "root@e.com")
		
		// 1. Delete user not found
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return &mockClient{
				collectionFunc: func(p string) CollectionRef {
					return &mockCollection{
						docFunc: func(p string) DocumentRef {
							return &mockDoc{
								getFunc: func(ctx context.Context) (DocumentSnapshot, error) {
									return &mockSnapshot{exists: false}, nil
								},
							}
						},
					}
				},
			}, nil
		}
		req, _ := http.NewRequest("DELETE", "/users/non-existent", nil)
		req.Header.Set("Authorization", "Bearer "+tokenAdmin)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assertParity(t, "test_delete_user_not_found", w.Body.Bytes(), snaps)

		// 2. Delete root admin unauthorized
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return &mockClient{
				collectionFunc: func(p string) CollectionRef {
					return &mockCollection{
						docFunc: func(p string) DocumentRef {
							return &mockDoc{
								getFunc: func(ctx context.Context) (DocumentSnapshot, error) {
									return &mockSnapshot{
										id: "root-uid", exists: true,
										data: map[string]interface{}{"user_type": "root_admin"},
									}, nil
								},
							}
						},
					}
				},
			}, nil
		}
		req, _ = http.NewRequest("DELETE", "/users/root-uid", nil)
		req.Header.Set("Authorization", "Bearer "+tokenAdmin)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assertParity(t, "test_delete_root_admin_unauthorized", w.Body.Bytes(), snaps)

		// 3. Delete last root admin fails
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return &mockClient{
				collectionFunc: func(p string) CollectionRef {
					return &mockCollection{
						docFunc: func(p string) DocumentRef {
							return &mockDoc{
								getFunc: func(ctx context.Context) (DocumentSnapshot, error) {
									return &mockSnapshot{
										id: "root-uid", exists: true,
										data: map[string]interface{}{"user_type": "root_admin"},
									}, nil
								},
							}
						},
						whereFunc: func(path, op string, val interface{}) Query {
							idx := 0
							docs := []DocumentSnapshot{&mockSnapshot{id: "root-uid", data: map[string]interface{}{"is_deleted": false}}}
							return &mockQuery{
								documentsFunc: func(ctx context.Context) DocumentIterator {
									return &mockIterator{
										nextFunc: func() (DocumentSnapshot, error) {
											if idx >= len(docs) { return nil, iterator.Done }
											d := docs[idx]
											idx++
											return d, nil
										},
									}
								},
							}
						},
					}
				},
			}, nil
		}
		req, _ = http.NewRequest("DELETE", "/users/root-uid", nil)
		req.Header.Set("Authorization", "Bearer "+tokenRoot)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assertParity(t, "test_delete_last_root_admin_fails", w.Body.Bytes(), snaps)

		// 4. Restore success
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return &mockClient{
				collectionFunc: func(p string) CollectionRef {
					return &mockCollection{
						docFunc: func(p string) DocumentRef {
							return &mockDoc{
								getFunc: func(ctx context.Context) (DocumentSnapshot, error) {
									return &mockSnapshot{
										id: "user1", exists: true,
										data: map[string]interface{}{
											"is_deleted": false, "email": "u1@e.com", 
											"user_type": "user", "is_premium": false,
											"created_at": time.Date(2026, 4, 17, 10, 0, 0, 0, time.UTC),
										},
									}, nil
								},
								updateFunc: func(ctx context.Context, updates []firestore.Update, opts ...firestore.Precondition) (*firestore.WriteResult, error) {
									return nil, nil
								},
							}
						},
					}
				},
			}, nil
		}
		req, _ = http.NewRequest("PATCH", "/users/user1/restore", nil)
		req.Header.Set("Authorization", "Bearer "+tokenAdmin)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assertParity(t, "test_restore_user_success", w.Body.Bytes(), snaps)

		// 5. Restore user not found
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return &mockClient{
				collectionFunc: func(p string) CollectionRef {
					return &mockCollection{
						docFunc: func(p string) DocumentRef {
							return &mockDoc{
								getFunc: func(ctx context.Context) (DocumentSnapshot, error) {
									return &mockSnapshot{exists: false}, nil
								},
							}
						},
					}
				},
			}, nil
		}
		req, _ = http.NewRequest("PATCH", "/users/non-existent/restore", nil)
		req.Header.Set("Authorization", "Bearer "+tokenAdmin)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assertParity(t, "test_restore_user_not_found", w.Body.Bytes(), snaps)
	})

	t.Run("Unauthorized", func(t *testing.T) {
		tokenUser := signGoTestToken("user-uid", User, "user@e.com")
		
		// 1. List Users Unauthorized
		req, _ := http.NewRequest("GET", "/users/", nil)
		req.Header.Set("Authorization", "Bearer "+tokenUser)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assertParity(t, "test_list_users_unauthorized", w.Body.Bytes(), snaps)
	})

	t.Run("MoreCreateUser", func(t *testing.T) {
		tokenRoot := signGoTestToken("root-uid", RootAdmin, "root@e.com")
		tokenUser := signGoTestToken("user-uid", User, "user@e.com")
		
		// 1. Consolidated Admin Creation (by Root)
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return &mockClient{
				collectionFunc: func(p string) CollectionRef {
					return &mockCollection{
						docFunc: func(p string) DocumentRef {
							return &mockDoc{
								getFunc: func(ctx context.Context) (DocumentSnapshot, error) {
									return &mockSnapshot{exists: false}, nil
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
		body, _ = json.Marshal(map[string]interface{}{
			"email": "newbie@e.com", "user_type": "user", "uid": "target-uid",
		})
		req, _ = http.NewRequest("POST", "/users/", bytes.NewBuffer(body))
		req.Header.Set("Authorization", "Bearer "+tokenRoot)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assertParity(t, "test_consolidated_admin_creation", w.Body.Bytes(), snaps)

		// 2. Idempotency Self
		tokenUser = signGoTestToken("test-user-123", User, "existing@e.com")
		getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return &mockClient{
				collectionFunc: func(p string) CollectionRef {
					return &mockCollection{
						docFunc: func(p string) DocumentRef {
							return &mockDoc{
								getFunc: func(ctx context.Context) (DocumentSnapshot, error) {
									return &mockSnapshot{
										id: "test-user-123", exists: true,
										data: map[string]interface{}{
											"email": "existing@e.com", "user_type": "user",
											"created_at": time.Date(2026, 3, 26, 12, 0, 0, 0, time.UTC),
										},
									}, nil
								},
							}
						},
					}
				},
			}, nil
		}
		body, _ = json.Marshal(map[string]interface{}{
			"email": "existing@e.com", "user_type": "user",
		})
		req, _ = http.NewRequest("POST", "/users/", bytes.NewBuffer(body))
		req.Header.Set("Authorization", "Bearer "+tokenUser)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assertParity(t, "test_create_user_idempotency_self", w.Body.Bytes(), snaps)
	})

	t.Run("FinalUpdates", func(t *testing.T) {
		token := signGoTestToken("test-user-123", User, "test@e.com")
		
		// 1. Update Me Validation Error (Type Mismatch)
		// Go's ShouldBindJSON returns errors for type mismatches.
		// We'll see if the structure matches Pydantic's 422.
		body, _ = json.Marshal(map[string]interface{}{"is_premium": "not-a-bool"})
		req, _ = http.NewRequest("PUT", "/users/me", bytes.NewBuffer(body))
		req.Header.Set("Authorization", "Bearer "+token)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assertParity(t, "test_update_me_validation_error", w.Body.Bytes(), snaps)
	})
}

// Utility to compare JSON with snapshot
func assertParity(t *testing.T, snapName string, body []byte, snaps Snapshots) {
	var resp interface{}
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("Failed to unmarshal response: %v", err)
	}
	expected := snaps[snapName]
	if diff := cmp.Diff(expected, resp); diff != "" {
		t.Errorf("Snapshot %s mismatch (-want +got):\n%s", snapName, diff)
	}
}
