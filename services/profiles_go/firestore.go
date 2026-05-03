package main

import (
	"context"
	"log"
	"os"
	"sync"

	"tavern-swiper.app/firestoreutil"
)

var (
	db     firestoreutil.FirestoreClient
	dbOnce sync.Once
	dbErr  error
)

// Function pointer to allow mocking in tests
var getDBFunc = func(ctx context.Context) (firestoreutil.FirestoreClient, error) {
	return getDBInternal(ctx)
}

func getDBInternal(ctx context.Context) (firestoreutil.FirestoreClient, error) {
	dbOnce.Do(func() {
		projectID := os.Getenv("GOOGLE_CLOUD_PROJECT")
		dbID := os.Getenv("FIRESTORE_DATABASE_ID")
		if dbID == "" {
			dbID = "(default)"
		}
		log.Printf("[INFO] Initializing Firestore Client for project: %s, DB: %s", projectID, dbID)
		
		newDB, err := firestoreutil.NewClient(context.Background(), projectID, dbID)
		if err == nil {
			db = newDB
		} else {
			dbErr = err
		}
	})
	return db, dbErr
}
