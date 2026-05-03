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
	"github.com/gin-gonic/gin"
	"tavern-swiper.app/firestoreutil"
)

// --- Mocks ---

type mockAuthClient struct {
	verifyIDTokenFunc func(ctx context.Context, idToken string) (*auth.Token, error)
	deleteUserFunc    func(ctx context.Context, uid string) error
	deleteUsersFunc   func(ctx context.Context, uids []string) (*auth.DeleteUsersResult, error)
	listUsersFunc     func(ctx context.Context) ([]string, error)
}

func (m *mockAuthClient) VerifyIDToken(ctx context.Context, idToken string) (*auth.Token, error) {
	return m.verifyIDTokenFunc(ctx, idToken)
}
func (m *mockAuthClient) DeleteUser(ctx context.Context, uid string) error {
	return m.deleteUserFunc(ctx, uid)
}
func (m *mockAuthClient) DeleteUsers(ctx context.Context, uids []string) (*auth.DeleteUsersResult, error) {
	return m.deleteUsersFunc(ctx, uids)
}
func (m *mockAuthClient) ListUsers(ctx context.Context) ([]string, error) {
	if m.listUsersFunc == nil {
		return nil, nil
	}
	return m.listUsersFunc(ctx)
}

// --- Setup ---

func setupTest() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.Default()
	authGrp := r.Group("/auth")
	{
		authGrp.GET("/health", healthHandler)
		authGrp.POST("/verify", verifyTokenHandler)
		authGrp.POST("/register", registerHandler)
		authGrp.POST("/login", loginHandler)
		authGrp.POST("/dev-mint", devMintHandler)
		authGrp.DELETE("/users/:uid", deleteUserHandler)
		authGrp.DELETE("/users/", deleteUsersBulkHandler)
		authGrp.DELETE("/all", deleteAllHandler)
	}
	return r
}

// --- 26. Dev Minting ---

func TestDevMint(t *testing.T) {
	skipIfRealDB(t)
	r := setupTest()

	tests := []struct {
		name           string
		body           DevMintRequest
		allowLong      string
		project        string
		emulator       string
		expectedStatus int
	}{
		{
			name:           "Forbidden in Prod",
			body:           DevMintRequest{UID: "u1", Email: "e1@t.com"},
			allowLong:      "false",
			project:        "prod",
			expectedStatus: http.StatusForbidden,
		},
		{
			name:           "Allowed in Dev even if Flag Off",
			body:           DevMintRequest{UID: "u1", Email: "e1@t.com"},
			allowLong:      "false",
			project:        "dev-dev",
			expectedStatus: http.StatusOK,
		},
		{
			name:           "Success in Dev Project",
			body:           DevMintRequest{UID: "u1", Email: "e1@t.com"},
			allowLong:      "true",
			project:        "tavern-swiper-dev",
			expectedStatus: http.StatusOK,
		},
		{
			name:           "Success with Emulator",
			body:           DevMintRequest{UID: "u1", Email: "e1@t.com"},
			allowLong:      "true",
			project:        "prod",
			emulator:       "localhost:9099",
			expectedStatus: http.StatusOK,
		},
		{
			name:           "Validation Error",
			body:           DevMintRequest{UID: "", Email: "invalid"},
			allowLong:      "true",
			project:        "tavern-swiper-dev",
			expectedStatus: http.StatusUnprocessableEntity,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setEnv(t, "ALLOW_LONG_LIVED_TOKENS", tt.allowLong)
			setEnv(t, "GOOGLE_CLOUD_PROJECT", tt.project)
			setEnv(t, "FIREBASE_AUTH_EMULATOR_HOST", tt.emulator)

			jsonBody, _ := json.Marshal(tt.body)
			req, _ := http.NewRequest("POST", "/auth/dev-mint", bytes.NewBuffer(jsonBody))
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("%s: Expected %d, got %d", tt.name, tt.expectedStatus, w.Code)
			}
		})
	}
}

