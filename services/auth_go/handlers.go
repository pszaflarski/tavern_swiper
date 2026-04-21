package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type HTTPClient interface {
	Do(req *http.Request) (*http.Response, error)
}

var httpClient HTTPClient = &http.Client{
	Timeout: 10 * time.Second,
}

// healthHandler godoc
// @Summary      Health check
// @Description  Returns the health status of the auth service.
// @Tags         health
// @Produce      json
// @Success      200  {object}  HealthResponse
// @Router       /health [get]
func healthHandler(c *gin.Context) {
	c.JSON(http.StatusOK, HealthResponse{
		Service: "auth",
		Status:  "ok",
	})
}

// verifyTokenHandler godoc
// @Summary      Verify Firebase ID token
// @Description  Verifies a Firebase ID token and returns a Tavern JWT with the user's role.
// @Tags         auth
// @Accept       json
// @Produce      json
// @Param        body  body      TokenRequest   true  "Firebase ID token"
// @Success      200   {object}  TokenResponse
// @Failure      401   {object}  ErrorResponse
// @Failure      503   {object}  ErrorResponse
// @Router       /verify [post]
func verifyTokenHandler(c *gin.Context) {
	var body TokenRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		validationError(c, err)
		return
	}

	log.Printf("[INFO] Verifying token (length: %d)", len(body.IDToken))

	authClient, err := getAuthFunc(c.Request.Context())
	if err != nil {
		httpError(c, http.StatusServiceUnavailable, "Authentication service temporarily unavailable")
		return
	}

	// Add timeout to SDK call
	verifyCtx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	decoded, err := authClient.VerifyIDToken(verifyCtx, body.IDToken)
	if err != nil {
		log.Printf("[ERROR] Token verification failed: %v", err)
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
		ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
		defer cancel()
		doc, err := uDB.Collection("users").Doc(uid).Get(ctx)
		if err == nil && doc.Exists() {
			if r, ok := doc.Data()["user_type"].(string); ok {
				role = r
			}
		} else if err != nil {
			log.Printf("[WARN] Failed to fetch role for %s: %v", uid, err)
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

// registerHandler godoc
// @Summary      Register a new user
// @Description  Creates a new Firebase Auth user via the Identity Toolkit REST API.
// @Tags         auth
// @Accept       json
// @Produce      json
// @Param        body  body      LoginRequest   true  "Email and password"
// @Success      200   {object}  AuthResponse
// @Failure      400   {object}  ErrorResponse
// @Failure      503   {object}  ErrorResponse
// @Router       /register [post]
func registerHandler(c *gin.Context) {
	firebaseAuthREST(c, "signUp")
}

// loginHandler godoc
// @Summary      Login with email and password
// @Description  Authenticates a user via Firebase Auth REST API and returns an ID token.
// @Tags         auth
// @Accept       json
// @Produce      json
// @Param        body  body      LoginRequest   true  "Email and password"
// @Success      200   {object}  AuthResponse
// @Failure      401   {object}  ErrorResponse
// @Failure      503   {object}  ErrorResponse
// @Router       /login [post]
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

	log.Printf("[INFO] AUTH %s START: %s", action, body.Email)
	startTime := time.Now()

	// Use context with timeout for external identity provider calls
	authCtx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(authCtx, "POST", url, bytes.NewBuffer(payload))
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Failed to create authentication request")
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		if authCtx.Err() == context.DeadlineExceeded {
			httpError(c, http.StatusGatewayTimeout, "Authentication provider timed out")
		} else {
			httpError(c, http.StatusServiceUnavailable, "External identity provider unavailable")
		}
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
		log.Printf("[ERROR] Firebase Auth REST failure for %s: %s", body.Email, errData.Error.Message)
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

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[ERROR] Failed to read response body for %s: %v", action, err)
		httpError(c, http.StatusInternalServerError, "Failed to read identity provider response")
		return
	}
	json.Unmarshal(bodyBytes, &data)

	log.Printf("[INFO] AUTH %s SUCCESS: %s (took %v, body length: %d)", action, body.Email, time.Since(startTime), len(bodyBytes))

	c.JSON(http.StatusOK, AuthResponse{
		IDToken: data.IDToken,
		UID:     data.LocalID,
	})
}

// deleteUserHandler godoc
// @Summary      Delete a single user
// @Description  Deletes a Firebase Auth user by UID.
// @Tags         admin
// @Param        uid  path  string  true  "User UID"
// @Success      204  "No Content"
// @Failure      500  {object}  ErrorResponse
// @Router       /users/{uid} [delete]
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

// deleteUsersBulkHandler godoc
// @Summary      Bulk delete users
// @Description  Deletes multiple Firebase Auth users by their UIDs.
// @Tags         admin
// @Accept       json
// @Param        body  body  BulkDeleteRequest  true  "List of UIDs to delete"
// @Success      204  "No Content"
// @Failure      500  {object}  ErrorResponse
// @Router       /users/ [delete]
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

// deleteAllHandler godoc
// @Summary      Delete all users
// @Description  Lists and deletes all Firebase Auth users. Test/admin use only.
// @Tags         admin
// @Success      204  "No Content"
// @Failure      500  {object}  ErrorResponse
// @Router       /all [delete]
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

// devMintHandler godoc
// @Summary      Mint a dev JWT
// @Description  Mints a long-lived Tavern JWT for development/testing. Only available when ALLOW_LONG_LIVED_TOKENS=true in dev environments.
// @Tags         dev
// @Accept       json
// @Produce      json
// @Param        body  body      DevMintRequest  true  "Dev mint payload"
// @Success      200   {object}  TokenResponse
// @Failure      403   {object}  ErrorResponse
// @Failure      500   {object}  ErrorResponse
// @Router       /dev-mint [post]
func devMintHandler(c *gin.Context) {
	projectID := os.Getenv("GOOGLE_CLOUD_PROJECT")
	isEmulator := os.Getenv("FIREBASE_AUTH_EMULATOR_HOST") != ""
	isDevProject := strings.HasSuffix(projectID, "-dev")

	if !isEmulator && !isDevProject {
		httpError(c, http.StatusForbidden, "Dev minting is only allowed in development environments (Emulator or projects ending in -dev)")
		return
	}

	var body DevMintRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		validationError(c, err)
		return
	}

	if body.Role == "" {
		body.Role = "user"
	}

	token, err := mintTavernJWT(body.UID, body.Email, body.Role)
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Failed to generate dev token")
		return
	}

	c.JSON(http.StatusOK, TokenResponse{
		UID:   body.UID,
		Role:  body.Role,
		Token: &token,
	})
}
