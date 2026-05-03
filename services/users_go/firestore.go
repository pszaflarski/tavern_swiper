package main

import (
	"context"
	"fmt"
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
		if projectID == "" {
			dbErr = fmt.Errorf("GOOGLE_CLOUD_PROJECT environment variable is required")
			log.Printf("[ERROR] %v", dbErr)
			return
		}

		dbID := os.Getenv("FIRESTORE_DATABASE_ID")
		if dbID == "" {
			dbID = "(default)"
		}
		log.Printf("Initializing Firestore client for project %s, DB: %s", projectID, dbID)
		
		newDB, err := firestoreutil.NewClient(context.Background(), projectID, dbID)
		if err == nil {
			db = newDB
		} else {
			dbErr = fmt.Errorf("failed to create firestore client: %v", err)
			log.Printf("[ERROR] %v", dbErr)
		}
	})
	return db, dbErr
}
