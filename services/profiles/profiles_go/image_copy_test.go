package main

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func makeDummyJPEG() []byte {
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	img.Set(0, 0, color.RGBA{255, 0, 0, 255})
	var buf bytes.Buffer
	_ = jpeg.Encode(&buf, img, nil)
	return buf.Bytes()
}

func TestCopyExternalImages(t *testing.T) {
	// Setup test context
	ctx := context.Background()

	// 1. Mock bucket name
	oldBucketName := bucketName
	bucketName = "test-bucket"
	defer func() { bucketName = oldBucketName }()

	// 2. Mock uploadToGCS
	oldUpload := uploadToGCS
	defer func() { uploadToGCS = oldUpload }()

	uploadedFiles := make(map[string][]byte)
	uploadToGCS = func(ctx context.Context, profileID string, filename string, contentType string, data io.Reader) (string, error) {
		buf := new(bytes.Buffer)
		_, _ = buf.ReadFrom(data)
		uploadedFiles[filename] = buf.Bytes()
		return "https://storage.googleapis.com/test-bucket/profiles/" + profileID + "/" + filename, nil
	}

	profileID := "test-profile-123"

	t.Run("Empty URLs", func(t *testing.T) {
		res, err := copyExternalImages(ctx, profileID, []string{})
		assert.NoError(t, err)
		assert.Empty(t, res)
	})

	t.Run("Already internal URLs are untouched", func(t *testing.T) {
		internalURL := "https://storage.googleapis.com/test-bucket/profiles/test-profile-123/some-existing-image.jpg"
		res, err := copyExternalImages(ctx, profileID, []string{internalURL})
		assert.NoError(t, err)
		assert.Len(t, res, 1)
		assert.Equal(t, internalURL, res[0])
		assert.Empty(t, uploadedFiles) // No upload happened
	})

	t.Run("External URLs are copied", func(t *testing.T) {
		// Clear uploaded map
		uploadedFiles = make(map[string][]byte)

		dummyImg := makeDummyJPEG()

		// Start a local test server to serve the dummy image
		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "image/jpeg")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(dummyImg)
		}))
		defer ts.Close()

		externalURL := ts.URL + "/character-portrait.jpg"

		res, err := copyExternalImages(ctx, profileID, []string{externalURL})
		assert.NoError(t, err)
		assert.Len(t, res, 1)

		expectedBase := "https://storage.googleapis.com/test-bucket/profiles/" + profileID + "/"
		assert.Contains(t, res[0], expectedBase)

		// Verify something got uploaded
		assert.Len(t, uploadedFiles, 1)
		for filename, bytesUploaded := range uploadedFiles {
			assert.Contains(t, filename, ".jpg")
			// The uploaded file should be normalized, so it shouldn't be empty
			assert.NotEmpty(t, bytesUploaded)
		}
	})
}
