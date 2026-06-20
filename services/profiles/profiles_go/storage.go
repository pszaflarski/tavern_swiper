package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	"cloud.google.com/go/storage"
	"github.com/google/uuid"
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

var deleteProfileImagesFunc = func(ctx context.Context, profileID string) error {
	return deleteProfileImagesInternal(ctx, profileID)
}

// deleteProfileImagesInternal deletes all GCS objects under profiles/{profileID}/.
// Returns nil if the profile has no images or the bucket is not configured.
func deleteProfileImagesInternal(ctx context.Context, profileID string) error {
	client, err := getStorageClient(ctx)
	if err != nil {
		return fmt.Errorf("failed to get storage client: %v", err)
	}
	if bucketName == "" {
		return fmt.Errorf("GCS_BUCKET_NAME environment variable not set")
	}

	prefix := fmt.Sprintf("profiles/%s/", profileID)
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

var copyExternalImages = func(ctx context.Context, profileID string, urls []string) ([]string, error) {
	return copyExternalImagesInternal(ctx, profileID, urls)
}

func copyExternalImagesInternal(ctx context.Context, profileID string, urls []string) ([]string, error) {
	if len(urls) == 0 {
		return urls, nil
	}

	if bucketName == "" {
		return nil, fmt.Errorf("GCS_BUCKET_NAME environment variable not set")
	}

	expectedPrefix := fmt.Sprintf("https://storage.googleapis.com/%s/profiles/%s/", bucketName, profileID)

	var newURLs []string
	for _, url := range urls {
		// If the URL already points to this profile's folder in the profiles bucket, keep it.
		if strings.HasPrefix(url, expectedPrefix) {
			newURLs = append(newURLs, url)
			continue
		}

		// Otherwise, it is external (e.g. from the characters bucket). We must copy it.
		log.Printf("[INFO] Copying external image to profile bucket: %s", url)

		req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
		if err != nil {
			return nil, fmt.Errorf("failed to create request for external image %s: %w", url, err)
		}

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("failed to fetch external image %s: %w", url, err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("failed to fetch external image %s, status code: %d", url, resp.StatusCode)
		}

		imgBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, fmt.Errorf("failed to read external image body %s: %w", url, err)
		}

		// Normalize image to ensure it meets dimensions and is a valid JPEG
		normalizedData, err := normalizeImageRitual(imgBytes, true)
		if err != nil {
			return nil, fmt.Errorf("failed to normalize copied image: %w", err)
		}

		filename := fmt.Sprintf("%s.jpg", uuid.New().String())

		// Upload the normalized content to GCS
		publicURL, err := uploadToGCS(ctx, profileID, filename, "image/jpeg", bytes.NewReader(normalizedData))
		if err != nil {
			return nil, fmt.Errorf("failed to upload copied image to GCS: %w", err)
		}

		log.Printf("[INFO] Successfully copied external image to: %s", publicURL)
		newURLs = append(newURLs, publicURL)
	}

	return newURLs, nil
}
