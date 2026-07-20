package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"cloud.google.com/go/bigquery"
	"github.com/gin-gonic/gin"
	"google.golang.org/api/iterator"
)

// BigQueryClient abstracts the BigQuery client for testing.
type BigQueryClient interface {
	Query(q string) BigQueryQuery
	Close() error
}

type BigQueryQuery interface {
	Read(ctx context.Context) (BigQueryIterator, error)
}

type BigQueryIterator interface {
	Next(dst interface{}) error
}

type realBQClient struct {
	client *bigquery.Client
}

func (r *realBQClient) Query(q string) BigQueryQuery {
	return &realBQQuery{r.client.Query(q)}
}

func (r *realBQClient) Close() error {
	return r.client.Close()
}

type realBQQuery struct {
	query *bigquery.Query
}

func (r *realBQQuery) Read(ctx context.Context) (BigQueryIterator, error) {
	it, err := r.query.Read(ctx)
	if err != nil {
		return nil, err
	}
	return &realBQIterator{it}, nil
}

type realBQIterator struct {
	iterator *bigquery.RowIterator
}

func (r *realBQIterator) Next(dst interface{}) error {
	return r.iterator.Next(dst)
}

var getBQClientFunc = func(ctx context.Context, projectID string) (BigQueryClient, error) {
	client, err := bigquery.NewClient(ctx, projectID)
	if err != nil {
		return nil, err
	}
	return &realBQClient{client}, nil
}

type ReconcileRow struct {
	DocumentID     string    `bigquery:"document_id"`
	Action         string    `bigquery:"action"`
	EventTimestamp time.Time `bigquery:"event_timestamp"`
	Payload        string    `bigquery:"payload"`
}

type InitialLoadRow struct {
	DocumentID     string    `bigquery:"document_id"`
	EventTimestamp time.Time `bigquery:"event_timestamp"`
	Payload        string    `bigquery:"payload"`
}

func resolveEnv() string {
	if env := os.Getenv("ENV"); env != "" {
		return env
	}
	dbID := os.Getenv("FIRESTORE_DATABASE_ID")
	if parts := strings.Split(dbID, "-"); len(parts) >= 2 {
		return parts[len(parts)-1]
	}
	projectID := os.Getenv("GOOGLE_CLOUD_PROJECT")
	if parts := strings.Split(projectID, "-"); len(parts) >= 3 {
		return parts[2]
	}
	return "dev"
}

