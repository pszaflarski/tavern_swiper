package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"google.golang.org/api/iterator"
	"google.golang.org/protobuf/proto"

	pb "tavern-swiper.app/notifications_subscriber/proto"
)

const COLLECTION_TOKENS = "notifications_tokens"

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

func main() {
	port := getEnv("PORT", "8015")

	// Discover service URLs from the router at boot
	initServiceURLs()

	r := gin.Default()

	// Health check
	r.GET("/", func(c *gin.Context) {
		c.String(http.StatusOK, "Notifications Subscriber is running")
	})

	// Pub/Sub Push endpoint
	r.POST("/", handlePubSubPush)

	log.Printf("🚀 Notifications Subscriber listening on port %s", port)
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
	// Match events come from match subscriptions, message events from message subscriptions.
	if strings.Contains(subscription, "message") {
		var msgEvent pb.MessageEvent
		if err := proto.Unmarshal(data, &msgEvent); err != nil {
			log.Printf("❌ Failed to unmarshal MessageEvent: %v", err)
			return nil // Don't retry on bad data
		}
		return processMessageEvent(&msgEvent)
	}

	// Default: treat as MatchEvent
	if strings.Contains(subscription, "match") {
		var matchEvent pb.MatchEvent
		if err := proto.Unmarshal(data, &matchEvent); err != nil {
			log.Printf("❌ Failed to unmarshal MatchEvent: %v", err)
			return nil // Don't retry on bad data
		}
		return processMatchEvent(&matchEvent)
	}

	log.Printf("⚠️ Unknown subscription pattern: %s, ignoring", subscription)
	return nil
}

func processMatchEvent(event *pb.MatchEvent) error {
	log.Printf("📥 Processing MatchEvent type: %s", event.Type)

	if event.Type != pb.MatchEvent_CREATED || event.GetCreated() == nil {
		// Only notify on match creation
		log.Printf("ℹ️ Ignoring non-CREATED match event type: %s", event.Type)
		return nil
	}

	match := event.GetCreated()
	pids := match.ProfileIds
	if len(pids) < 2 {
		log.Printf("⚠️ Match %s has fewer than 2 profile IDs, skipping", match.MatchId)
		return nil
	}

	ctx := context.Background()
	client, err := getDBFunc(ctx)
	if err != nil {
		return fmt.Errorf("database connection error: %w", err)
	}

	// Generate system JWT for service-to-service calls
	systemToken, err := generateInternalJWT()
	if err != nil {
		log.Printf("[ERROR] Failed to sign system token: %v", err)
		return nil
	}

	// Fetch profile details for both matched profiles
	profiles, err := fetchProfilesBatch(pids, systemToken)
	if err != nil {
		log.Printf("[ERROR] Failed to fetch profiles batch: %v", err)
		return nil
	}

	if len(profiles) < 2 {
		log.Printf("[WARN] Batch profile fetch returned fewer than 2 profiles for match %s", match.MatchId)
		return nil
	}

	profileMap := make(map[string]ProfileInfo)
	for _, p := range profiles {
		profileMap[p.ProfileID] = p
	}

	// Send notifications to both matched users
	for _, pid := range pids {
		prof, exists := profileMap[pid]
		if !exists || prof.UserID == "" {
			continue
		}

		// Find the other participant's display name
		otherName := "Someone"
		for _, otherPid := range pids {
			if otherPid != pid {
				if otherProf, found := profileMap[otherPid]; found {
					otherName = otherProf.DisplayName
				}
				break
			}
		}

		tokens, queryErr := getUserDeviceTokens(ctx, client, prof.UserID)
		if queryErr != nil {
			log.Printf("[WARN] Failed to query tokens for user %s: %v", prof.UserID, queryErr)
			continue
		}

		if len(tokens) > 0 {
			title := "It's a Match! 🍻"
			body := fmt.Sprintf("You matched with %s!", otherName)
			data := map[string]interface{}{
				"type":     "match",
				"match_id": match.MatchId,
			}
			go sendExpoNotifications(tokens, title, body, data)
		}
	}

	log.Printf("✅ Processed match event for match %s", match.MatchId)
	return nil
}

