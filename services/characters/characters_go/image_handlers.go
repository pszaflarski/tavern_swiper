package main

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const IMAGES_COLLECTION = "images"

// handleUploadImage godoc
// @Summary      Upload a character image (Admin only)
// @Tags         images
// @Accept       multipart/form-data
// @Produce      json
// @Param        character_id   formData  string  true   "Character ID"
// @Param        source_type    formData  string  true   "Source Type (artist | ai_generated)"
// @Param        artist_handle  formData  string  false  "Artist Handle"
// @Param        artist_name    formData  string  false  "Artist Name"
// @Param        artist_link    formData  string  false  "Artist Link"
// @Param        position       formData  int     false  "Position (default 0)"
// @Param        file           formData  file    true   "Image file"
// @Success      201  {object}  ImageOut
// @Security     BearerAuth
// @Router       /images/ [post]
func handleUploadImage(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdmin(auth.Role) {
		send403(c, "Admin or Root Admin authorization required")
		return
	}

	characterID := c.PostForm("character_id")
	sourceType := c.PostForm("source_type")
	if characterID == "" || sourceType == "" {
		send400(c, "character_id and source_type are required")
		return
	}
	if sourceType != "artist" && sourceType != "ai_generated" {
		send400(c, "source_type must be either 'artist' or 'ai_generated'")
		return
	}

	artistHandle := c.PostForm("artist_handle")
	artistName := c.PostForm("artist_name")
	artistLink := c.PostForm("artist_link")
	positionStr := c.PostForm("position")
	position := 0
	if positionStr != "" {
		if p, err := strconv.Atoi(positionStr); err == nil {
			position = p
		}
	}

	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	// Verify character exists
	charRef := client.Collection(CHARACTERS_COLLECTION).Doc(characterID)
	charDoc, err := charRef.Get(c.Request.Context())
	if err != nil || !charDoc.Exists() {
		send404(c, "Character not found")
		return
	}

	file, err := c.FormFile("file")
	if err != nil {
		send400(c, "No file uploaded")
		return
	}
	if file.Size > 10*1024*1024 {
		send400(c, "Image file exceeds 10MB limit")
		return
	}

	src, err := file.Open()
	if err != nil {
		send500(c, "Failed to open uploaded file")
		return
	}
	defer src.Close()

	data, err := io.ReadAll(src)
	if err != nil {
		send500(c, "Failed to read uploaded file")
		return
	}

	// Normalize Image
	normalizedData, err := normalizeImageRitual(data, true)
	if err != nil {
		send400(c, err.Error())
		return
	}

	imageID := uuid.New().String()
	filename := fmt.Sprintf("%s.jpg", imageID)

	// Upload to GCS
	publicURL, err := uploadToGCS(c.Request.Context(), characterID, filename, "image/jpeg", bytes.NewReader(normalizedData))
	if err != nil {
		send500(c, fmt.Sprintf("Failed to upload image to storage: %v", err))
		return
	}

	// Save to images collection
	imgData := map[string]interface{}{
		"url":          publicURL,
		"source_type":  sourceType,
		"character_id": characterID,
		"position":     position,
		"created_at":   firestore.ServerTimestamp,
		"updated_at":   firestore.ServerTimestamp,
	}
	if artistHandle != "" {
		imgData["artist_handle"] = artistHandle
	}
	if artistName != "" {
		imgData["artist_name"] = artistName
	}
	if artistLink != "" {
		imgData["artist_link"] = artistLink
	}

	imgRef := client.Collection(IMAGES_COLLECTION).Doc(imageID)
	if _, err := imgRef.Set(c.Request.Context(), imgData); err != nil {
		send500(c, "Failed to save image metadata")
		return
	}

	// Update character's image_ids array
	_, err = charRef.Update(c.Request.Context(), []firestore.Update{
		{Path: "image_ids", Value: firestore.ArrayUnion(imageID)},
		{Path: "updated_at", Value: firestore.ServerTimestamp},
	})
	if err != nil {
		log.Printf("[WARN] Failed to update character image_ids: %v", err)
	}

	doc, err := imgRef.Get(c.Request.Context())
	if err != nil {
		send500(c, "Failed to refetch created image")
		return
	}
	imgOut, err := docToImage(doc)
	if err != nil {
		send500(c, err.Error())
		return
	}

	c.JSON(http.StatusCreated, imgOut)
}

