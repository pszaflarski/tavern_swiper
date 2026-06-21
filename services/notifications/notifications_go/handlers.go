package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"google.golang.org/api/iterator"
	"google.golang.org/protobuf/proto"

	pb "notifications_go/proto"
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

// handlePubSubMatchEvent handles push notifications for match creation
func handlePubSubMatchEvent(c *gin.Context) {
	var pushMsg PubSubPushRequest
	if err := c.ShouldBindJSON(&pushMsg); err != nil {
		log.Printf("[WARN] Malformed Pub/Sub request: %v", err)
		c.Status(http.StatusOK) // Return 200 to acknowledge Pub/Sub
		return
	}

	if len(pushMsg.Message.Data) == 0 {
		c.Status(http.StatusOK)
		return
	}

	var event pb.MatchEvent
	if err := proto.Unmarshal(pushMsg.Message.Data, &event); err != nil {
		log.Printf("[ERROR] Failed to unmarshal MatchEvent: %v", err)
		c.Status(http.StatusOK)
		return
	}

	if event.Type != pb.MatchEvent_CREATED || event.GetCreated() == nil {
		// Only notify on match creation
		c.Status(http.StatusOK)
		return
	}

	match := event.GetCreated()
	pids := match.ProfileIds
	if len(pids) < 2 {
		c.Status(http.StatusOK)
		return
	}

	ctx := c.Request.Context()
	client, err := getDBFunc(ctx)
	if err != nil {
		c.Status(http.StatusInternalServerError)
		return
	}

	// Fetch profile details for both matched profiles
	systemToken, err := generateSystemJWT()
	if err != nil {
		log.Printf("[ERROR] Failed to sign system token: %v", err)
		c.Status(http.StatusOK)
		return
	}

	profiles, err := fetchProfilesBatch(pids, systemToken)
	if err != nil {
		log.Printf("[ERROR] Failed to fetch profiles batch: %v", err)
		c.Status(http.StatusOK)
		return
	}

	if len(profiles) < 2 {
		log.Printf("[WARN] Batch profile fetch returned fewer than 2 profiles for match %s", match.MatchId)
		c.Status(http.StatusOK)
		return
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

	c.Status(http.StatusOK)
}

// handlePubSubMessageEvent handles push notifications for message delivery
func handlePubSubMessageEvent(c *gin.Context) {
	var pushMsg PubSubPushRequest
	if err := c.ShouldBindJSON(&pushMsg); err != nil {
		log.Printf("[WARN] Malformed Pub/Sub request: %v", err)
		c.Status(http.StatusOK)
		return
	}

	if len(pushMsg.Message.Data) == 0 {
		c.Status(http.StatusOK)
		return
	}

	var event pb.MessageEvent
	if err := proto.Unmarshal(pushMsg.Message.Data, &event); err != nil {
		log.Printf("[ERROR] Failed to unmarshal MessageEvent: %v", err)
		c.Status(http.StatusOK)
		return
	}

	if event.Type != pb.MessageEvent_SENT || event.GetSent() == nil {
		c.Status(http.StatusOK)
		return
	}

	msg := event.GetSent()
	// Skip generic system messages, notify only on user messages and narration/dice events
	if msg.MessageType != "user" && msg.MessageType != "event" {
		c.Status(http.StatusOK)
		return
	}

	ctx := c.Request.Context()
	client, err := getDBFunc(ctx)
	if err != nil {
		c.Status(http.StatusInternalServerError)
		return
	}

	systemToken, err := generateSystemJWT()
	if err != nil {
		log.Printf("[ERROR] Failed to sign system token: %v", err)
		c.Status(http.StatusOK)
		return
	}

	// 1. Get conversation details to find participants
	pids, err := fetchConversationParticipants(msg.ConversationId, systemToken)
	if err != nil {
		log.Printf("[ERROR] Failed to fetch conversation participants: %v", err)
		c.Status(http.StatusOK)
		return
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
		c.Status(http.StatusOK)
		return
	}

	// 3. Batch fetch profiles to get sender display name and recipient user ID
	lookupPids := []string{recipientPid}
	if msg.SenderProfileId != "" {
		lookupPids = append(lookupPids, msg.SenderProfileId)
	}

	profiles, err := fetchProfilesBatch(lookupPids, systemToken)
	if err != nil {
		log.Printf("[ERROR] Failed to fetch profiles batch: %v", err)
		c.Status(http.StatusOK)
		return
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
		c.Status(http.StatusOK)
		return
	}

	// 4. Query device tokens and dispatch push notification
	tokens, err := getUserDeviceTokens(ctx, client, recipientUserID)
	if err != nil {
		log.Printf("[WARN] Failed to query tokens for user %s: %v", recipientUserID, err)
		c.Status(http.StatusOK)
		return
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

	c.Status(http.StatusOK)
}

// --- Internal Helper Functions ---

func generateSystemJWT() (string, error) {
	claims := jwt.MapClaims{
		"sub":  "notifications_service",
		"role": "admin",
		"iat":  time.Now().Unix(),
		"exp":  time.Now().Add(5 * time.Minute).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

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

// ProfileInfo is fetched from profiles microservice
type ProfileInfo struct {
	ProfileID   string `json:"profile_id"`
	UserID      string `json:"user_id"`
	DisplayName string `json:"display_name"`
}

func fetchProfilesBatch(profileIDs []string, token string) ([]ProfileInfo, error) {
	baseURL := serviceURLs.Get("profiles")
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
			To:    t,
			Title: title,
			Body:  body,
			Data:  data,
			Sound: "default",
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

	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
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
