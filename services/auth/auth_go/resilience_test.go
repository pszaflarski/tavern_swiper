package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"firebase.google.com/go/v4/auth"
)

// Replicating logic from services/auth/tests/test_main.py

func TestAuthResilience_VerifyTokenSuccess(t *testing.T) {
	r := setupTest()

	getAuthFunc = func(ctx context.Context) (AuthClient, error) {
		return &mockAuthClient{
			verifyIDTokenFunc: func(ctx context.Context, idToken string) (*auth.Token, error) {
				return &auth.Token{
					UID: "test-uid-123",
					Claims: map[string]interface{}{
						"email":          "test@example.com",
						"email_verified": true,
					},
				}, nil
			},
		}, nil
	}

	body := map[string]string{"id_token": "valid-token"}
	jsonBody, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", "/auth/verify", bytes.NewBuffer(jsonBody))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp TokenResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.UID != "test-uid-123" {
		t.Errorf("Expected UID test-uid-123, got %s", resp.UID)
	}
}

func TestAuthResilience_VerifyTokenInvalid(t *testing.T) {
	r := setupTest()

	getAuthFunc = func(ctx context.Context) (AuthClient, error) {
		return &mockAuthClient{
			verifyIDTokenFunc: func(ctx context.Context, idToken string) (*auth.Token, error) {
				return nil, errors.New("invalid signature")
			},
		}, nil
	}

	body := map[string]string{"id_token": "invalid-token"}
	jsonBody, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", "/auth/verify", bytes.NewBuffer(jsonBody))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected 401, got %d", w.Code)
	}
}

func TestAuthResilience_RegisterEmailExists(t *testing.T) {
	r := setupTest()

	// Mocking Firebase Auth REST response
	mockSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": map[string]string{"message": "EMAIL_EXISTS"},
		})
	}))
	defer mockSrv.Close()

	// Direct patch of httpClient for this test
	oldClient := httpClient
	httpClient = mockSrv.Client()
	defer func() { httpClient = oldClient }()

	// Overwrite global FIREBASE_AUTH_URL if necessary, but here we can just set the env
	setEnv(t, "FIREBASE_AUTH_URL", mockSrv.URL+"/")
	setEnv(t, "FIREBASE_WEB_API_KEY", "test-key")

	body := map[string]string{"email": "exists@example.com", "password": "password123"}
	jsonBody, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", "/auth/register", bytes.NewBuffer(jsonBody))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["detail"] != "An account with this email address already exists." {
		t.Errorf("Expected email exists error detail, got %v", resp["detail"])
	}
}

func TestAuthResilience_LoginInvalidPassword(t *testing.T) {
	r := setupTest()

	mockSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": map[string]string{"message": "INVALID_PASSWORD"},
		})
	}))
	defer mockSrv.Close()

	oldClient := httpClient
	httpClient = mockSrv.Client()
	defer func() { httpClient = oldClient }()

	setEnv(t, "FIREBASE_AUTH_URL", mockSrv.URL+"/")
	setEnv(t, "FIREBASE_WEB_API_KEY", "test-key")

	body := map[string]string{"email": "user@example.com", "password": "wrong-password"}
	jsonBody, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", "/auth/login", bytes.NewBuffer(jsonBody))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// Auth service maps INVALID_PASSWORD to 401 in sign-in action
	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected 401, got %d", w.Code)
	}
}

func TestAuthResilience_DeleteUserSuccess(t *testing.T) {
	r := setupTestWithRole("admin")

	deletedUID := ""
	getAuthFunc = func(ctx context.Context) (AuthClient, error) {
		return &mockAuthClient{
			deleteUserFunc: func(ctx context.Context, uid string) error {
				deletedUID = uid
				return nil
			},
		}, nil
	}

	req, _ := http.NewRequest("DELETE", "/auth/users/test-uid", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("Expected 204, got %d", w.Code)
	}
	if deletedUID != "test-uid" {
		t.Errorf("Expected UID test-uid to be deleted, got %s", deletedUID)
	}
}

func TestAuthResilience_DeleteAllUserSuccess(t *testing.T) {
	r := setupTestWithRole("root_admin")

	listed := false
	getAuthFunc = func(ctx context.Context) (AuthClient, error) {
		return &mockAuthClient{
			listUsersFunc: func(ctx context.Context) ([]string, error) {
				listed = true
				return []string{"u1", "u2"}, nil
			},
			deleteUsersFunc: func(ctx context.Context, uids []string) (*auth.DeleteUsersResult, error) {
				return &auth.DeleteUsersResult{}, nil
			},
		}, nil
	}

	req, _ := http.NewRequest("DELETE", "/auth/all", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("Expected 204, got %d", w.Code)
	}
	if !listed {
		t.Errorf("Expected users to be listed for deletion")
	}
}

func TestAuthResilience_MintToken(t *testing.T) {
	token, err := mintTavernJWT("u1", "e1", "admin")
	if err != nil {
		t.Fatalf("Failed to mint token: %v", err)
	}
	if token == "" {
		t.Errorf("Token should not be empty")
	}
}
