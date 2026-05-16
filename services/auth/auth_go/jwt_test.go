package main

import (
	"os"
	"testing"
	"time"
)

func TestGetJWTExpiry(t *testing.T) {
	// 1. Test Default (no environment variables)
	os.Unsetenv("ALLOW_LONG_LIVED_TOKENS")
	os.Unsetenv("GOOGLE_CLOUD_PROJECT")
	os.Unsetenv("FIREBASE_AUTH_EMULATOR_HOST")
	os.Unsetenv("TAVERN_JWT_EXPIRY")

	expiry := getJWTExpiry()
	if expiry != 24*time.Hour {
		t.Errorf("Expected default expiry 24h, got %v", expiry)
	}

	// 2. Test ALLOW_LONG_LIVED without dev environment
	os.Setenv("ALLOW_LONG_LIVED_TOKENS", "true")
	os.Setenv("GOOGLE_CLOUD_PROJECT", "production-project")
	expiry = getJWTExpiry()
	if expiry != 24*time.Hour {
		t.Errorf("Expected default expiry 24h in prod even with flag, got %v", expiry)
	}

	// 3. Test ALLOW_LONG_LIVED with dev project
	os.Setenv("GOOGLE_CLOUD_PROJECT", "tavern-swiper-dev")
	expiry = getJWTExpiry()
	expectedForever := 100 * 365 * 24 * time.Hour
	if expiry != expectedForever {
		t.Errorf("Expected forever expiry in dev, got %v", expiry)
	}

	// 4. Test ALLOW_LONG_LIVED with emulator
	os.Setenv("GOOGLE_CLOUD_PROJECT", "prod") // Overwrite
	os.Setenv("FIREBASE_AUTH_EMULATOR_HOST", "localhost:9099")
	expiry = getJWTExpiry()
	if expiry != expectedForever {
		t.Errorf("Expected forever expiry with emulator, got %v", expiry)
	}

	// 5. Test manual override in dev mode
	os.Setenv("TAVERN_JWT_EXPIRY", "3600")
	expiry = getJWTExpiry()
	if expiry != 1*time.Hour {
		t.Errorf("Expected manual override 1h, got %v", expiry)
	}

	// 6. Test manual override ignored in prod mode
	os.Unsetenv("ALLOW_LONG_LIVED_TOKENS")
	expiry = getJWTExpiry()
	if expiry != 24*time.Hour {
		t.Errorf("Expected manual override ignored in prod, got %v", expiry)
	}
}
