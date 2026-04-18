package main

import (
	"context"
	"log"
	"os"
	"sync"

	"cloud.google.com/go/firestore"
)

var (
	usersDB      *firestore.Client
	usersDBOnce  sync.Once
	usersDBError error

	authDB       *firestore.Client
	authDBOnce   sync.Once
	authDBError  error
)

// FirestoreClient defines the subset of firestore methods used for user role lookup
type FirestoreClient interface {
	Collection(path string) *firestore.CollectionRef
}

// Function pointers to allow mocking in tests
var (
	getUsersDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return getUsersDBInternal(ctx)
	}
	getAuthDBFunc = getAuthDBInternal
)

func getUsersDBInternal(ctx context.Context) (*firestore.Client, error) {
	usersDBOnce.Do(func() {
		projectID := os.Getenv("GOOGLE_CLOUD_PROJECT")
		dbID := os.Getenv("USERS_DATABASE_ID")
		if dbID == "" {
			dbID = "users"
		}
		log.Printf("Initializing Users Firestore client for DB: %s", dbID)
		// Use Background context for client initialization
		usersDB, usersDBError = firestore.NewClientWithDatabase(context.Background(), projectID, dbID)
	})
	return usersDB, usersDBError
}

func getAuthDBInternal(ctx context.Context) (*firestore.Client, error) {
	authDBOnce.Do(func() {
		projectID := os.Getenv("GOOGLE_CLOUD_PROJECT")
		dbID := os.Getenv("FIRESTORE_DATABASE_ID")
		if dbID == "" {
			dbID = "auth"
		}
		log.Printf("Initializing Auth Firestore client for DB: %s", dbID)
		// Use Background context for client initialization
		authDB, authDBError = firestore.NewClientWithDatabase(context.Background(), projectID, dbID)
	})
	return authDB, authDBError
}
