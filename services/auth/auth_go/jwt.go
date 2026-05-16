package main

import (
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var (
	jwtSecret = []byte(getEnv("JWT_SECRET", "super-secret-tavern-key-123"))
)

func getJWTExpiry() time.Duration {
	defaultExpiry := 24 * time.Hour

	// Security: Only allow long-lived tokens if ALLOW_LONG_LIVED_TOKENS is "true"
	// AND we are either using the Firebase emulator OR the project ID ends in "-dev"
	allowLongLived := os.Getenv("ALLOW_LONG_LIVED_TOKENS") == "true"
	projectID := os.Getenv("GOOGLE_CLOUD_PROJECT")
	isEmulator := os.Getenv("FIREBASE_AUTH_EMULATOR_HOST") != ""
	isDevProject := strings.HasSuffix(projectID, "-dev")

	if allowLongLived && (isEmulator || isDevProject) {
		// Support manual override in seconds
		if override := os.Getenv("TAVERN_JWT_EXPIRY"); override != "" {
			if seconds, err := strconv.Atoi(override); err == nil {
				return time.Duration(seconds) * time.Second
			}
		}
		// Default "forever" for dev is 100 years
		return 100 * 365 * 24 * time.Hour
	}

	return defaultExpiry
}

// mintTavernJWT creates a signed JWT and returns the token string + expiry unix timestamp.
func mintTavernJWT(uid, email, role string) (string, int64, error) {
	now := time.Now()
	expiry := getJWTExpiry()
	expiresAt := now.Add(expiry).Unix()
	
	claims := jwt.MapClaims{
		"sub":   uid,
		"email": email,
		"role":  role,
		"iat":   now.Unix(),
		"exp":   expiresAt,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(jwtSecret)
	return signed, expiresAt, err
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	if key == "JWT_SECRET" {
		projectID := os.Getenv("GOOGLE_CLOUD_PROJECT")
		isEmulator := os.Getenv("FIREBASE_AUTH_EMULATOR_HOST") != ""
		isDevProject := strings.HasSuffix(projectID, "-dev")
		if !isEmulator && !isDevProject && !strings.HasSuffix(os.Args[0], ".test") {
			panic("CRITICAL: " + key + " is missing in non-dev environment. Failing hard.")
		}
	}
	return fallback
}
