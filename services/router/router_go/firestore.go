package main

import (
	"context"
	"log"
	"os"
	"sync"
)

var (
	db     FirestoreClient
	dbOnce sync.Once
	dbErr  error
)

// Function pointer to allow mocking in tests
var getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
	return getDBInternal(ctx)
}

func getDBInternal(ctx context.Context) (FirestoreClient, error) {
	dbOnce.Do(func() {
		projectID := os.Getenv("GOOGLE_CLOUD_PROJECT")
		dbID := os.Getenv("FIRESTORE_DATABASE_ID")
		if dbID == "" {
			dbID = "(default)"
		}
		log.Printf("[INFO] Initializing Firestore Client for project: %s, DB: %s", projectID, dbID)

		newDB, err := newFirestoreClient(context.Background(), projectID, dbID)
		if err == nil {
			db = newDB
		} else {
			dbErr = err
		}
	})
	return db, dbErr
}
