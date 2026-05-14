package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"google.golang.org/protobuf/proto"

	pb "tavern-swiper.app/bots_subscriber/proto"
)

// PubSubPushRequest is the payload sent by Pub/Sub Push subscriptions.
type PubSubPushRequest struct {
	Message struct {
		Data []byte `json:"data"`
	} `json:"message"`
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

func main() {
	port := getEnv("PORT", "8080")
	r := gin.Default()

	// Health check
	r.GET("/", func(c *gin.Context) {
		c.String(http.StatusOK, "Bots Subscriber is running")
	})

	// Pub/Sub Push endpoint
	r.POST("/", handlePubSubPush)

	log.Printf("🚀 Bots Subscriber listening on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("❌ Failed to start server: %v", err)
	}
}

func handlePubSubPush(c *gin.Context) {
	var pushMsg PubSubPushRequest
	if err := c.ShouldBindJSON(&pushMsg); err != nil {
		// Log but return 200 to Pub/Sub to avoid retries for malformed JSON
		log.Printf("⚠️ Failed to parse Pub/Sub push request: %v", err)
		c.Status(http.StatusOK)
		return
	}

	if len(pushMsg.Message.Data) == 0 {
		log.Printf("🤔 Received empty data in Pub/Sub message")
		c.Status(http.StatusOK)
		return
	}

	log.Printf("📥 Received Pub/Sub message (%d bytes)", len(pushMsg.Message.Data))

	if err := processSerializedEvent(pushMsg.Message.Data); err != nil {
		log.Printf("❌ Failed to process event: %v", err)
		// Return 500 so Pub/Sub retries
		c.Status(http.StatusInternalServerError)
		return
	}

	c.Status(http.StatusOK)
}

func processSerializedEvent(data []byte) error {
	var event pb.ProfileEvent
	if err := proto.Unmarshal(data, &event); err != nil {
		log.Printf("❌ proto.Unmarshal Error: %v", err)
		return nil // Don't retry on bad data
	}

	return processEvent(&event)
}

type BehaviorTriggerRequest struct {
	BehaviorType string                 `json:"behavior_type,omitempty"`
	Trigger      string                 `json:"trigger"`
	Context      map[string]interface{} `json:"context"`
}

func processEvent(event *pb.ProfileEvent) error {
	log.Printf("📥 Processing ProfileEvent type: %s", event.Type)

	var trigger string
	context := make(map[string]interface{})

	switch event.Type {
	case pb.ProfileEvent_UPSERTED:
		p := event.GetUpserted()
		trigger = "profile_created" // using profile_created for upserts currently
		context["profile_id"] = p.ProfileId
		context["user_id"] = p.UserId
		context["display_name"] = p.DisplayName
		log.Printf("✨ [UPSERTED] ProfileID: %s", p.ProfileId)

	case pb.ProfileEvent_DELETED:
		p := event.GetDeleted()
		trigger = "profile_deleted"
		context["profile_id"] = p.ProfileId
		log.Printf("🗑️ [DELETED] ProfileID: %s", p.ProfileId)

	case pb.ProfileEvent_ALL_DELETED:
		a := event.GetAllDeleted()
		trigger = "all_profiles_deleted"
		context["admin_user_id"] = a.AdminUserId
		log.Printf("🚨 [ALL_DELETED] AdminUserID: %s", a.AdminUserId)

	default:
		log.Printf("❓ Unknown event type: %s", event.Type)
		return nil
	}

	reqPayload := BehaviorTriggerRequest{
		Trigger: trigger,
		Context: context,
	}

	return callBotsService(reqPayload)
}

func callBotsService(payload BehaviorTriggerRequest) error {
	baseURL := os.Getenv("BOTS_SERVICE_URL")
	if baseURL == "" {
		// In test environments, this might be empty and we just log
		log.Printf("⚠️ BOTS_SERVICE_URL not set, skipping relay")
		return nil
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	req, err := http.NewRequest("POST", baseURL+"/bots/behaviors/trigger", bytes.NewBuffer(body))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	token, err := generateInternalJWT()
	if err == nil {
		req.Header.Set("Authorization", "Bearer "+token)
	} else {
		log.Printf("⚠️ Failed to generate internal JWT: %v", err)
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to call bots service: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("bots service returned HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	log.Printf("✅ Successfully relayed trigger '%s' to bots service", payload.Trigger)
	return nil
}
