package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"

	"cloud.google.com/go/storage"
	"google.golang.org/api/iterator"
)

var (
	storageClient *storage.Client
	bucketName    = os.Getenv("GCS_BUCKET_NAME")
)

func getStorageClient(ctx context.Context) (*storage.Client, error) {
	if storageClient != nil {
		return storageClient, nil
	}
	
	var err error
	storageClient, err = storage.NewClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create storage client: %v", err)
	}
	return storageClient, nil
}

var uploadToGCS = func(ctx context.Context, characterID string, filename string, contentType string, data io.Reader) (string, error) {
	return uploadToGCSInternal(ctx, characterID, filename, contentType, data)
}

func uploadToGCSInternal(ctx context.Context, characterID string, filename string, contentType string, data io.Reader) (string, error) {
	client, err := getStorageClient(ctx)
	if err != nil {
		return "", err
	}

	if bucketName == "" {
		return "", fmt.Errorf("GCS_BUCKET_NAME environment variable not set")
	}

	objectName := fmt.Sprintf("characters/%s/%s", characterID, filename)
	bh := client.Bucket(bucketName)
	obj := bh.Object(objectName)
	
	w := obj.NewWriter(ctx)
	w.ContentType = contentType
	w.Metadata = map[string]string{
		"character_id": characterID,
	}

	if _, err := io.Copy(w, data); err != nil {
		w.Close()
		return "", fmt.Errorf("failed to upload data to GCS: %v", err)
	}

	if err := w.Close(); err != nil {
		return "", fmt.Errorf("failed to close GCS writer: %v", err)
	}

	publicURL := fmt.Sprintf("https://storage.googleapis.com/%s/%s", bucketName, objectName)
	return publicURL, nil
}

var deleteCharacterImagesFunc = func(ctx context.Context, characterID string) error {
	return deleteCharacterImagesInternal(ctx, characterID)
}

func deleteCharacterImagesInternal(ctx context.Context, characterID string) error {
	client, err := getStorageClient(ctx)
	if err != nil {
		return fmt.Errorf("failed to get storage client: %v", err)
	}
	if bucketName == "" {
		return fmt.Errorf("GCS_BUCKET_NAME environment variable not set")
	}

	prefix := fmt.Sprintf("characters/%s/", characterID)
	it := client.Bucket(bucketName).Objects(ctx, &storage.Query{Prefix: prefix})
	for {
		attrs, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return fmt.Errorf("failed to list objects with prefix %s: %v", prefix, err)
		}
		if err := client.Bucket(bucketName).Object(attrs.Name).Delete(ctx); err != nil {
			log.Printf("[WARN] Failed to delete GCS object %s: %v", attrs.Name, err)
		}
	}
	return nil
}

var deleteSingleImageFunc = func(ctx context.Context, characterID string, filename string) error {
	return deleteSingleImageInternal(ctx, characterID, filename)
}

func deleteSingleImageInternal(ctx context.Context, characterID string, filename string) error {
	client, err := getStorageClient(ctx)
	if err != nil {
		return fmt.Errorf("failed to get storage client: %v", err)
	}
	if bucketName == "" {
		return fmt.Errorf("GCS_BUCKET_NAME environment variable not set")
	}

	objectName := fmt.Sprintf("characters/%s/%s", characterID, filename)
	if err := client.Bucket(bucketName).Object(objectName).Delete(ctx); err != nil {
		return fmt.Errorf("failed to delete GCS object %s: %v", objectName, err)
	}
	return nil
}
