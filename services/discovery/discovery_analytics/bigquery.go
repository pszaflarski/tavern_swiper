package main

import (
	"context"
	"fmt"
	"log"
	"net/http"

	"cloud.google.com/go/bigquery"
	"google.golang.org/api/googleapi"
)

// BQClient defines the interface for our BigQuery operations to allow easy mocking.
type BQClient interface {
	EnsureDatasetAndTables(ctx context.Context) error
	InsertRow(ctx context.Context, row *ChangelogRow) error
	Close() error
}

type RealBQClient struct {
	client    *bigquery.Client
	projectID string
	env       string
	datasetID string
}

func NewRealBQClient(ctx context.Context, projectID, env string) (*RealBQClient, error) {
	client, err := bigquery.NewClient(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("failed to create bigquery client: %w", err)
	}

	datasetID := fmt.Sprintf("discovery_analytics_%s", env)
	return &RealBQClient{
		client:    client,
		projectID: projectID,
		env:       env,
		datasetID: datasetID,
	}, nil
}

func (b *RealBQClient) EnsureDatasetAndTables(ctx context.Context) error {
	dataset := b.client.Dataset(b.datasetID)

	// Determine location
	location := "us-central1"
	if b.env == "prod" {
		location = "US"
	}

	// 1. Ensure Dataset exists
	_, err := dataset.Metadata(ctx)
	if err != nil {
		if hasErrorCode(err, http.StatusNotFound) {
			log.Printf("🏗️ Creating BigQuery dataset: %s in location: %s", b.datasetID, location)
			err = dataset.Create(ctx, &bigquery.DatasetMetadata{
				Location:    location,
				Description: "CDC Analytics dataset for Discovery boundary",
			})
			if err != nil {
				return fmt.Errorf("failed to create dataset %s: %w", b.datasetID, err)
			}
			log.Printf("✅ Created BigQuery dataset: %s", b.datasetID)
		} else {
			return fmt.Errorf("failed to check dataset %s metadata: %w", b.datasetID, err)
		}
	}

	// 2. Ensure matches_cdc Table exists
	tableName := "matches_cdc"
	table := dataset.Table(tableName)
	_, err = table.Metadata(ctx)
	if err != nil {
		if hasErrorCode(err, http.StatusNotFound) {
			log.Printf("🏗️ Creating BigQuery table: %s.%s", b.datasetID, tableName)
			schema, err := bigquery.InferSchema(ChangelogRow{})
			if err != nil {
				return fmt.Errorf("failed to infer schema for %s: %w", tableName, err)
			}

			// Day-partition on timestamp field and cluster by document_id
			err = table.Create(ctx, &bigquery.TableMetadata{
				Schema:      schema,
				Description: "CDC raw changelog for collection matches",
				TimePartitioning: &bigquery.TimePartitioning{
					Field: "timestamp",
					Type:  bigquery.DayPartitioningType,
				},
				Clustering: &bigquery.Clustering{
					Fields: []string{"document_id"},
				},
			})
			if err != nil {
				return fmt.Errorf("failed to create table %s: %w", tableName, err)
			}
			log.Printf("✅ Created BigQuery table: %s.%s", b.datasetID, tableName)
		} else {
			return fmt.Errorf("failed to check table %s metadata: %w", tableName, err)
		}
	}

	return nil
}

func (b *RealBQClient) InsertRow(ctx context.Context, row *ChangelogRow) error {
	table := b.client.Dataset(b.datasetID).Table("matches_cdc")
	inserter := table.Inserter()
	
	err := inserter.Put(ctx, row)
	if err != nil {
		if pmErr, ok := err.(bigquery.PutMultiError); ok {
			for _, rowErr := range pmErr {
				log.Printf("❌ Row insertion error: %v", rowErr.Error())
			}
			return fmt.Errorf("bigquery PutMultiError: %w", pmErr)
		}
		return fmt.Errorf("bigquery Put error: %w", err)
	}

	return nil
}

func (b *RealBQClient) Close() error {
	if b.client != nil {
		return b.client.Close()
	}
	return nil
}

// hasErrorCode checks if an error has a specific HTTP response status code.
func hasErrorCode(err error, code int) bool {
	if err == nil {
		return false
	}
	if e, ok := err.(*googleapi.Error); ok && e.Code == code {
		return true
	}
	return false
}
