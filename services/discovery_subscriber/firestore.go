package main

import (
	"context"
	"log"
	"os"
	"sync"

	"cloud.google.com/go/firestore"
)

var (
	db     FirestoreClient
	dbOnce sync.Once
	dbErr  error
)

// FirestoreClient defines the subset of firestore methods used for persistence
type FirestoreClient interface {
	Collection(path string) CollectionRef
}

type CollectionRef interface {
	Doc(path string) DocumentRef
}

type DocumentRef interface {
	Get(ctx context.Context) (DocumentSnapshot, error)
	Set(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error)
	Delete(ctx context.Context, opts ...firestore.Precondition) (*firestore.WriteResult, error)
}

type DocumentSnapshot interface {
	Exists() bool
	Data() map[string]interface{}
	ID() string
	Ref() DocumentRef
}

// Wrapper types to satisfy the interfaces using real firestore types
type realClient struct{ *firestore.Client }
type realCollection struct{ *firestore.CollectionRef }
type realDoc struct{ *firestore.DocumentRef }
type realSnap struct{ *firestore.DocumentSnapshot }

func (c realClient) Collection(path string) CollectionRef { return realCollection{c.Client.Collection(path)} }

func (c realCollection) Doc(path string) DocumentRef { return realDoc{c.CollectionRef.Doc(path)} }

func (d realDoc) Get(ctx context.Context) (DocumentSnapshot, error) {
	s, err := d.DocumentRef.Get(ctx)
	if err != nil {
		return nil, err
	}
	return realSnap{s}, nil
}
func (d realDoc) Set(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
	return d.DocumentRef.Set(ctx, data, opts...)
}
func (d realDoc) Delete(ctx context.Context, opts ...firestore.Precondition) (*firestore.WriteResult, error) {
	return d.DocumentRef.Delete(ctx, opts...)
}

func (s realSnap) Exists() bool                 { return s.DocumentSnapshot.Exists() }
func (s realSnap) Data() map[string]interface{} { return s.DocumentSnapshot.Data() }
func (s realSnap) ID() string                   { return s.DocumentSnapshot.Ref.ID }
func (s realSnap) Ref() DocumentRef             { return realDoc{s.DocumentSnapshot.Ref} }

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
		realDB, err := firestore.NewClientWithDatabase(ctx, projectID, dbID)
		if err == nil {
			db = realClient{realDB}
		} else {
			dbErr = err
		}
	})
	return db, dbErr
}
