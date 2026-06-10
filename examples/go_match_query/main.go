package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
)

func main() {
	ctx := context.Background()

	// 1. Get configuration from environment
	projectID := os.Getenv("GOOGLE_CLOUD_PROJECT")
	if projectID == "" {
		log.Fatal("GOOGLE_CLOUD_PROJECT environment variable is required")
	}

	databaseID := os.Getenv("FIRESTORE_DATABASE_ID")
	if databaseID == "" {
		databaseID = "(default)"
	}

	profileID := os.Getenv("PROFILE_ID")
	if profileID == "" {
		// Default to a common test profile ID or ask user to provide one
		fmt.Println("Warning: PROFILE_ID not set, using default 'test_profile_id'")
		profileID = "test_profile_id"
	}

	fmt.Printf("Connecting to project: %s, database: %s\n", projectID, databaseID)
	fmt.Printf("Searching for matches containing profile: %s\n", profileID)

	// 2. Initialize Firestore client
	client, err := firestore.NewClientWithDatabase(ctx, projectID, databaseID)
	if err != nil {
		log.Fatalf("Failed to create firestore client: %v", err)
	}
	defer client.Close()

	// 3. Run the query using the correct 'array-contains' syntax
	// Collection: discovery_matches_cache
	// Field: profile_ids (which is an array of strings)
	iter := client.Collection("discovery_matches_cache").
		Where("profile_ids", "array-contains", profileID).
		Documents(ctx)

	count := 0
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			log.Fatalf("Failed to iterate matches: %v", err)
		}

		fmt.Printf("Found Match! ID: %s\nData: %v\n", doc.Ref.ID, doc.Data())
		count++
	}

	if count == 0 {
		fmt.Println("No matches found in the cache.")
		fmt.Println("\nTip: Run the profile swipe example first to populate the cache!")
	} else {
		fmt.Printf("\nSuccessfully found %d matches using array-contains query.\n", count)
	}
}