// --- 1. Health ---

func TestHealth(t *testing.T) {
	skipIfRealDB(t)
	r := setupTest()
	req, _ := http.NewRequest("GET", "/auth/health", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp HealthResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Service != "auth" || resp.Status != "ok" {
		t.Errorf("Unexpected response: %+v", resp)
	}
}

// --- 2-7. Verify ---

func TestVerifyToken(t *testing.T) {
	skipIfRealDB(t)
	r := setupTest()

	tests := []struct {
		name           string
		body           interface{}
		mockVerify     func(ctx context.Context, idToken string) (*auth.Token, error)
		expectedStatus int
		expectedDetail string
	}{
		{
			name: "Success",
			body: TokenRequest{IDToken: "valid-token"},
			mockVerify: func(ctx context.Context, idToken string) (*auth.Token, error) {
				return &auth.Token{UID: "user123", Claims: map[string]interface{}{"email": "test@test.com"}}, nil
			},
			expectedStatus: http.StatusOK,
		},
		{
			name: "Invalid Token",
			body: TokenRequest{IDToken: "invalid-token"},
			mockVerify: func(ctx context.Context, idToken string) (*auth.Token, error) {
				return nil, errors.New("invalid signature")
			},
			expectedStatus: http.StatusUnauthorized,
			expectedDetail: "Invalid authentication token",
		},
		{
			name: "Expired Token",
			body: TokenRequest{IDToken: "expired-token"},
			mockVerify: func(ctx context.Context, idToken string) (*auth.Token, error) {
				return nil, errors.New("ID token has expired")
			},
			expectedStatus: http.StatusUnauthorized,
			expectedDetail: "Token has expired",
		},
		{
			name: "Service Unavailable",
			body: TokenRequest{IDToken: "valid-token"},
			mockVerify: func(ctx context.Context, idToken string) (*auth.Token, error) {
				return nil, errors.New("external failure")
			},
			expectedStatus: http.StatusUnauthorized,
			expectedDetail: "Invalid authentication token",
		},
		{
			name: "Role Fallback (DB Down)",
			body: TokenRequest{IDToken: "valid-token"},
			mockVerify: func(ctx context.Context, idToken string) (*auth.Token, error) {
				return &auth.Token{UID: "user123", Claims: map[string]interface{}{"email": "test@test.com"}}, nil
			},
			expectedStatus: http.StatusOK,
		},
		{
			name:           "Validation Error (Missing Body)",
			body:           nil,
			expectedStatus: http.StatusUnprocessableEntity,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			getAuthFunc = func(ctx context.Context) (AuthClient, error) {
				if tt.mockVerify == nil {
					return nil, errors.New("fail")
				}
				return &mockAuthClient{verifyIDTokenFunc: tt.mockVerify}, nil
			}
			getUsersDBFunc = func(ctx context.Context) (firestoreutil.FirestoreClient, error) {
				return nil, errors.New("no db")
			}

			jsonBody, _ := json.Marshal(tt.body)
			req, _ := http.NewRequest("POST", "/auth/verify", bytes.NewBuffer(jsonBody))
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("%s: Expected %d, got %d", tt.name, tt.expectedStatus, w.Code)
			}
		})
	}
}

// envVars used to track environment state for tests
func setEnv(t *testing.T, k, v string) {
	oldValue := os.Getenv(k)
	os.Setenv(k, v)
	t.Cleanup(func() {
		if oldValue == "" {
			os.Unsetenv(k)
		} else {
			os.Setenv(k, oldValue)
		}
	})
}

// --- 8-18. Register & Login ---