// handleUpdateImage godoc
// @Summary      Update image metadata (Admin only)
// @Tags         images
// @Accept       json
// @Produce      json
// @Param        id    path      string       true  "Image ID"
// @Param        body  body      ImageUpdate  true  "Fields to update"
// @Success      200   {object}  ImageOut
// @Security     BearerAuth
// @Router       /images/{id} [put]
func handleUpdateImage(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdmin(auth.Role) {
		send403(c, "Admin or Root Admin authorization required")
		return
	}

	id := c.Param("id")
	var body ImageUpdate
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": err.Error()})
		return
	}

	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	ref := client.Collection(IMAGES_COLLECTION).Doc(id)
	doc, err := ref.Get(c.Request.Context())
	if err != nil || !doc.Exists() {
		send404(c, "Image not found")
		return
	}

	updates := []firestore.Update{
		{Path: "updated_at", Value: firestore.ServerTimestamp},
	}
	if body.SourceType != nil {
		if *body.SourceType != "artist" && *body.SourceType != "ai_generated" {
			send400(c, "source_type must be either 'artist' or 'ai_generated'")
			return
		}
		updates = append(updates, firestore.Update{Path: "source_type", Value: *body.SourceType})
	}
	if body.ArtistHandle != nil {
		updates = append(updates, firestore.Update{Path: "artist_handle", Value: *body.ArtistHandle})
	}
	if body.ArtistName != nil {
		updates = append(updates, firestore.Update{Path: "artist_name", Value: *body.ArtistName})
	}
	if body.ArtistLink != nil {
		updates = append(updates, firestore.Update{Path: "artist_link", Value: *body.ArtistLink})
	}
	if body.Position != nil {
		updates = append(updates, firestore.Update{Path: "position", Value: *body.Position})
	}

	if len(updates) > 1 {
		if _, err := ref.Update(c.Request.Context(), updates); err != nil {
			send500(c, "Failed to update image metadata")
			return
		}
	}

	newDoc, err := ref.Get(c.Request.Context())
	if err != nil {
		send500(c, "Failed to refetch image")
		return
	}
	imgOut, err := docToImage(newDoc)
	if err != nil {
		send500(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, imgOut)
}

// handleDeleteImage godoc
// @Summary      Delete an image (Admin only)
// @Tags         images
// @Param        id  path  string  true  "Image ID"
// @Success      204  "No Content"
// @Security     BearerAuth
// @Router       /images/{id} [delete]
func handleDeleteImage(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdmin(auth.Role) {
		send403(c, "Admin or Root Admin authorization required")
		return
	}

	id := c.Param("id")
	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	ref := client.Collection(IMAGES_COLLECTION).Doc(id)
	doc, err := ref.Get(c.Request.Context())
	if err != nil || !doc.Exists() {
		send404(c, "Image not found")
		return
	}

	imgData := doc.Data()
	characterID, _ := imgData["character_id"].(string)

	// Delete from GCS
	filename := fmt.Sprintf("%s.jpg", id)
	if characterID != "" {
		if err := deleteSingleImageFunc(c.Request.Context(), characterID, filename); err != nil {
			log.Printf("[WARN] Failed to delete GCS image %s: %v", filename, err)
		}
	}

	// Delete from Firestore
	if _, err := ref.Delete(c.Request.Context()); err != nil {
		send500(c, "Failed to delete image metadata")
		return
	}

	// Remove from character's image_ids array
	if characterID != "" {
		charRef := client.Collection(CHARACTERS_COLLECTION).Doc(characterID)
		_, err = charRef.Update(c.Request.Context(), []firestore.Update{
			{Path: "image_ids", Value: firestore.ArrayRemove(id)},
			{Path: "updated_at", Value: firestore.ServerTimestamp},
		})
		if err != nil {
			log.Printf("[WARN] Failed to remove image ID %s from character %s: %v", id, characterID, err)
		}
	}

	c.Status(http.StatusNoContent)
}

// handleListImagesByArtist godoc
// @Summary      Get all images by artist handle
// @Tags         images
// @Param        handle  path  string  true  "Artist Handle"
// @Success      200  {array}  ImageOut
// @Router       /images/by-artist/{handle} [get]
func handleListImagesByArtist(c *gin.Context) {
	handle := c.Param("handle")
	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		send503(c, "Database connection error")
		return
	}

	docs, err := client.Collection(IMAGES_COLLECTION).Where("artist_handle", "==", handle).Documents(c.Request.Context()).GetAll()
	if err != nil {
		send500(c, "Failed to list images")
		return
	}

	results := make([]ImageOut, 0)
	for _, doc := range docs {
		img, err := docToImage(doc)
		if err == nil {
			results = append(results, img)
		}
	}
	c.JSON(http.StatusOK, results)
}

// Helper: docToImage
func docToImage(doc DocumentSnapshot) (ImageOut, error) {
	d := doc.Data()
	if d == nil {
		return ImageOut{}, fmt.Errorf("Image document %s empty", doc.ID())
	}

	getStr := func(key string) *string {
		if val, ok := d[key].(string); ok {
			return &val
		}
		return nil
	}

	reqStr := func(key string) string {
		if val, ok := d[key].(string); ok {
			return val
		}
		return ""
	}

	reqInt := func(key string) int {
		if val, ok := d[key].(int); ok {
			return val
		}
		if val, ok := d[key].(int64); ok {
			return int(val)
		}
		return 0
	}

	getTimestamp := func(key string) *time.Time {
		if val, ok := d[key].(time.Time); ok {
			return &val
		}
		return nil
	}

	return ImageOut{
		ImageID:      doc.ID(),
		URL:          reqStr("url"),
		SourceType:   reqStr("source_type"),
		CharacterID:  reqStr("character_id"),
		ArtistHandle: getStr("artist_handle"),
		ArtistName:   getStr("artist_name"),
		ArtistLink:   getStr("artist_link"),
		Position:     reqInt("position"),
		CreatedAt:    getTimestamp("created_at"),
		UpdatedAt:    getTimestamp("updated_at"),
	}, nil
}
