//go:build snapshot
// +build snapshot

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"firebase.google.com/go/v4/auth"
	"github.com/google/go-cmp/cmp"
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
	skipIfRealDB(t)
	r := setupTest()
	snaps := loadSnapshots(t)

	t.Run("Health", func(t *testing.T) {
		req, _ := http.NewRequest("GET", "/auth/health", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		var resp interface{}
		json.Unmarshal(w.Body.Bytes(), &resp)
		if diff := cmp.Diff(snaps["test_health"], resp); diff != "" {
			t.Errorf("Health snapshot mismatch (-want +got):\n%s", diff)
		}
	})

	t.Run("VerifyTokenSuccess", func(t *testing.T) {
		getAuthFunc = func(ctx context.Context) (AuthClient, error) {
			return &mockAuthClient{
				verifyIDTokenFunc: func(ctx context.Context, idToken string) (*auth.Token, error) {
					return &auth.Token{UID: "test-uid-123", Claims: map[string]interface{}{"email": "test@example.com"}}, nil
				},
			}, nil
		}
		getUsersDBFunc = func(ctx context.Context) (FirestoreClient, error) {
			return nil, errors.New("no db") // Force fallback to 'user' role
		}

		body, _ := json.Marshal(TokenRequest{IDToken: "valid-token"})
		req, _ := http.NewRequest("POST", "/auth/verify", bytes.NewBuffer(body))
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		var resp map[string]interface{}
		json.Unmarshal(w.Body.Bytes(), &resp)
		
		// Exclusion logic: we check keys present in snapshot
		expected := snaps["test_verify_token_success"].(map[string]interface{})
		for k, v := range expected {
			if resp[k] != v {
				t.Errorf("VerifyToken key %s mismatch: want %v, got %v", k, v, resp[k])
			}
		}
	})

	t.Run("DuplicateEmailError", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error": map[string]string{"message": "EMAIL_EXISTS"},
			})
		}))
		defer srv.Close()
		setEnv(t, "FIREBASE_WEB_API_KEY", "test-key")
		setEnv(t, "FIREBASE_AUTH_URL", srv.URL+"/")

		body, _ := json.Marshal(LoginRequest{Email: "exists@example.com", Password: "password123"})
		req, _ := http.NewRequest("POST", "/auth/register", bytes.NewBuffer(body))
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		var resp interface{}
		json.Unmarshal(w.Body.Bytes(), &resp)
		if diff := cmp.Diff(snaps["test_register_user_email_exists_mapping"], resp); diff != "" {
			t.Errorf("Duplicate Email snapshot mismatch (-want +got):\n%s", diff)
		}
	})
}
