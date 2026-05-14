package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// handleBehaviorTrigger receives a generic trigger and dispatches
// to the appropriate behavior handler(s).
//
// @Summary      Trigger a bot behavior
// @Description  Allows triggering behaviors for bots based on events (e.g. profile_created)
// @Tags         behaviors
// @Accept       json
// @Produce      json
// @Param        payload body BehaviorTriggerRequest true "Trigger Details"
// @Success      200 {object} BehaviorTriggerResponse
// @Failure      400 {object} ErrorResponse
// @Failure      500 {object} ErrorResponse
// @Router       /bots/behaviors/trigger [post]
func handleBehaviorTrigger(c *gin.Context) {
	var req BehaviorTriggerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpError(c, http.StatusBadRequest, "Invalid request body")
		return
	}

	ctx := c.Request.Context()
	client, err := getDBFunc(ctx)
	if err != nil {
		log.Printf("[ERROR] handleBehaviorTrigger - getDBFunc: %v", err)
		httpError(c, http.StatusInternalServerError, "Failed to connect to database")
		return
	}

	// 1. Generate an Event ID (hash of trigger + context)
	// This helps with idempotency and tracking.
	hashInput, _ := json.Marshal(req)
	hash := sha256.Sum256(hashInput)
	eventID := hex.EncodeToString(hash[:])

	// 2. Record the event as "received"
	event := BotEvent{
		EventID:      eventID,
		BehaviorType: req.BehaviorType,
		Trigger:      req.Trigger,
		Context:      req.Context,
		Status:       "received",
		CreatedAt:    time.Now().UTC(),
	}

	docRef := client.Collection("bot_events").Doc(eventID)
	doc, err := docRef.Get(ctx)
	if err == nil && doc.Exists() {
		// Event already received/processed, skip to ensure idempotency
		log.Printf("[INFO] Event %s already exists, skipping", eventID)
		c.JSON(http.StatusOK, BehaviorTriggerResponse{Triggered: 0, Details: []string{"Already processed"}})
		return
	}

	_, err = docRef.Set(ctx, event)
	if err != nil {
		log.Printf("[ERROR] handleBehaviorTrigger - Failed to save event log: %v", err)
		httpError(c, http.StatusInternalServerError, "Failed to save event log")
		return
	}

	// 3. Query profiles that match this behavior type (if specified) or all active bot profiles.
	// For now, if no behavior type is specified, we would have to query all behaviors
	// but let's keep it simple: we query bot_profiles.
	// In the future, we could iterate over registered behaviors.

	var details []string
	triggeredCount := 0

	log.Printf("[INFO] Triggering %s", req.Trigger)

	// In Phase 3, we will query the bot_profiles collection:
	// iter := client.Collection("bot_profiles").Where("behavior_type", "!=", "").Documents(ctx)
	// ... iterate and map behaviors
	// For now, simulate finding a tavern keeper:

	if req.Trigger == "profile_created" {
		profileID, ok := req.Context["profile_id"].(string)
		if ok {
			// Simulating querying a profile with behavior_type = "tavern_keeper"
			msg := fmt.Sprintf("Would trigger tavern_keeper greeting for profile: %s", profileID)
			details = append(details, msg)
			triggeredCount++
			log.Printf("[INFO] %s", msg)
		}
	}

	// 4. Update the event as "processed"
	event.Status = "processed"
	_, _ = client.Collection("bot_events").Doc(eventID).Set(ctx, event)

	c.JSON(http.StatusOK, BehaviorTriggerResponse{
		Triggered: triggeredCount,
		Details:   details,
	})
}
