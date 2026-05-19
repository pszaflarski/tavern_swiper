package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
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

	// 1. Generate an Event ID (hash of trigger + context) for idempotency.
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

	// 3. Dispatch to behavior handlers based on trigger type.
	var details []string
	triggeredCount := 0

	log.Printf("[INFO] Triggering %s", req.Trigger)

	if req.Trigger == "profile_created" {
		profileID, ok := req.Context["profile_id"].(string)
		if ok {
			count, msgs := behaviorTavernKeeperSwipe(ctx, client, profileID)
			triggeredCount += count
			details = append(details, msgs...)
		}
	}

	if req.Trigger == "message_received" {
		conversationID, _ := req.Context["conversation_id"].(string)
		senderProfileID, _ := req.Context["sender_profile_id"].(string)
		messagePreview, _ := req.Context["message_preview"].(string)
		messageType, _ := req.Context["message_type"].(string)
		metadata, _ := req.Context["metadata"].(map[string]interface{})
		if conversationID != "" && senderProfileID != "" {
			count, msgs := behaviorBotReply(ctx, client, conversationID, senderProfileID, messagePreview, messageType, metadata)
			triggeredCount += count
			details = append(details, msgs...)
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

// isBotProfile checks if a profile_id belongs to any registered bot.
// Any behavior can use this to avoid bot-on-bot interactions.
func isBotProfile(ctx context.Context, db FirestoreClient, profileID string) bool {
	iter := db.Collection(BOT_PROFILES_COLLECTION).
		Where("profile_id", "==", profileID).
		Documents(ctx)
	doc, err := iter.Next()
	return err == nil && doc != nil
}

// behaviorTavernKeeperSwipe finds all tavern keeper bot profiles,
// authenticates once per bot user, and swipes right on the target profile
// via the discovery service.
func behaviorTavernKeeperSwipe(ctx context.Context, db FirestoreClient, targetProfileID string) (int, []string) {
	// 1. Bots don't interact with other bots.
	if isBotProfile(ctx, db, targetProfileID) {
		msg := fmt.Sprintf("Target profile %s belongs to a bot, skipping", targetProfileID)
		log.Printf("[INFO] %s", msg)
		return 0, []string{msg}
	}

	// 2. Query all bot_profiles with behavior_type = "tavern_keeper"
	iter := db.Collection(BOT_PROFILES_COLLECTION).
		Where("behavior_type", "==", "tavern_keeper").
		Documents(ctx)

	// Group profiles by bot_user_id so we authenticate once per bot user.
	type profileInfo struct {
		profileID string
		agentName string
	}
	grouped := make(map[string][]profileInfo) // bot_user_id -> profiles

	for {
		doc, err := iter.Next()
		if err != nil {
			break
		}
		data := doc.Data()
		botUserID, _ := data["bot_user_id"].(string)
		profileID, _ := data["profile_id"].(string)
		agentName, _ := data["agent_name"].(string)

		if botUserID == "" || profileID == "" {
			continue
		}
		grouped[botUserID] = append(grouped[botUserID], profileInfo{
			profileID: profileID,
			agentName: agentName,
		})
	}

	if len(grouped) == 0 {
		log.Printf("[INFO] No tavern keeper profiles found")
		return 0, []string{"No tavern keeper profiles found"}
	}

	var details []string
	triggered := 0

	// 2. For each bot user, authenticate once, then swipe for all profiles.
	for botUserID, profiles := range grouped {
		token, err := authenticateBotUser(ctx, db, botUserID)
		if err != nil {
			msg := fmt.Sprintf("Auth failed for bot_user %s: %v", botUserID, err)
			log.Printf("[ERROR] %s", msg)
			details = append(details, msg)
			continue
		}

		for _, p := range profiles {
			err := swipeRight(token, p.profileID, targetProfileID)
			if err != nil {
				msg := fmt.Sprintf("Swipe failed for '%s' (profile=%s) on %s: %v", p.agentName, p.profileID, targetProfileID, err)
				log.Printf("[ERROR] %s", msg)
				details = append(details, msg)
				continue
			}

			msg := fmt.Sprintf("Tavern keeper '%s' swiped right on %s", p.agentName, targetProfileID)
			log.Printf("[INFO] %s", msg)
			details = append(details, msg)
			triggered++
		}
	}

	return triggered, details
}

// authenticateBotUser retrieves the bot user's credentials from Firestore
// and returns a valid Tavern JWT.
func authenticateBotUser(ctx context.Context, db FirestoreClient, botUserID string) (string, error) {
	doc, err := db.Collection(BOT_USERS_COLLECTION).Doc(botUserID).Get(ctx)
	if err != nil {
		return "", fmt.Errorf("bot_user %s not found: %w", botUserID, err)
	}

	data := doc.Data()
	email, _ := data["email"].(string)
	encryptedPassword, _ := data["encrypted_password"].(string)

	if email == "" || encryptedPassword == "" {
		return "", fmt.Errorf("bot_user %s has no credentials", botUserID)
	}

	password, err := decryptPasswordFunc(ctx, encryptedPassword)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt password for %s: %w", botUserID, err)
	}

	token, _, err := loginAndVerify(email, password)
	if err != nil {
		return "", fmt.Errorf("login failed for %s (%s): %w", botUserID, email, err)
	}

	return token, nil
}

// swipeRight calls the discovery service to record a right-swipe.
func swipeRight(token, swiperProfileID, swipedProfileID string) error {
	discoveryURL := serviceURLs.Get("discovery")

	payload := map[string]string{
		"swiper_profile_id": swiperProfileID,
		"swiped_profile_id": swipedProfileID,
		"direction":         "right",
	}
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequest("POST", discoveryURL+"/discovery/swipe/", bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("HTTP error calling discovery: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return fmt.Errorf("discovery swipe failed (HTTP %d): %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// behaviorBotReply handles the "message_received" trigger. It checks if any
// bot profiles are participants in the conversation and generates AI replies.
func behaviorBotReply(ctx context.Context, db FirestoreClient, conversationID, senderProfileID, messagePreview, messageType string, metadata map[string]interface{}) (int, []string) {
	// 1. Guard: if the sender is ANY bot, bail immediately to prevent loops.
	if isBotProfile(ctx, db, senderProfileID) {
		msg := fmt.Sprintf("Sender %s is a bot, skipping reply", senderProfileID)
		log.Printf("[INFO] %s", msg)
		return 0, []string{msg}
	}

	// 2. Query ALL bot profiles to find which ones might be in this conversation.
	iter := db.Collection(BOT_PROFILES_COLLECTION).Documents(ctx)
	type botInfo struct {
		botUserID    string
		profileID    string
		agentName    string
		botProfileID string
		behaviorType string
	}
	var allBotProfiles []botInfo

	for {
		doc, err := iter.Next()
		if err != nil {
			break
		}
		data := doc.Data()
		botUserID, _ := data["bot_user_id"].(string)
		profileID, _ := data["profile_id"].(string)
		agentName, _ := data["agent_name"].(string)
		behaviorType, _ := data["behavior_type"].(string)

		if botUserID == "" || profileID == "" || agentName == "" {
			continue
		}
		allBotProfiles = append(allBotProfiles, botInfo{
			botUserID:    botUserID,
			profileID:    profileID,
			agentName:    agentName,
			botProfileID: doc.Ref().ID,
			behaviorType: behaviorType,
		})
	}

	if len(allBotProfiles) == 0 {
		return 0, []string{"No bot profiles with agent_name found"}
	}

	// 3. For each bot profile, authenticate and check if they're in this conversation.
	var details []string
	triggered := 0

	// Group by bot_user_id to authenticate once per bot user
	grouped := make(map[string][]botInfo)
	for _, bp := range allBotProfiles {
		grouped[bp.botUserID] = append(grouped[bp.botUserID], bp)
	}

	for botUserID, profiles := range grouped {
		token, err := authenticateBotUser(ctx, db, botUserID)
		if err != nil {
			msg := fmt.Sprintf("Auth failed for bot_user %s: %v", botUserID, err)
			log.Printf("[ERROR] %s", msg)
			details = append(details, msg)
			continue
		}

		for _, bp := range profiles {
			// Check if this bot profile is a participant in the conversation
			inConv, err := isBotInConversation(token, bp.profileID, conversationID)
			if err != nil {
				log.Printf("[WARN] Failed to check conversation membership for %s: %v", bp.profileID, err)
				continue
			}
			if !inConv {
				continue
			}

			log.Printf("[INFO] Bot '%s' (profile=%s) is in conversation %s, generating reply via %s", bp.agentName, bp.profileID, conversationID, serviceURLs.Get("agent_router"))

			// 4. Build enriched metadata for the agent_router call.
			// Include sender_profile_id so agent_router tools can look up
			// quest status and complete quests on behalf of the user.
			enrichedMetadata := make(map[string]interface{})
			for k, v := range metadata {
				enrichedMetadata[k] = v
			}
			enrichedMetadata["sender_profile_id"] = senderProfileID

			// 5. Call agent_router to generate a reply
			aiResponse, err := callAgentRouter(token, bp.agentName, messagePreview, conversationID, messageType, enrichedMetadata)
			if err != nil {
				msg := fmt.Sprintf("Agent router failed for '%s': %v", bp.agentName, err)
				log.Printf("[ERROR] %s", msg)
				details = append(details, msg)
				continue
			}

			// 6. Parse structured response and post each item
			items := parseAgentResponse(aiResponse)
			postFailed := false
			for _, item := range items {
				var postErr error
				switch item.Type {
				case "narration":
					postErr = postBotNarration(token, conversationID, bp.profileID, item.Content)
				default: // "message" or fallback
					postErr = postBotMessage(token, conversationID, bp.profileID, item.Content)
				}
				if postErr != nil {
					msg := fmt.Sprintf("Failed to post %s for '%s': %v", item.Type, bp.agentName, postErr)
					log.Printf("[ERROR] %s", msg)
					details = append(details, msg)
					postFailed = true
					break
				}
			}
			if postFailed {
				continue
			}

			msg := fmt.Sprintf("Bot '%s' replied in conversation %s (%d items)", bp.agentName, conversationID, len(items))
			log.Printf("[INFO] %s", msg)
			details = append(details, msg)
			triggered++

			// 7. meet_the_tavern_keepers milestone — async, no narration needed.
			if bp.behaviorType == "tavern_keeper" {
				go func(botProfileID string) {
					defer func() {
						if r := recover(); r != nil {
							log.Printf("[CRITICAL] 🔥 PANIC in quest goroutine: %v", r)
						}
					}()
					tryCompleteQuest(token, "meet_the_tavern_keepers", senderProfileID, botProfileID)
				}(bp.profileID)
			}
		}
	}

	return triggered, details
}

// isBotInConversation checks if a bot profile is a participant in the given
// conversation by listing the bot's conversations from the messages service.
func isBotInConversation(token, botProfileID, conversationID string) (bool, error) {
	messagesURL := serviceURLs.Get("messages")

	req, _ := http.NewRequest("GET", messagesURL+"/messages/conversations/profile/"+botProfileID, nil)
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := httpClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("failed to list conversations: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return false, nil // No conversations or error, treat as not in conversation
	}

	var conversations []struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&conversations); err != nil {
		return false, fmt.Errorf("failed to decode conversations: %w", err)
	}

	for _, conv := range conversations {
		if conv.ID == conversationID {
			return true, nil
		}
	}
	return false, nil
}

// callAgentRouter sends a prompt to the agent_router and returns the AI response.
func callAgentRouter(token, agentName, prompt, threadID, messageType string, metadata map[string]interface{}) (string, error) {
	agentRouterURL := serviceURLs.Get("agent_router")

	payload := map[string]interface{}{
		"prompt":       prompt,
		"agent":        agentName,
		"thread_id":    threadID,
		"message_type": messageType,
		"metadata":     metadata,
	}
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequest("POST", agentRouterURL+"/invoke", bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	// Agent router calls can take longer (cold start + tool calls + LLM generation)
	agentClient := &http.Client{Timeout: 60 * time.Second}
	resp, err := agentClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("HTTP error calling agent_router: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return "", fmt.Errorf("agent_router error (HTTP %d): %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Response string `json:"response"`
		ThreadID string `json:"thread_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode agent_router response: %w", err)
	}

	return result.Response, nil
}

// postBotMessage sends a message to a conversation on behalf of a bot profile.
func postBotMessage(token, conversationID, senderProfileID, content string) error {
	messagesURL := serviceURLs.Get("messages")

	payload := map[string]string{
		"sender_profile_id": senderProfileID,
		"content":           content,
	}
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequest("POST", messagesURL+"/messages/conversations/"+conversationID+"/messages", bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to post message: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return fmt.Errorf("messages service error (HTTP %d): %s", resp.StatusCode, string(respBody))
	}

	return nil
}
// AgentResponseItem represents a single item in a structured agent response.
type AgentResponseItem struct {
	Type    string `json:"type"`    // "message" or "narration"
	Content string `json:"content"`
}

// parseAgentResponse parses a JSON array of items from the agent response.
// If the response isn't valid JSON, it falls back to a single "message" item.
func parseAgentResponse(raw string) []AgentResponseItem {
	trimmed := strings.TrimSpace(raw)

	// Strip markdown code fences if present (```json ... ``` or ``` ... ```)
	if strings.HasPrefix(trimmed, "```") {
		lines := strings.Split(trimmed, "\n")
		if len(lines) >= 3 {
			// Remove first line (```json or ```) and last line (```)
			inner := lines[1:]
			for len(inner) > 0 && strings.TrimSpace(inner[len(inner)-1]) == "```" {
				inner = inner[:len(inner)-1]
			}
			trimmed = strings.TrimSpace(strings.Join(inner, "\n"))
		}
	}

	var items []AgentResponseItem
	if err := json.Unmarshal([]byte(trimmed), &items); err != nil {
		log.Printf("[WARN] Agent response is not valid JSON array, using as plain message: %v", err)
		return []AgentResponseItem{{Type: "message", Content: raw}}
	}

	// Filter out empty or invalid items
	var valid []AgentResponseItem
	for _, item := range items {
		content := strings.TrimSpace(item.Content)
		if content == "" {
			continue
		}
		itemType := strings.TrimSpace(item.Type)
		if itemType != "message" && itemType != "narration" {
			itemType = "message" // default unknown types to message
		}
		valid = append(valid, AgentResponseItem{Type: itemType, Content: content})
	}

	if len(valid) == 0 {
		// If all items were filtered, fallback to raw text
		return []AgentResponseItem{{Type: "message", Content: raw}}
	}

	return valid
}

// postBotNarration posts a narration event to a conversation on behalf of a bot.
func postBotNarration(token, conversationID, botProfileID, content string) error {
	messagesURL := serviceURLs.Get("messages")

	payload := map[string]interface{}{
		"sender_profile_id": botProfileID,
		"content":           content,
		"type":              "event",
		"metadata": map[string]interface{}{
			"event_type":   "narration",
			"initiated_by": botProfileID,
		},
	}
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequest("POST", messagesURL+"/messages/conversations/"+conversationID+"/messages", bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to post narration: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return fmt.Errorf("messages service error (HTTP %d): %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// completeQuestSync attempts quest completion synchronously and returns true if
// the quest was NEWLY completed (HTTP 200). Returns false on 409 (already done)
// or any error. Used when the caller needs to know the result before proceeding
// (e.g. to inject a narrative signal into the agent_router metadata).
func completeQuestSync(botToken, questID, senderProfileID, botProfileID string) bool {
	userID, err := lookupUserIDByProfile(botToken, senderProfileID)
	if err != nil {
		log.Printf("[WARN] Quest '%s' sync check skipped — failed to look up user for profile %s: %v", questID, senderProfileID, err)
		return false
	}

	questsURL := serviceURLs.Get("quests")
	if questsURL == "" {
		log.Printf("[WARN] Quest '%s' sync check skipped — quests service URL not resolved", questID)
		return false
	}

	payload := map[string]string{
		"quest_id":   questID,
		"user_id":    userID,
		"profile_id": senderProfileID,
		"status":     "completed",
	}
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequest("POST", questsURL+"/quests/status/", bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+botToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		log.Printf("[WARN] Quest '%s' sync completion failed for user %s: %v", questID, userID, err)
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusConflict {
		log.Printf("[INFO] Quest '%s' already completed for user %s (409)", questID, userID)
		return false // already done — don't narrate again
	}
	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		log.Printf("[WARN] Quest '%s' sync returned HTTP %d for user %s: %s", questID, resp.StatusCode, userID, string(respBody))
		return false
	}

	log.Printf("[INFO] ✨ Quest '%s' newly completed for user %s — injecting narrative signal", questID, userID)
	return true
}

// tryCompleteQuest attempts to mark the given quest as completed for the user
// who just interacted with a bot. Idempotent — 409 means already done.
// Always called in a goroutine; never blocks the reply path.
func tryCompleteQuest(botToken, questID, senderProfileID, botProfileID string) {
	// 1. Resolve the sender's user_id from their profile
	userID, err := lookupUserIDByProfile(botToken, senderProfileID)
	if err != nil {
		log.Printf("[WARN] Quest '%s' skipped — failed to look up user for profile %s: %v", questID, senderProfileID, err)
		return
	}

	// 2. Call the quests service
	questsURL := serviceURLs.Get("quests")
	if questsURL == "" {
		log.Printf("[WARN] Quest '%s' skipped — quests service URL not resolved", questID)
		return
	}

	payload := map[string]string{
		"quest_id":   questID,
		"user_id":    userID,
		"profile_id": senderProfileID,
		"status":     "completed",
	}
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequest("POST", questsURL+"/quests/status/", bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+botToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		log.Printf("[WARN] Quest '%s' completion failed for user %s: %v", questID, userID, err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusConflict {
		log.Printf("[INFO] Quest '%s' already completed for user %s (409)", questID, userID)
		return
	}

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		log.Printf("[WARN] Quest '%s' returned HTTP %d for user %s: %s", questID, resp.StatusCode, userID, string(respBody))
		return
	}

	log.Printf("[INFO] ✨ Quest '%s' completed for user %s (profile: %s, bot: %s)", questID, userID, senderProfileID, botProfileID)
}

// lookupUserIDByProfile fetches a profile from the profiles service and
// extracts the user_id. Uses the bot's JWT since bots have read access.
func lookupUserIDByProfile(token, profileID string) (string, error) {
	profilesURL := serviceURLs.Get("profiles")
	if profilesURL == "" {
		return "", fmt.Errorf("profiles service URL not resolved")
	}

	req, _ := http.NewRequest("GET", profilesURL+"/profiles/"+profileID, nil)
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to fetch profile: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return "", fmt.Errorf("profiles service returned HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var profile struct {
		UserID string `json:"user_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&profile); err != nil {
		return "", fmt.Errorf("failed to decode profile response: %w", err)
	}

	if profile.UserID == "" {
		return "", fmt.Errorf("profile %s has no user_id", profileID)
	}

	return profile.UserID, nil
}
