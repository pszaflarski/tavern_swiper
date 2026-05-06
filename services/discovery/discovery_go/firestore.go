package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"sync"
	"time"

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
		
		// Initialize Firestore client
		newDB, createErr := newFirestoreClient(ctx, projectID, dbID)
		if createErr == nil {
			db = newDB
			// We still need the underlying client for some operations if they aren't in the interface
			// but we can try to use the interface methods where possible.
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
	if db == nil {
		return nil, fmt.Errorf("firestore client not initialized")
	}

	start := time.Now()

	pipeline := db.Pipeline().Collection(collection)

	// Only apply the NotEqualAny filter if we have IDs to exclude
	if len(excludeIDs) > 0 {
		excludeVals := make([]interface{}, len(excludeIDs))
		for i, id := range excludeIDs {
			excludeVals[i] = id
		}
		pipeline = pipeline.Where(firestore.NotEqualAny("profile_id", excludeVals))
	}

	pipeline = pipeline.
		Select(feedCandidateFields).
		Limit(limit)

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

	log.Printf("[BENCHMARK] Feed pipeline for collection %s with %d exclusions took %v (found %d candidates)", 
		collection, len(excludeIDs), time.Since(start), len(candidates))

	return candidates, nil
}
