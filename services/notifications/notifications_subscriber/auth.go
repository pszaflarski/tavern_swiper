package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"time"
)

// generateInternalJWT creates a short-lived token using the shared JWT_SECRET.
// It sets role="admin" to bypass auth checks in the target service.
func generateInternalJWT() (string, error) {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		return "", fmt.Errorf("JWT_SECRET is not set")
	}

	header := map[string]interface{}{
		"alg": "HS256",
		"typ": "JWT",
	}

	claims := map[string]interface{}{
		"sub":  "notifications-subscriber-internal",
		"role": "admin",
		"iat":  time.Now().Unix(),
		"exp":  time.Now().Add(5 * time.Minute).Unix(),
	}

	headerJSON, _ := json.Marshal(header)
	claimsJSON, _ := json.Marshal(claims)

	headerBase64 := base64.RawURLEncoding.EncodeToString(headerJSON)
	claimsBase64 := base64.RawURLEncoding.EncodeToString(claimsJSON)

	unsignedToken := headerBase64 + "." + claimsBase64

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(unsignedToken))
	signature := mac.Sum(nil)

	signatureBase64 := base64.RawURLEncoding.EncodeToString(signature)

	return unsignedToken + "." + signatureBase64, nil
}
