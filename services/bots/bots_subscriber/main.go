package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"google.golang.org/protobuf/proto"

	pb "tavern-swiper.app/bots_subscriber/proto"
)

// PubSubPushRequest is the payload sent by Pub/Sub Push subscriptions.
type PubSubPushRequest struct {
	Message struct {
		Data []byte `json:"data"`
	} `json:"message"`
	Subscription string `json:"subscription"`
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

func main() {
	port := getEnv("PORT", "8080")

	// Discover service URLs from the router at boot
	initServiceURLs()

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

	log.Printf("📥 Received Pub/Sub message (%d bytes) from subscription: %s", len(pushMsg.Message.Data), pushMsg.Subscription)

	if err := processSerializedEvent(pushMsg.Message.Data, pushMsg.Subscription); err != nil {
		log.Printf("❌ Failed to process event: %v", err)
		// Return 500 so Pub/Sub retries
		c.Status(http.StatusInternalServerError)
		return
	}

	c.Status(http.StatusOK)
}

func processSerializedEvent(data []byte, subscription string) error {
	// Use the subscription name to determine the event type.
	if strings.Contains(subscription, "agent-response") || strings.Contains(subscription, "agent_response") {
		var respEvent pb.AgentResponseEvent
		if err := proto.Unmarshal(data, &respEvent); err != nil {
			log.Printf("❌ Failed to unmarshal AgentResponseEvent: %v", err)
			return nil // Don't retry on bad data
		}
		return processAgentResponseEvent(&respEvent)
	}

	if strings.Contains(subscription, "message") {
		var msgEvent pb.MessageEvent
		if err := proto.Unmarshal(data, &msgEvent); err != nil {
			log.Printf("❌ Failed to unmarshal MessageEvent: %v", err)
			return nil // Don't retry on bad data
		}
		return processMessageEvent(&msgEvent)
	}

	// Default: treat as ProfileEvent (existing behavior)
	var profileEvent pb.ProfileEvent
	if err := proto.Unmarshal(data, &profileEvent); err != nil {
		log.Printf("❌ Failed to unmarshal ProfileEvent: %v", err)
		return nil
	}
	return processProfileEvent(&profileEvent)
}

func processAgentResponseEvent(event *pb.AgentResponseEvent) error {
	log.Printf("📥 Processing AgentResponseEvent request_id: %s, status: %s", event.RequestId, event.Status)

	status := strings.ToLower(event.Status)
	if status == "" {
		status = "success"
	}

	cbMeta := map[string]interface{}{
		"conversation_id":   event.ConversationId,
		"bot_profile_id":    event.BotProfileId,
		"bot_user_id":       event.BotUserId,
		"sender_profile_id": event.SenderProfileId,
		"behavior_type":     event.BehaviorType,
		"agent_name":        event.AgentName,
	}

	if event.MetadataJson != "" {
		var meta map[string]interface{}
		if err := json.Unmarshal([]byte(event.MetadataJson), &meta); err == nil {
			for k, v := range meta {
				if _, exists := cbMeta[k]; !exists {
					cbMeta[k] = v
				}
			}
		}
	}

	reqPayload := map[string]interface{}{
		"request_id":        event.RequestId,
		"status":            status,
		"response":          event.ResponseJson,
		"error":             event.ErrorMessage,
		"detail":            event.ErrorMessage,
		"thread_id":         event.ConversationId,
		"agent":             event.AgentName,
		"callback_metadata": cbMeta,
	}

	return callBotsCallbackService(reqPayload)
}

func callBotsCallbackService(payload map[string]interface{}) error {
	baseURL := serviceURLs.Get("bots")
	if baseURL == "" {
		log.Printf("⚠️ Bots service URL not resolved from router, skipping relay")
		return nil
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal callback payload: %w", err)
	}

	req, err := http.NewRequest("POST", baseURL+"/bots/agent-callback", bytes.NewBuffer(body))
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
		return fmt.Errorf("failed to call bots agent-callback service: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("bots service returned HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	log.Printf("✅ Successfully relayed agent response (request_id=%v) to bots service", payload["request_id"])
	return nil
}

type BehaviorTriggerRequest struct {
	BehaviorType string                 `json:"behavior_type,omitempty"`
	Trigger      string                 `json:"trigger"`
	Context      map[string]interface{} `json:"context"`
}

func processProfileEvent(event *pb.ProfileEvent) error {
	log.Printf("📥 Processing ProfileEvent type: %s", event.Type)

	var trigger string
	eventCtx := make(map[string]interface{})

	switch event.Type {
	case pb.ProfileEvent_UPSERTED:
		p := event.GetUpserted()
		trigger = "profile_created" // using profile_created for upserts currently
		eventCtx["profile_id"] = p.ProfileId
		eventCtx["user_id"] = p.UserId
		eventCtx["display_name"] = p.DisplayName
		log.Printf("✨ [UPSERTED] ProfileID: %s", p.ProfileId)

	case pb.ProfileEvent_DELETED:
		p := event.GetDeleted()
		trigger = "profile_deleted"
		eventCtx["profile_id"] = p.ProfileId
		log.Printf("🗑️ [DELETED] ProfileID: %s", p.ProfileId)

	case pb.ProfileEvent_ALL_DELETED:
		a := event.GetAllDeleted()
		trigger = "all_profiles_deleted"
		eventCtx["admin_user_id"] = a.AdminUserId
		log.Printf("🚨 [ALL_DELETED] AdminUserID: %s", a.AdminUserId)

	default:
		log.Printf("❓ Unknown profile event type: %s", event.Type)
		return nil
	}

	reqPayload := BehaviorTriggerRequest{
		Trigger: trigger,
		Context: eventCtx,
	}

	return callBotsService(reqPayload)
}

func processMessageEvent(event *pb.MessageEvent) error {
	log.Printf("📥 Processing MessageEvent type: %s", event.Type)

	switch event.Type {
	case pb.MessageEvent_SENT:
		sent := event.GetSent()
		if sent == nil {
			log.Printf("⚠️ MessageEvent SENT but no payload, skipping")
			return nil
		}

		// Skip truly anonymous system broadcasts (no sender, no metadata).
		// Event messages like dice rolls have sender_profile_id empty but
		// carry metadata with initiated_by, so they must pass through.
		if sent.SenderProfileId == "" && sent.MessageType != "user" && sent.MetadataJson == "" {
			log.Printf("ℹ️ Ignoring sender-less %s message in conversation %s (no metadata)", sent.MessageType, sent.ConversationId)
			return nil
		}

		log.Printf("💬 [MESSAGE_SENT] ConversationID: %s, Sender: %s, Type: %s", sent.ConversationId, sent.SenderProfileId, sent.MessageType)

		eventCtx := map[string]interface{}{
			"conversation_id":   sent.ConversationId,
			"sender_profile_id": sent.SenderProfileId,
			"message_preview":   sent.MessagePreview,
			"message_id":        sent.MessageId,
			"message_type":      sent.MessageType,
		}

		if sent.MetadataJson != "" {
			var meta map[string]interface{}
			if err := json.Unmarshal([]byte(sent.MetadataJson), &meta); err == nil {
				eventCtx["metadata"] = meta
			} else {
				log.Printf("⚠️ Failed to parse metadata JSON: %v", err)
			}
		}

		return callBotsService(BehaviorTriggerRequest{
			Trigger: "message_received",
			Context: eventCtx,
		})

	default:
		log.Printf("❓ Unknown message event type: %s", event.Type)
		return nil
	}
}

func callBotsService(payload BehaviorTriggerRequest) error {
	baseURL := serviceURLs.Get("bots")
	if baseURL == "" {
		log.Printf("⚠️ Bots service URL not resolved from router, skipping relay")
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
