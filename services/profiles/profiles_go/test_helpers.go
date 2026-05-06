package main

import (
	"time"
	"github.com/golang-jwt/jwt/v5"
	"testing"
)

func ptrBool(b bool) *bool { return &b }
func ptrStr(s string) *string { return &s }
func ptrInt(i int) *int { return &i }

func signGoTestToken(uid string, role string) string {
	now := time.Date(2026, 4, 17, 10, 0, 0, 0, time.UTC)
	return signGoTestTokenWithTimes(uid, role, now, now.Add(30*time.Minute))
}

func signGoTestTokenWithTimes(uid string, role string, iat time.Time, exp time.Time) string {
	claims := jwt.MapClaims{
		"sub":  uid,
		"role": role,
		"iat":  iat.Unix(),
		"exp":  exp.Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := token.SignedString(jwtSecret)
	return s
}

func skipIfRealDB(t *testing.T) {
	t.Helper()
	if *useRealDB {
		t.Skip("Skipping mock-only test (run without -real-db)")
	}
}