func HandleReconcile(c *gin.Context) {
	ctx := c.Request.Context()
	projectID := os.Getenv("GOOGLE_CLOUD_PROJECT")
	if projectID == "" {
		projectID = "tavern-swiper-dev"
	}
	env := resolveEnv()

	log.Printf("[INFO] Running cache reconciliation: Project: %s, Env: %s", projectID, env)

	bqClient, err := getBQClientFunc(ctx, projectID)
	if err != nil {
		log.Printf("[ERROR] Failed to create BigQuery client: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Failed to create BigQuery client"})
		return
	}
	defer bqClient.Close()

	// 1. Build Query (6-hour sliding window, 30-minute settling window)
	queryStr := fmt.Sprintf(`
		WITH latest_source AS (
			SELECT 
				document_id,
				data,
				operation,
				timestamp
			FROM %[1]s.discovery_analytics_%[2]s.matches_cdc
			WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 6 HOUR)
			QUALIFY ROW_NUMBER() OVER(PARTITION BY document_id ORDER BY timestamp DESC) = 1
		),
		latest_cache AS (
			SELECT 
				document_id,
				data,
				operation,
				timestamp
			FROM %[1]s.messages_analytics_%[2]s.matches_cdc
			WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 6 HOUR)
			QUALIFY ROW_NUMBER() OVER(PARTITION BY document_id ORDER BY timestamp DESC) = 1
		)
		SELECT 
			COALESCE(s.document_id, c.document_id) AS document_id,
			CASE
				WHEN s.document_id IS NULL OR s.operation = 'DELETE' THEN 'DELETE_CACHE'
				WHEN c.document_id IS NULL OR c.operation = 'DELETE' THEN 'UPSERT_CACHE'
				WHEN s.data != c.data THEN 'UPSERT_CACHE'
				ELSE 'IN_SYNC'
			END AS action,
			COALESCE(s.timestamp, c.timestamp) AS event_timestamp,
			s.data AS payload
		FROM latest_source s
		FULL OUTER JOIN latest_cache c ON s.document_id = c.document_id
		WHERE 
			(s.document_id IS NULL OR c.document_id IS NULL OR s.operation = 'DELETE' OR c.operation = 'DELETE' OR s.data != c.data)
			AND COALESCE(s.timestamp, c.timestamp) < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 MINUTE)
	`, projectID, env)

	q := bqClient.Query(queryStr)
	it, err := q.Read(ctx)
	if err != nil {
		log.Printf("[ERROR] Failed to execute BQ query: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Failed to query BigQuery"})
		return
	}

	dbClient, err := getDBFunc(ctx)
	if err != nil {
		log.Printf("[ERROR] Failed to get Firestore client: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Failed to initialize Firestore client"})
		return
	}

	collection := "discovery_matches_cache"
	updatesCount := 0
	deletesCount := 0
	skippedCount := 0

	for {
		var row ReconcileRow
		err := it.Next(&row)
		if errors.Is(err, iterator.Done) {
			break
		}
		if err != nil {
			log.Printf("[ERROR] Error reading query results: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"detail": "Error reading query results"})
			return
		}

		docRef := dbClient.Collection(collection).Doc(row.DocumentID)
		existing, err := docRef.Get(ctx)
		
		// If document exists, check timestamp to prevent overwriting newer updates
		if err == nil && existing.Exists() {
			if existingUpdatedAt, ok := existing.Data()["updated_at"].(time.Time); ok {
				if existingUpdatedAt.After(row.EventTimestamp) || existingUpdatedAt.Equal(row.EventTimestamp) {
					log.Printf("[INFO] Skipping document %s: cache updated_at (%s) >= BQ event timestamp (%s)", 
						row.DocumentID, existingUpdatedAt.Format(time.RFC3339), row.EventTimestamp.Format(time.RFC3339))
					skippedCount++
					continue
				}
			}
		}

		if row.Action == "DELETE_CACHE" {
			log.Printf("[INFO] Reconcile: Deleting stale cache doc %s", row.DocumentID)
			if _, err := docRef.Delete(ctx); err != nil {
				log.Printf("[ERROR] Failed to delete cache document %s: %v", row.DocumentID, err)
			} else {
				deletesCount++
			}
		} else if row.Action == "UPSERT_CACHE" {
			log.Printf("[INFO] Reconcile: Healing cache doc %s", row.DocumentID)
			var dataMap map[string]interface{}
			if err := json.Unmarshal([]byte(row.Payload), &dataMap); err != nil {
				log.Printf("[ERROR] Failed to parse BQ payload for document %s: %v", row.DocumentID, err)
				continue
			}
			dataMap["updated_at"] = row.EventTimestamp
			if _, err := docRef.Set(ctx, dataMap); err != nil {
				log.Printf("[ERROR] Failed to update cache document %s: %v", row.DocumentID, err)
			} else {
				updatesCount++
			}
		}
	}

	log.Printf("[INFO] Cache reconciliation completed. Upserts healed: %d, Deletes healed: %d, Skipped: %d", updatesCount, deletesCount, skippedCount)

	c.JSON(http.StatusOK, gin.H{
		"status":        "success",
		"upserts_healed": updatesCount,
		"deletes_healed": deletesCount,
		"skipped":       skippedCount,
	})
}

