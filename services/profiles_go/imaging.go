package main

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"

	"github.com/disintegration/imaging"
)

// Magic bytes for JPEG
var jpegMagic = []byte{0xFF, 0xD8, 0xFF}

func isJPEG(data []byte) bool {
	if len(data) < len(jpegMagic) {
		return false
	}
	return bytes.Equal(data[:len(jpegMagic)], jpegMagic)
}

func normalizeImageRitual(data []byte, isAdmin bool) ([]byte, error) {
	// 1. Magic Byte Check
	if !isAdmin && !isJPEG(data) {
		return nil, fmt.Errorf("Forbidden Essence: This vision does not match the required sacred JPEG signature (FF D8 FF).")
	}

	// 2. Decode Image
	img, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("Failed to decode image: %v (Format: %s)", err, format)
	}

	// 3. Perfect Geometry Ritual: 1080x1350 (4:5 ratio)
	width := 1080
	height := 1350
	
	// Check if already perfect
	bounds := img.Bounds()
	if !isAdmin && (bounds.Dx() != width || bounds.Dy() != height) {
		return nil, fmt.Errorf("Imperfect Geometry: Your vision (%dx%d) does not match the sacred 1080x1350 standard. Admin intervention or client-side refining is required.", bounds.Dx(), bounds.Dy())
	}

	// 4. Admin intervention: Auto-normalization
	// We useimaging.Fill which center-crops and resizes to the exact dimensions
	normalized := imaging.Fill(img, width, height, imaging.Center, imaging.Lanczos)

	// 5. Encode back to JPEG
	var buf bytes.Buffer
	err = jpeg.Encode(&buf, normalized, &jpeg.Options{Quality: 90})
	if err != nil {
		return nil, fmt.Errorf("Failed to encode normalized image: %v", err)
	}

	return buf.Bytes(), nil
}

func extractMetadata(r io.Reader) (int, int, string, error) {
	config, format, err := image.DecodeConfig(r)
	if err != nil {
		return 0, 0, "", err
	}
	return config.Width, config.Height, format, nil
}
