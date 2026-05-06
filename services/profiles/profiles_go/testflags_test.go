package main

import (
	"flag"
	"os"
	"testing"
)

var useRealDB = flag.Bool("real-db", false, "Use real Firestore database instead of mocks")
var gcpProject = flag.String("project", "tavern-swiper-dev", "GCP project for real DB tests")
var firestoreDB = flag.String("db-id", "profiles-dev", "Firestore database ID for real DB tests")

// setupRealDBEnv sets environment variables needed by getDBInternal when using -real-db.
func setupRealDBEnv(t *testing.T) {
	t.Helper()
	if !*useRealDB {
		return
	}
	// Set env vars that getDBInternal reads, saving originals for cleanup
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
