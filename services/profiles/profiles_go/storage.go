package main

import (
	"context"
	"fmt"
	"io"
	"os"

	"cloud.google.com/go/storage"
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
	// If in local dev without credentials file, you might use 
	// storage.NewClient(ctx, option.WithoutAuthentication()) for emulators
	storageClient, err = storage.NewClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create storage client: %v", err)
	}
	return storageClient, nil
}

var uploadToGCS = func(ctx context.Context, profileID string, filename string, contentType string, data io.Reader) (string, error) {
	return uploadToGCSInternal(ctx, profileID, filename, contentType, data)
}

func uploadToGCSInternal(ctx context.Context, profileID string, filename string, contentType string, data io.Reader) (string, error) {
	client, err := getStorageClient(ctx)
	if err != nil {
		return "", err
	}

	if bucketName == "" {
		return "", fmt.Errorf("GCS_BUCKET_NAME environment variable not set")
	}

	objectName := fmt.Sprintf("profiles/%s/%s", profileID, filename)
	bh := client.Bucket(bucketName)
	obj := bh.Object(objectName)
	
	// Ensure writer uses the context (with timeout)
	w := obj.NewWriter(ctx)
	w.ContentType = contentType
	// Optional: Metadata for easier debugging
	w.Metadata = map[string]string{
		"profile_id": profileID,
	}

	if _, err := io.Copy(w, data); err != nil {
		w.Close()
		return "", fmt.Errorf("failed to upload data to GCS: %v", err)
	}

	if err := w.Close(); err != nil {
		return "", fmt.Errorf("failed to close GCS writer: %v", err)
	}

	// Public read access is managed at the bucket level via IAM policy
	// (allUsers → roles/storage.objectViewer). Per-object ACL calls do not work
	// when Uniform Bucket-Level Access is enabled (the default for new buckets).

	// Sign URL or construct public URL (depending on bucket settings)
	// For this project, we usually use the public URL pattern if the bucket is public
	publicURL := fmt.Sprintf("https://storage.googleapis.com/%s/%s", bucketName, objectName)
	return publicURL, nil
}