func processMessageEvent(event *pb.MessageEvent) error {
	log.Printf("📥 Processing MessageEvent type: %s", event.Type)

	if event.Type != pb.MessageEvent_SENT || event.GetSent() == nil {
		log.Printf("ℹ️ Ignoring non-SENT message event type: %s", event.Type)
		return nil
	}

	msg := event.GetSent()
	// Skip generic system messages, notify only on user messages and narration/dice events
	if msg.MessageType != "user" && msg.MessageType != "event" {
		log.Printf("ℹ️ Ignoring message type '%s' for conversation %s", msg.MessageType, msg.ConversationId)
		return nil
	}

	ctx := context.Background()
	client, err := getDBFunc(ctx)
	if err != nil {
		return fmt.Errorf("database connection error: %w", err)
	}

	systemToken, err := generateInternalJWT()
	if err != nil {
		log.Printf("[ERROR] Failed to sign system token: %v", err)
		return nil
	}

	// 1. Get conversation details to find participants
	pids, err := fetchConversationParticipants(msg.ConversationId, systemToken)
	if err != nil {
		log.Printf("[ERROR] Failed to fetch conversation participants: %v", err)
		return nil
	}

	// 2. Filter out the sender to find the recipient
	var recipientPid string
	for _, pid := range pids {
		if pid != msg.SenderProfileId {
			recipientPid = pid
			break
		}
	}

	if recipientPid == "" {
		log.Printf("[INFO] Message has no recipient participant or is a self-chat")
		return nil
	}

	// 3. Batch fetch profiles to get sender display name and recipient user ID
	lookupPids := []string{recipientPid}
	if msg.SenderProfileId != "" {
		lookupPids = append(lookupPids, msg.SenderProfileId)
	}

	profiles, err := fetchProfilesBatch(lookupPids, systemToken)
	if err != nil {
		log.Printf("[ERROR] Failed to fetch profiles batch: %v", err)
		return nil
	}

	var senderName = "Someone"
	var recipientUserID string

	for _, p := range profiles {
		if p.ProfileID == recipientPid {
			recipientUserID = p.UserID
		}
		if p.ProfileID == msg.SenderProfileId {
			senderName = p.DisplayName
		}
	}

	if recipientUserID == "" {
		log.Printf("[WARN] Recipient user ID not found for profile %s", recipientPid)
		return nil
	}

	// 4. Query device tokens and dispatch push notification
	tokens, err := getUserDeviceTokens(ctx, client, recipientUserID)
	if err != nil {
		log.Printf("[WARN] Failed to query tokens for user %s: %v", recipientUserID, err)
		return nil
	}

	if len(tokens) > 0 {
		title := fmt.Sprintf("New Message from %s", senderName)
		body := msg.MessagePreview
		data := map[string]interface{}{
			"type":            "message",
			"conversation_id": msg.ConversationId,
		}
		go sendExpoNotifications(tokens, title, body, data)
	}

	log.Printf("✅ Processed message event for conversation %s", msg.ConversationId)
	return nil
}

// --- Internal Helper Functions ---

func getUserDeviceTokens(ctx context.Context, client FirestoreClient, userID string) ([]string, error) {
	iter := client.Collection(COLLECTION_TOKENS).Where("user_id", "==", userID).Documents(ctx)
	var tokens []string
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}
		token, _ := doc.Data()["token"].(string)
		if token != "" {
			tokens = append(tokens, token)
		}
	}
	return tokens, nil
}

func fetchProfilesBatch(profileIDs []string, token string) ([]ProfileInfo, error) {
	baseURL := serviceURLs.Get("profiles")
	if baseURL == "" {
		return nil, fmt.Errorf("profiles service URL not resolved from router")
	}
	url := fmt.Sprintf("%s/profiles/batch", baseURL)

	bodyData, _ := json.Marshal(map[string]interface{}{"profile_ids": profileIDs})

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(bodyData))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected profiles batch status: %d", resp.StatusCode)
	}

	var profiles []ProfileInfo
	if err := json.NewDecoder(resp.Body).Decode(&profiles); err != nil {
		return nil, err
	}
	return profiles, nil
}

func fetchConversationParticipants(convID string, token string) ([]string, error) {
	baseURL := serviceURLs.Get("messages")
	if baseURL == "" {
		return nil, fmt.Errorf("messages service URL not resolved from router")
	}
	url := fmt.Sprintf("%s/messages/conversations/%s", baseURL, convID)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected conversation status: %d", resp.StatusCode)
	}

	var result struct {
		ParticipantIDs []string `json:"participant_ids"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return result.ParticipantIDs, nil
}

// sendExpoNotifications sends notification payloads to Expo API
func sendExpoNotifications(tokens []string, title, body string, data map[string]interface{}) {
	if len(tokens) == 0 {
		return
	}

	messages := make([]ExpoPushMessage, len(tokens))
	for i, t := range tokens {
		messages[i] = ExpoPushMessage{
			To:        t,
			Title:     title,
			Body:      body,
			Data:      data,
			Sound:     "default",
			ChannelID: "default",
			Priority:  "high",
		}
	}

	bodyData, err := json.Marshal(messages)
	if err != nil {
		log.Printf("[ERROR] Failed to marshal Expo push payload: %v", err)
		return
	}

	expoURL := os.Getenv("EXPO_PUSH_URL")
	if expoURL == "" {
		expoURL = "https://exp.host/--/api/v2/push/send"
	}
	req, err := http.NewRequest("POST", expoURL, bytes.NewBuffer(bodyData))
	if err != nil {
		log.Printf("[ERROR] Failed to create Expo request: %v", err)
		return
	}

	req.Header.Set("Content-Type", "application/json")

	// Add Optional Expo Access Token if configured
	accessToken := os.Getenv("EXPO_ACCESS_TOKEN")
	if accessToken != "" {
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", accessToken))
	}

	httpClient := &http.Client{Timeout: 8 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		log.Printf("[ERROR] Failed to post notifications to Expo: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("[ERROR] Expo API returned status: %d", resp.StatusCode)
		return
	}

	var pushResp ExpoPushResponse
	if err := json.NewDecoder(resp.Body).Decode(&pushResp); err != nil {
		log.Printf("[ERROR] Failed to decode Expo response: %v", err)
		return
	}

	// Handle response error statuses (delete unregistered tokens)
	for i, result := range pushResp.Data {
		if result.Status == "error" {
			log.Printf("[WARN] Expo push failed for token %s: %s (%s)", tokens[i], result.Message, result.Details.Error)
			if result.Details.Error == "DeviceNotRegistered" {
				go deleteUnregisteredToken(tokens[i])
			}
		}
	}
}

func deleteUnregisteredToken(token string) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	client, err := getDBFunc(ctx)
	if err != nil {
		return
	}

	_, err = client.Collection(COLLECTION_TOKENS).Doc(token).Delete(ctx)
	if err != nil {
		log.Printf("[WARN] Failed to delete unregistered token %s: %v", token, err)
	} else {
		log.Printf("[INFO] Successfully deleted unregistered token: %s", token)
	}
}
