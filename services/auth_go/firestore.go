package main

import (
	"context"
	"log"
	"os"
	"sync"

	"tavern-swiper.app/firestoreutil"
)

var (
	usersDB      firestoreutil.FirestoreClient
	usersDBOnce  sync.Once
	usersDBError error

	authDB       firestoreutil.FirestoreClient
	authDBOnce   sync.Once
	authDBError  error
)

// Function pointers to allow mocking in tests
var (
	getUsersDBFunc = func(ctx context.Context) (firestoreutil.FirestoreClient, error) {
		return getUsersDBInternal(ctx)
	}
	getAuthDBFunc = func(ctx context.Context) (firestoreutil.FirestoreClient, error) {
		return getAuthDBInternal(ctx)
	}
)

func getUsersDBInternal(ctx context.Context) (firestoreutil.FirestoreClient, error) {
	usersDBOnce.Do(func() {
		projectID := os.Getenv("GOOGLE_CLOUD_PROJECT")
		dbID := os.Getenv("USERS_DATABASE_ID")
		if dbID == "" {
			dbID = "users"
		}
		log.Printf("Initializing Users Firestore client for DB: %s", dbID)
		
		newDB, err := firestoreutil.NewClient(context.Background(), projectID, dbID)
		if err == nil {
			usersDB = newDB
		} else {
			usersDBError = err
		}
	})
	return usersDB, usersDBError
}

func getAuthDBInternal(ctx context.Context) (firestoreutil.FirestoreClient, error) {
	authDBOnce.Do(func() {
		projectID := os.Getenv("GOOGLE_CLOUD_PROJECT")
		dbID := os.Getenv("FIRESTORE_DATABASE_ID")
		if dbID == "" {
			dbID = "auth"
		}
		log.Printf("Initializing Auth Firestore client for DB: %s", dbID)
		
		newDB, err := firestoreutil.NewClient(context.Background(), projectID, dbID)
		if err == nil {
			authDB = newDB
		} else {
			authDBError = err
		}
	})
	return authDB, authDBError
}
