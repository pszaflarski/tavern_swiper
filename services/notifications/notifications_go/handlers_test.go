package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func setupTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.Default()
	r.GET("/notifications/health", handleHealth)
	r.Use(AuthMiddleware())

	n := r.Group("/notifications")
	{
		n.POST("/tokens", handleRegisterToken)
		n.DELETE("/tokens/:token", handleUnregisterToken)
	}
	return r
}

func signTestToken(uid, role string) string {
	claims := jwt.MapClaims{
		"sub":  uid,
		"role": role,
		"iat":  time.Now().Unix(),
		"exp":  time.Now().Add(30 * time.Minute).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := token.SignedString(jwtSecret)
	return s
}

func TestRegisterAndUnregisterToken(t *testing.T) {
	mock := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mock, nil
	}

	r := setupTestRouter()

	t.Run("RegisterToken_Success", func(t *testing.T) {
		w := httptest.NewRecorder()
		token := signTestToken("user123", "user")

		body := TokenRegister{
			Token:    "ExponentPushToken[123456]",
			DeviceID: "device-xyz",
			Platform: "android",
		}
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest("POST", "/notifications/tokens", bytes.NewBuffer(b))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")

		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
		}

		// Verify token is in DB
		docSnap, _ := mock.Collection(COLLECTION_TOKENS).Doc("ExponentPushToken[123456]").Get(context.Background())
		if !docSnap.Exists() {
			t.Errorf("Expected token doc to be created in DB")
		}
		if docSnap.Data()["user_id"] != "user123" {
			t.Errorf("Expected user_id 'user123', got '%v'", docSnap.Data()["user_id"])
		}
	})

	t.Run("RegisterToken_ValidationError", func(t *testing.T) {
		w := httptest.NewRecorder()
		token := signTestToken("user123", "user")

		body := TokenRegister{
			Token: "",
		}
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest("POST", "/notifications/tokens", bytes.NewBuffer(b))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")

		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("Expected 400, got %d", w.Code)
		}
	})

	t.Run("UnregisterToken_Success", func(t *testing.T) {
		// Pre-seed token
		mock.Collection(COLLECTION_TOKENS).Doc("ExponentPushToken[123456]").Set(context.Background(), map[string]interface{}{
			"token":   "ExponentPushToken[123456]",
			"user_id": "user123",
		})

		w := httptest.NewRecorder()
		token := signTestToken("user123", "user")

		req, _ := http.NewRequest("DELETE", "/notifications/tokens/ExponentPushToken[123456]", nil)
		req.Header.Set("Authorization", "Bearer "+token)

		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("Expected 200, got %d", w.Code)
		}

		// Verify deleted
		docSnap, _ := mock.Collection(COLLECTION_TOKENS).Doc("ExponentPushToken[123456]").Get(context.Background())
		if docSnap.Exists() {
			t.Errorf("Expected token doc to be deleted")
		}
	})

	t.Run("UnregisterToken_Forbidden_NotOwner", func(t *testing.T) {
		// Pre-seed token
		mock.Collection(COLLECTION_TOKENS).Doc("ExponentPushToken[777]").Set(context.Background(), map[string]interface{}{
			"token":   "ExponentPushToken[777]",
			"user_id": "another_user",
		})

		w := httptest.NewRecorder()
		token := signTestToken("hacker_user", "user")

		req, _ := http.NewRequest("DELETE", "/notifications/tokens/ExponentPushToken[777]", nil)
		req.Header.Set("Authorization", "Bearer "+token)

		r.ServeHTTP(w, req)

		if w.Code != http.StatusForbidden {
			t.Errorf("Expected 403, got %d", w.Code)
		}
	})
}
