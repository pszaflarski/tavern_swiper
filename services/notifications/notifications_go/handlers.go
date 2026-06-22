package main

import (
	"context"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const COLLECTION_TOKENS = "notifications_tokens"

// handleHealth returns the service status
func handleHealth(c *gin.Context) {
	c.JSON(http.StatusOK, HealthResponse{
		Service: "Notifications Go Service",
		Status:  "ok",
	})
}

// handleRegisterToken registers or updates a device token
func handleRegisterToken(c *gin.Context) {
	auth := GetAuth(c)
	var body TokenRegister
	if err := c.ShouldBindJSON(&body); err != nil {
		send400(c, err.Error())
		return
	}

	token := strings.TrimSpace(body.Token)
	if token == "" {
		send400(c, "Token cannot be empty")
		return
	}

	ctx := c.Request.Context()
	client, err := getDBFunc(ctx)
	if err != nil {
		send500(c, "Database connection error")
		return
	}

	// Register/Update token doc (doc ID is token to avoid duplication)
	doc := DeviceTokenDoc{
		Token:     token,
		UserID:    auth.UID,
		DeviceID:  body.DeviceID,
		Platform:  body.Platform,
		UpdatedAt: time.Now(),
	}

	_, err = client.Collection(COLLECTION_TOKENS).Doc(token).Set(ctx, map[string]interface{}{
		"token":      doc.Token,
		"user_id":    doc.UserID,
		"device_id":  doc.DeviceID,
		"platform":   doc.Platform,
		"updated_at": doc.UpdatedAt,
	})
	if err != nil {
		log.Printf("[ERROR] Failed to save token: %v", err)
		send500(c, "Failed to save device token")
		return
	}

	// Enforce 5 tokens limit per user (cleanup oldest)
	go func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		iter := client.Collection(COLLECTION_TOKENS).Where("user_id", "==", auth.UID).Documents(cleanupCtx)
		snaps, err := iter.GetAll()
		if err != nil {
			log.Printf("[WARN] Failed to list user tokens for cleanup: %v", err)
			return
		}

		if len(snaps) > 5 {
			// Sort in memory by updated_at ascending (oldest first)
			sort.Slice(snaps, func(i, j int) bool {
				t1, _ := snaps[i].Data()["updated_at"].(time.Time)
				t2, _ := snaps[j].Data()["updated_at"].(time.Time)
				return t1.Before(t2)
			})

			// Delete oldest exceeding 5
			toDelete := len(snaps) - 5
			for i := 0; i < toDelete; i++ {
				_, delErr := snaps[i].Ref().Delete(cleanupCtx)
				if delErr != nil {
					log.Printf("[WARN] Failed to delete old token doc %s: %v", snaps[i].ID(), delErr)
				} else {
					log.Printf("[INFO] Cleaned up excess token %s for user %s", snaps[i].ID(), auth.UID)
				}
			}
		}
	}()

	c.JSON(http.StatusOK, gin.H{"status": "registered", "token": token})
}

// handleUnregisterToken deletes a registered token
func handleUnregisterToken(c *gin.Context) {
	auth := GetAuth(c)
	token := c.Param("token")
	if token == "" {
		send400(c, "Token parameter is required")
		return
	}

	ctx := c.Request.Context()
	client, err := getDBFunc(ctx)
	if err != nil {
		send500(c, "Database connection error")
		return
	}

	docRef := client.Collection(COLLECTION_TOKENS).Doc(token)
	snap, err := docRef.Get(ctx)
	if err != nil {
		send404(c, "Token not found")
		return
	}

	if !snap.Exists() {
		send404(c, "Token not found")
		return
	}

	docUID, _ := snap.Data()["user_id"].(string)
	if docUID != auth.UID && !IsAdmin(auth.Role) {
		send403(c, "Not authorized to delete this token")
		return
	}

	_, err = docRef.Delete(ctx)
	if err != nil {
		log.Printf("[ERROR] Failed to delete token: %v", err)
		send500(c, "Failed to delete token")
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "unregistered", "token": token})
}

