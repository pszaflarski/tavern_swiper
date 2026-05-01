package main

import (
	"flag"
	"os"
	"testing"
)

var useRealDB = flag.Bool("real-db", false, "Use real Firestore database instead of mocks")
var gcpProject = flag.String("project", "tavern-swiper-dev", "GCP project for real DB tests")
var firestoreDB = flag.String("db-id", "auth-dev", "Firestore database ID for real DB tests")

// skipIfRealDB skips the current test when running against a real Firestore database.
// Use this for tests that depend on mock internals (pre-seeded data, error injection, etc.)
func skipIfRealDB(t *testing.T) {
	t.Helper()
	if *useRealDB {
		t.Skip("Skipping mock-only test (run without -real-db)")
	}
}

// setupRealDBEnv sets environment variables needed by getDBInternal when using -real-db.
func setupRealDBEnv(t *testing.T) {
	t.Helper()
	if !*useRealDB {
		return
	}
	origProject := os.Getenv("GOOGLE_CLOUD_PROJECT")
	origDB := os.Getenv("FIRESTORE_DATABASE_ID")
	os.Setenv("GOOGLE_CLOUD_PROJECT", *gcpProject)
	os.Setenv("FIRESTORE_DATABASE_ID", *firestoreDB)
	t.Cleanup(func() {
		if origProject != "" {
			os.Setenv("GOOGLE_CLOUD_PROJECT", origProject)
		}
		if origDB != "" {
			os.Setenv("FIRESTORE_DATABASE_ID", origDB)
		}
	})
}
