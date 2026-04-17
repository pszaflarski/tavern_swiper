package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
)

func healthHandler(c *gin.Context) {
	c.JSON(http.StatusOK, HealthResponse{
		Service: "auth",
		Status:  "ok",
	})
}

func verifyTokenHandler(c *gin.Context) {
	var body TokenRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		validationError(c, err)
		return
	}

	authClient, err := getAuthFunc(c.Request.Context())
	if err != nil {
		httpError(c, http.StatusServiceUnavailable, "Authentication service temporarily unavailable")
		return
	}

	decoded, err := authClient.VerifyIDToken(c.Request.Context(), body.IDToken)
	if err != nil {
		// Basic error mapping for verify
		msg := err.Error()
		if contains(msg, "ID token has expired") {
			httpError(c, http.StatusUnauthorized, "Token has expired")
		} else {
			httpError(c, http.StatusUnauthorized, "Invalid authentication token")
		}
		return
	}

	uid := decoded.UID
	email, _ := decoded.Claims["email"].(string)

	// Fetch role from users database (Preserving cross-DB access as requested)
	role := "user"
	uDB, err := getUsersDBFunc(c.Request.Context())
	if err == nil {
		doc, err := uDB.Collection("users").Doc(uid).Get(c.Request.Context())
		if err == nil && doc.Exists() {
			if r, ok := doc.Data()["user_type"].(string); ok {
				role = r
			}
		} else if err != nil {
			log.Printf("Warning: Failed to fetch role for %s: %v", uid, err)
		}
	}

	token, err := mintTavernJWT(uid, email, role)
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Failed to generate internal token")
		return
	}

	c.JSON(http.StatusOK, TokenResponse{
		UID:   uid,
		Role:  role,
		Token: &token,
	})
}

func registerHandler(c *gin.Context) {
	firebaseAuthREST(c, "signUp")
}

func loginHandler(c *gin.Context) {
	firebaseAuthREST(c, "signInWithPassword")
}

func firebaseAuthREST(c *gin.Context, action string) {
	var body LoginRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		validationError(c, err)
		return
	}

	apiKey := os.Getenv("FIREBASE_WEB_API_KEY")
	if apiKey == "" {
		httpError(c, http.StatusServiceUnavailable, "Authentication provider configuration error")
		return
	}

	authURL := os.Getenv("FIREBASE_AUTH_URL")
	if authURL == "" {
		authURL = "https://identitytoolkit.googleapis.com/v1/accounts"
	}
	url := fmt.Sprintf("%s:%s?key=%s", authURL, action, apiKey)
	payload, _ := json.Marshal(map[string]interface{}{
		"email":             body.Email,
		"password":          body.Password,
		"returnSecureToken": true,
	})

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(url, "application/json", bytes.NewBuffer(payload))
	if err != nil {
		httpError(c, http.StatusServiceUnavailable, "External identity provider unavailable")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var errData struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		json.NewDecoder(resp.Body).Decode(&errData)
		errorMsg := mapFirebaseError(errData.Error.Message)
		
		status := resp.StatusCode
		if action == "signInWithPassword" && (resp.StatusCode == http.StatusBadRequest || resp.StatusCode == http.StatusUnauthorized) {
			status = http.StatusUnauthorized
		}
		
		httpError(c, status, errorMsg)
		return
	}

	var data struct {
		IDToken string `json:"idToken"`
		LocalID string `json:"localId"`
	}
	json.NewDecoder(resp.Body).Decode(&data)

	c.JSON(http.StatusOK, AuthResponse{
		IDToken: data.IDToken,
		UID:     data.LocalID,
	})
}

func deleteUserHandler(c *gin.Context) {
	uid := c.Param("uid")
	authClient, err := getAuthFunc(c.Request.Context())
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Failed to initialize auth client")
		return
	}

	err = authClient.DeleteUser(c.Request.Context(), uid)
	if err != nil && !contains(err.Error(), "cannot find user") {
		httpError(c, http.StatusInternalServerError, "Failed to process user identity deletion")
		return
	}

	c.Status(http.StatusNoContent)
}

func deleteUsersBulkHandler(c *gin.Context) {
	var body BulkDeleteRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		validationError(c, err)
		return
	}

	if len(body.UIDs) == 0 {
		c.Status(http.StatusNoContent)
		return
	}

	authClient, err := getAuthFunc(c.Request.Context())
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Failed to initialize auth client")
		return
	}

	_, err = authClient.DeleteUsers(c.Request.Context(), body.UIDs)
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Failed to process bulk identity deletion")
		return
	}

	c.Status(http.StatusNoContent)
}

func deleteAllHandler(c *gin.Context) {
	authClient, err := getAuthFunc(c.Request.Context())
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Failed to initialize auth client")
		return
	}

	uids, err := authClient.ListUsers(c.Request.Context())
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Failed to clear identity store")
		return
	}

	for _, uid := range uids {
		// Bulk delete in batches of 100 for safety (SDK supports up to 1000)
		authClient.DeleteUsers(c.Request.Context(), []string{uid})
	}

	c.Status(http.StatusNoContent)
}
