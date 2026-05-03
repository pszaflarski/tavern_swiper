package main

import (
	"context"
	"log"
	"os"
	"sync"

)

var (
	usersDB      FirestoreClient
	usersDBOnce  sync.Once
	usersDBError error

	authDB       FirestoreClient
	authDBOnce   sync.Once
	authDBError  error
)

// Function pointers to allow mocking in tests
var (
	getUsersDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return getUsersDBInternal(ctx)
	}
	getAuthDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return getAuthDBInternal(ctx)
	}
)

func getUsersDBInternal(ctx context.Context) (FirestoreClient, error) {
	usersDBOnce.Do(func() {
		projectID := os.Getenv("GOOGLE_CLOUD_PROJECT")
		dbID := os.Getenv("USERS_DATABASE_ID")
		if dbID == "" {
			dbID = "users"
		}
		log.Printf("Initializing Users Firestore client for DB: %s", dbID)
		
		newDB, err := newFirestoreClient(context.Background(), projectID, dbID)
		if err == nil {
			usersDB = newDB
		} else {
			usersDBError = err
		}
	})
	return usersDB, usersDBError
}

func getAuthDBInternal(ctx context.Context) (FirestoreClient, error) {
	authDBOnce.Do(func() {
		projectID := os.Getenv("GOOGLE_CLOUD_PROJECT")
		dbID := os.Getenv("FIRESTORE_DATABASE_ID")
		if dbID == "" {
			dbID = "auth"
		}
		log.Printf("Initializing Auth Firestore client for DB: %s", dbID)
		
		newDB, err := newFirestoreClient(context.Background(), projectID, dbID)
		if err == nil {
			authDB = newDB
		} else {
			authDBError = err
		}
	})
	return authDB, authDBError
}