func TestAuthREST(t *testing.T) {
	skipIfRealDB(t)
	r := setupTest()
	os.Setenv("FIREBASE_WEB_API_KEY", "test-key")

	tests := []struct {
		name           string
		endpoint       string
		body           interface{}
		mockStatus     int
		mockResp       interface{}
		expectedStatus int
		expectedDetail string
	}{
		{
			name:           "Register Success",
			endpoint:       "/auth/register",
			body:           LoginRequest{Email: "new@test.com", Password: "pwd"},
			mockStatus:     http.StatusOK,
			mockResp:       map[string]string{"idToken": "t", "localId": "u"},
			expectedStatus: http.StatusOK,
		},
		{
			name:           "Register Email Exists",
			endpoint:       "/auth/register",
			body:           LoginRequest{Email: "ex@test.com", Password: "pwd"},
			mockStatus:     http.StatusBadRequest,
			mockResp:       map[string]interface{}{"error": map[string]string{"message": "EMAIL_EXISTS"}},
			expectedStatus: http.StatusBadRequest,
			expectedDetail: "An account with this email address already exists.",
		},
		{
			name:           "Register Generic Error",
			endpoint:       "/auth/register",
			body:           LoginRequest{Email: "err@test.com", Password: "pwd"},
			mockStatus:     http.StatusBadRequest,
			mockResp:       map[string]interface{}{"error": map[string]string{"message": "UNKNOWN"}},
			expectedStatus: http.StatusBadRequest,
			expectedDetail: "An unexpected authentication error occurred. Please try again.",
		},
		{
			name:           "Register Missing Config",
			endpoint:       "/auth/register",
			body:           LoginRequest{Email: "c@test.com", Password: "p"},
			mockStatus:     http.StatusServiceUnavailable,
			expectedStatus: http.StatusServiceUnavailable,
		},
		{
			name:           "Register Network Down",
			endpoint:       "/auth/register",
			body:           LoginRequest{Email: "n@test.com", Password: "p"},
			mockStatus:     http.StatusServiceUnavailable,
			expectedStatus: http.StatusServiceUnavailable,
		},
		{
			name:           "Register 422 Validation",
			endpoint:       "/auth/register",
			body:           map[string]string{"foo": "bar"},
			expectedStatus: http.StatusUnprocessableEntity,
		},
		{
			name:           "Login Success",
			endpoint:       "/auth/login",
			body:           LoginRequest{Email: "l@test.com", Password: "p"},
			mockStatus:     http.StatusOK,
			mockResp:       map[string]string{"idToken": "t", "localId": "u"},
			expectedStatus: http.StatusOK,
		},
		{
			name:           "Login Invalid Pwd",
			endpoint:       "/auth/login",
			body:           LoginRequest{Email: "l@test.com", Password: "p"},
			mockStatus:     http.StatusBadRequest,
			mockResp:       map[string]interface{}{"error": map[string]string{"message": "INVALID_PASSWORD"}},
			expectedStatus: http.StatusUnauthorized,
			expectedDetail: "Incorrect password. Please try again.",
		},
		{
			name:           "Login 422 Validation",
			endpoint:       "/auth/login",
			body:           nil,
			expectedStatus: http.StatusUnprocessableEntity,
		},
		{
			name:           "Login Missing Config",
			endpoint:       "/auth/login",
			body:           LoginRequest{Email: "c@test.com", Password: "p"},
			mockStatus:     http.StatusServiceUnavailable,
			expectedStatus: http.StatusServiceUnavailable,
		},
		{
			name:           "Login Network Down",
			endpoint:       "/auth/login",
			body:           LoginRequest{Email: "n@test.com", Password: "p"},
			mockStatus:     http.StatusServiceUnavailable,
			expectedStatus: http.StatusServiceUnavailable,
		},
	}

	for _, tt := range tests {
		tt := tt 
		t.Run(tt.name, func(t *testing.T) {
			setEnv(t, "FIREBASE_WEB_API_KEY", "test-key")
			if tt.name == "Register Missing Config" || tt.name == "Login Missing Config" {
				setEnv(t, "FIREBASE_WEB_API_KEY", "")
			}

			if tt.mockStatus != 0 {
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if tt.name == "Register Network Down" || tt.name == "Login Network Down" {
						w.WriteHeader(http.StatusServiceUnavailable)
						return
					}
					w.WriteHeader(tt.mockStatus)
					json.NewEncoder(w).Encode(tt.mockResp)
				}))
				defer srv.Close()
				setEnv(t, "FIREBASE_AUTH_URL", srv.URL+"/")
			}

			jsonBody, _ := json.Marshal(tt.body)
			req, _ := http.NewRequest("POST", tt.endpoint, bytes.NewBuffer(jsonBody))
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("%s: Expected %d, got %d", tt.name, tt.expectedStatus, w.Code)
			}
		})
	}
}

