package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"sync"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
)

var (
	db     FirestoreClient
	dbOnce sync.Once
	dbErr  error
	// realFSClient holds the underlying *firestore.Client for pipeline operations.
	// It is set once during DB initialization and accessed by getFeedCandidatesFunc.
	realFSClient *firestore.Client
)

// FirestoreClient defines the subset of firestore methods used for persistence
type FirestoreClient interface {
	Collection(path string) CollectionRef
	Batch() WriteBatch
}

type CollectionRef interface {
	Doc(path string) DocumentRef
	Where(path, op string, value interface{}) Query
	Limit(n int) Query
	Documents(ctx context.Context) DocumentIterator
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

type DocumentIterator interface {
	Next() (DocumentSnapshot, error)
	GetAll() ([]DocumentSnapshot, error)
}

type Query interface {
	Limit(n int) Query
	Where(path, op string, value interface{}) Query
	Documents(ctx context.Context) DocumentIterator
}

type WriteBatch interface {
	Set(dr DocumentRef, data interface{}, opts ...firestore.SetOption) WriteBatch
	Delete(dr DocumentRef) WriteBatch
	Commit(ctx context.Context) ([]*firestore.WriteResult, error)
}

// Wrapper types to satisfy the interfaces using real firestore types
type realClient struct{ *firestore.Client }
type realCollection struct{ *firestore.CollectionRef }
type realDoc struct{ *firestore.DocumentRef }
type realSnap struct{ *firestore.DocumentSnapshot }
type realIter struct{ *firestore.DocumentIterator }
type realQuery struct{ firestore.Query }
type realBatch struct{ *firestore.WriteBatch }

func (c realClient) Collection(path string) CollectionRef { return realCollection{c.Client.Collection(path)} }
func (c realClient) Batch() WriteBatch                    { return realBatch{c.Client.Batch()} }

func (c realCollection) Doc(path string) DocumentRef { return realDoc{c.CollectionRef.Doc(path)} }
func (c realCollection) Where(path, op string, value interface{}) Query {
	return realQuery{c.CollectionRef.Where(path, op, value)}
}
func (c realCollection) Limit(n int) Query {
	return realQuery{c.CollectionRef.Limit(n)}
}
func (c realCollection) Documents(ctx context.Context) DocumentIterator {
	return realIter{c.CollectionRef.Documents(ctx)}
}

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

func (i realIter) Next() (DocumentSnapshot, error) {
	s, err := i.DocumentIterator.Next()
	if err != nil {
		return nil, err
	}
	return realSnap{s}, nil
}
func (i realIter) GetAll() ([]DocumentSnapshot, error) {
	snaps, err := i.DocumentIterator.GetAll()
	if err != nil {
		return nil, err
	}
	res := make([]DocumentSnapshot, len(snaps))
	for j, s := range snaps {
		res[j] = realSnap{s}
	}
	return res, nil
}

func (q realQuery) Limit(n int) Query { return realQuery{q.Query.Limit(n)} }
func (q realQuery) Where(path, op string, value interface{}) Query {
	return realQuery{q.Query.Where(path, op, value)}
}
func (q realQuery) Documents(ctx context.Context) DocumentIterator {
	return realIter{q.Query.Documents(ctx)}
}

func (b realBatch) Set(dr DocumentRef, data interface{}, opts ...firestore.SetOption) WriteBatch {
	b.WriteBatch.Set(dr.(realDoc).DocumentRef, data, opts...)
	return b
}
func (b realBatch) Delete(dr DocumentRef) WriteBatch {
	b.WriteBatch.Delete(dr.(realDoc).DocumentRef)
	return b
}
func (b realBatch) Commit(ctx context.Context) ([]*firestore.WriteResult, error) {
	return b.WriteBatch.Commit(ctx)
}

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
		realDB, createErr := firestore.NewClientWithDatabase(ctx, projectID, dbID)
		if createErr == nil {
			db = realClient{realDB}
			realFSClient = realDB
		} else {
			dbErr = createErr
		}
	})
	return db, dbErr
}

// FeedCandidate holds the raw data for a single candidate profile returned by the feed pipeline.
type FeedCandidate struct {
	Data map[string]interface{}
}

// getFeedCandidatesFunc fetches discovery feed candidates. In production it uses
// the Firestore Enterprise Pipeline API; in tests it is replaced with a mock.
var getFeedCandidatesFunc = realGetFeedCandidates

// feedCandidateFields are the fields projected by the pipeline select stage.
var feedCandidateFields = []any{
	"profile_id", "display_name", "bio", "tagline", "gender",
	"character_class", "realm", "is_active", "image_urls", "talents",
}

func realGetFeedCandidates(ctx context.Context, collection string, excludeIDs []string, limit int) ([]FeedCandidate, error) {
	if realFSClient == nil {
		return nil, fmt.Errorf("firestore client not initialized")
	}

	pipeline := realFSClient.Pipeline().
		Collection(collection).
		Select(feedCandidateFields).
		Limit(limit)

	// Only apply the NotEqualAny filter if we have IDs to exclude
	if len(excludeIDs) > 0 {
		excludeVals := make([]interface{}, len(excludeIDs))
		for i, id := range excludeIDs {
			excludeVals[i] = id
		}
		pipeline = pipeline.Where(firestore.NotEqualAny("profile_id", excludeVals))
	}

	snapshot := pipeline.Execute(ctx)
	iter := snapshot.Results()
	defer iter.Stop()

	var candidates []FeedCandidate
	for {
		result, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("pipeline iteration error: %w", err)
		}
		candidates = append(candidates, FeedCandidate{Data: result.Data()})
	}

	return candidates, nil
}
