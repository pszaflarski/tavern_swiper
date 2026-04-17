package main

import (
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var (
	jwtSecret  = []byte(getEnv("JWT_SECRET", "super-secret-tavern-key-123"))
	jwtExpiry  = 30 * time.Minute
)

func mintTavernJWT(uid, email, role string) (string, error) {
	now := time.Now()
	claims := jwt.MapClaims{
		"sub":  uid,
		"email": email,
		"role":  role,
		"iat":   now.Unix(),
		"exp":   now.Add(jwtExpiry).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}
