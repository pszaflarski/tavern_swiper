package main

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"

	"github.com/disintegration/imaging"
)

var jpegMagic = []byte{0xFF, 0xD8, 0xFF}

func isJPEG(data []byte) bool {
	if len(data) < len(jpegMagic) {
		return false
	}
	return bytes.Equal(data[:len(jpegMagic)], jpegMagic)
}

func normalizeImageRitual(data []byte, isAdmin bool) ([]byte, error) {
	// Magic Byte Check
	if !isAdmin && !isJPEG(data) {
		return nil, fmt.Errorf("Forbidden Essence: This vision does not match the required sacred JPEG signature (FF D8 FF).")
	}

	// Decode Image
	img, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("Failed to decode image: %v (Format: %s)", err, format)
	}

	// Perfect Geometry: 1080x1350 (4:5 ratio)
	width := 1080
	height := 1350
	
	bounds := img.Bounds()
	if !isAdmin && (bounds.Dx() != width || bounds.Dy() != height) {
		return nil, fmt.Errorf("Imperfect Geometry: Your vision (%dx%d) does not match the sacred 1080x1350 standard. Admin intervention or client-side refining is required.", bounds.Dx(), bounds.Dy())
	}

	// Center-crop and resize to the exact dimensions
	normalized := imaging.Fill(img, width, height, imaging.Center, imaging.Lanczos)

	// Encode back to JPEG
	var buf bytes.Buffer
	err = jpeg.Encode(&buf, normalized, &jpeg.Options{Quality: 90})
	if err != nil {
		return nil, fmt.Errorf("Failed to encode normalized image: %v", err)
	}

	return buf.Bytes(), nil
}