// --- 19-21. Delete individual ---

func TestDeleteUser(t *testing.T) {
	skipIfRealDB(t)
	r := setupTest()

	tests := []struct {
		name           string
		mockFunc       func(ctx context.Context, uid string) error
		expectedStatus int
	}{
		{
			name: "Success",
			mockFunc: func(ctx context.Context, uid string) error { return nil },
			expectedStatus: http.StatusNoContent,
		},
		{
			name: "NotFound (Idempotent)",
			mockFunc: func(ctx context.Context, uid string) error { return errors.New("cannot find user") },
			expectedStatus: http.StatusNoContent,
		},
		{
			name: "Failure",
			mockFunc: func(ctx context.Context, uid string) error { return errors.New("crash") },
			expectedStatus: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			getAuthFunc = func(ctx context.Context) (AuthClient, error) {
				return &mockAuthClient{deleteUserFunc: tt.mockFunc}, nil
			}
			req, _ := http.NewRequest("DELETE", "/auth/users/u1", nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("%s: Expected %d, got %d", tt.name, tt.expectedStatus, w.Code)
			}
		})
	}
}

// --- 22-24. Delete Bulk ---

func TestDeleteUsersBulk(t *testing.T) {
	skipIfRealDB(t)
	r := setupTest()

	tests := []struct {
		name           string
		body           BulkDeleteRequest
		mockFunc       func(ctx context.Context, uids []string) (*auth.DeleteUsersResult, error)
		expectedStatus int
	}{
		{
			name: "Success",
			body: BulkDeleteRequest{UIDs: []string{"u1"}},
			mockFunc: func(ctx context.Context, uids []string) (*auth.DeleteUsersResult, error) { return &auth.DeleteUsersResult{}, nil },
			expectedStatus: http.StatusNoContent,
		},
		{
			name: "Empty List",
			body: BulkDeleteRequest{UIDs: []string{}},
			expectedStatus: http.StatusNoContent,
		},
		{
			name: "Failure",
			body: BulkDeleteRequest{UIDs: []string{"u1"}},
			mockFunc: func(ctx context.Context, uids []string) (*auth.DeleteUsersResult, error) { return nil, errors.New("err") },
			expectedStatus: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			getAuthFunc = func(ctx context.Context) (AuthClient, error) {
				return &mockAuthClient{deleteUsersFunc: tt.mockFunc}, nil
			}
			jsonBody, _ := json.Marshal(tt.body)
			req, _ := http.NewRequest("DELETE", "/auth/users/", bytes.NewBuffer(jsonBody))
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("%s: Expected %d, got %d", tt.name, tt.expectedStatus, w.Code)
			}
		})
	}
}

// --- 25. Delete All ---

func TestDeleteAll(t *testing.T) {
	skipIfRealDB(t)
	r := setupTest()
	// Mock DeleteAll Success (This is 25th test)
	getAuthFunc = func(ctx context.Context) (AuthClient, error) {
		return &mockAuthClient{
			listUsersFunc: func(ctx context.Context) ([]string, error) {
				return []string{}, nil
			},
		}, nil
	}
	req, _ := http.NewRequest("DELETE", "/auth/all", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("Expected 204, got %d", w.Code)
	}
}