func HandleInitialLoad(c *gin.Context) {
	ctx := c.Request.Context()
	projectID := os.Getenv("GOOGLE_CLOUD_PROJECT")
	if projectID == "" {
		projectID = "tavern-swiper-dev"
	}
	env := resolveEnv()

	log.Printf("[INFO] Starting cache initial load: Project: %s, Env: %s", projectID, env)

	bqClient, err := getBQClientFunc(ctx, projectID)
	if err != nil {
		log.Printf("[ERROR] Failed to create BigQuery client: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Failed to create BigQuery client"})
		return
	}
	defer bqClient.Close()

	// 1. Build Query (Full scan for latest non-deleted document states)
	queryStr := fmt.Sprintf(`
		WITH latest_source AS (
			SELECT 
				document_id,
				data,
				operation,
				timestamp
			FROM %[1]s.discovery_analytics_%[2]s.matches_cdc
			QUALIFY ROW_NUMBER() OVER(PARTITION BY document_id ORDER BY timestamp DESC) = 1
		)
		SELECT 
			document_id,
			data AS payload,
			timestamp AS event_timestamp
		FROM latest_source
		WHERE operation != 'DELETE'
	`, projectID, env)

	q := bqClient.Query(queryStr)
	it, err := q.Read(ctx)
	if err != nil {
		log.Printf("[ERROR] Failed to execute BQ query: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Failed to query BigQuery"})
		return
	}

	dbClient, err := getDBFunc(ctx)
	if err != nil {
		log.Printf("[ERROR] Failed to get Firestore client: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Failed to initialize Firestore client"})
		return
	}

	collection := "discovery_matches_cache"

	// Fetch all rows
	var rows []InitialLoadRow
	for {
		var row InitialLoadRow
		err := it.Next(&row)
		if errors.Is(err, iterator.Done) {
			break
		}
		if err != nil {
			log.Printf("[ERROR] Error reading query results: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"detail": "Error reading query results"})
			return
		}
		rows = append(rows, row)
	}

	log.Printf("[INFO] Initial load: read %d active documents from BQ CDC logs. Processing...", len(rows))

	// Process rows concurrently using a worker pool
	var wg sync.WaitGroup
	jobs := make(chan InitialLoadRow, len(rows))
	var updatesCount int64
	var skippedCount int64
	var mu sync.Mutex

	workerCount := 20
	if len(rows) < workerCount {
		workerCount = len(rows)
	}

	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for row := range jobs {
				docRef := dbClient.Collection(collection).Doc(row.DocumentID)
				existing, err := docRef.Get(ctx)
				
				// Timestamp Check: Skip if Firestore already has a newer/equal record
				if err == nil && existing.Exists() {
					if existingUpdatedAt, ok := existing.Data()["updated_at"].(time.Time); ok {
						if existingUpdatedAt.After(row.EventTimestamp) || existingUpdatedAt.Equal(row.EventTimestamp) {
							mu.Lock()
							skippedCount++
							mu.Unlock()
							continue
						}
					}
				}

				var dataMap map[string]interface{}
				if err := json.Unmarshal([]byte(row.Payload), &dataMap); err != nil {
					log.Printf("[ERROR] Failed to parse BQ payload for document %s: %v", row.DocumentID, err)
					continue
				}
				dataMap["updated_at"] = row.EventTimestamp
				
				if _, err := docRef.Set(ctx, dataMap); err != nil {
					log.Printf("[ERROR] Failed to set cache document %s: %v", row.DocumentID, err)
				} else {
					log.Printf("[INFO] Initial load: Seeded cache doc %s", row.DocumentID)
					mu.Lock()
					updatesCount++
					mu.Unlock()
				}
			}
		}()
	}

	for _, r := range rows {
		jobs <- r
	}
	close(jobs)
	wg.Wait()

	log.Printf("[INFO] Initial load complete. Seeded %d documents, skipped %d.", updatesCount, skippedCount)

	c.JSON(http.StatusOK, gin.H{
		"status":       "success",
		"total_seeded": updatesCount,
		"skipped":      skippedCount,
	})
}
