package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"log"
	"math/big"
	"net/http"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"google.golang.org/api/iterator"
)

// profilesClient is the client used to call the profiles service.
// Injected as a package variable for testability.
var profilesClient ProfilesClient

const (
	COLLECTION_MESSAGES              = "messages"
	COLLECTION_CONVERSATIONS         = "conversations"
	COLLECTION_PROFILE_CONVERSATIONS = "profile_conversations"
	COLLECTION_CACHE                 = "discovery_matches_cache"
)


// verifyProfileOwnership checks that auth.UID owns the given profile.
// Admins bypass this check.
func verifyProfileOwnership(auth AuthData, profileID string, pc ProfilesClient) bool {
	if IsAdmin(auth.Role) {
		return true
	}
	if pc == nil {
		return false
	}
	info, err := pc.GetProfile(profileID, auth.Token)
	if err != nil {
		return false
	}
	return info.UserID == auth.UID
}

func parseStringSlice(val interface{}) []string {
	if val == nil {
		return []string{}
	}
	if s, ok := val.([]string); ok {
		return s
	}
	if i, ok := val.([]interface{}); ok {
		res := make([]string, len(i))
		for j, v := range i {
			res[j] = v.(string)
		}
		return res
	}
	return []string{}
}

func isMatched(ctx context.Context, client FirestoreClient, pid1, pid2 string) bool {
	sortedPair := []string{pid1, pid2}
	sort.Strings(sortedPair)
	matchID := fmt.Sprintf("match_%s_%s", sortedPair[0], sortedPair[1])

	matchDoc, err := client.Collection(COLLECTION_CACHE).Doc(matchID).Get(ctx)
	if err == nil && matchDoc.Exists() {
		return true
	}

	// Fallback check: query discovery_matches_cache where profile_ids array-contains pid1
	iter := client.Collection(COLLECTION_CACHE).Where("profile_ids", "array-contains", pid1).Documents(ctx)
	docs, err := iter.GetAll()
	if err != nil {
		return false
	}
	for _, doc := range docs {
		pids := parseStringSlice(doc.Data()["profile_ids"])
		for _, p := range pids {
			if p == pid2 {
				return true
			}
		}
	}
	return false
}

// handleHealth godoc
// @Summary      Health check
// @Description  Returns the health status of the messages service.
// @Tags         health
// @Produce      json
// @Success      200  {object}  map[string]string
// @Router       /health [get]
func handleHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"service": "messages", "status": "ok"})
}

// handleCreateConversation godoc
// @Summary      Create a conversation
// @Description  Creates a new 1-on-1 conversation between two matched profiles. Returns existing if already created.
// @Tags         conversations
// @Accept       json
// @Produce      json
// @Param        body  body      ConversationCreate  true  "Participant profile IDs"
// @Success      201   {object}  map[string]string   "conversation_id"
// @Success      200   {object}  map[string]string   "Existing conversation_id"
// @Failure      403   {object}  map[string]string
// @Failure      422   {object}  map[string]string
// @Failure      500   {object}  map[string]string
// @Security     BearerAuth
// @Router       /conversations [post]
func handleCreateConversation(c *gin.Context) {
	auth := GetAuth(c)
	var body ConversationCreate
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": err.Error()})
		return
	}

	ctx := context.Background()
	client, err := getDBFunc(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Internal server error"})
		return
	}

	convType := body.Type
	if convType == "" {
		convType = "direct"
	}

	if convType != "direct" && convType != "group" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": "Invalid conversation type (must be 'direct' or 'group')"})
		return
	}

	// 1. Unique check and participant count enforcement
	uniqueMap := make(map[string]bool)
	for _, pid := range body.ParticipantProfileIDs {
		uniqueMap[strings.TrimSpace(pid)] = true
	}

	if convType == "direct" && len(uniqueMap) != 2 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": "Conversation must have exactly 2 unique participants"})
		return
	}
	if convType == "group" && len(uniqueMap) < 2 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": "Group conversation must have at least 2 unique participants"})
		return
	}

	// 2. Sort
	pids := make([]string, 0, len(uniqueMap))
	for pid := range uniqueMap {
		pids = append(pids, pid)
	}
	sort.Strings(pids)

	// Authorization: verify caller owns at least one participant profile
	var creatorPID string
	if !IsAdmin(auth.Role) {
		for _, pid := range pids {
			if verifyProfileOwnership(auth, pid, profilesClient) {
				creatorPID = pid
				break
			}
		}
		if creatorPID == "" {
			c.JSON(http.StatusForbidden, gin.H{"detail": "You must own one of the participant profiles"})
			return
		}
	} else {
		if len(body.ParticipantProfileIDs) > 0 {
			creatorPID = body.ParticipantProfileIDs[0]
		} else if len(pids) > 0 {
			creatorPID = pids[0]
		}
	}

	if convType == "direct" {
		participantsKey := strings.Join(pids, "_")
		dedupRef := client.Collection("conversation_dedup").Doc(participantsKey)

		// Fast path: check the dedup doc — this is the common case for existing conversations.
		dedupSnap, err := dedupRef.Get(ctx)
		if err == nil && dedupSnap.Exists() {
			data := dedupSnap.Data()
			if existingID, ok := data["conversation_id"].(string); ok {
				c.JSON(http.StatusOK, gin.H{"conversation_id": existingID})
				return
			}
		}

		// Fallback: check the conversations collection directly.
		legacyIter := client.Collection(COLLECTION_CONVERSATIONS).Where("participants_key", "==", participantsKey).Limit(1).Documents(ctx)
		legacyDocs, legacyErr := legacyIter.GetAll()
		if legacyErr == nil && len(legacyDocs) > 0 {
			legacyData := legacyDocs[0].Data()
			if existingID, ok := legacyData["id"].(string); ok && existingID != "" {
				// Backfill the dedup entry so future requests use the fast path
				dedupRef.Set(ctx, map[string]interface{}{
					"conversation_id":  existingID,
					"participants_key": participantsKey,
					"created_at":       firestore.ServerTimestamp,
				})
				log.Printf("[INFO] Backfilled dedup entry for legacy conversation %s", existingID)
				c.JSON(http.StatusOK, gin.H{"conversation_id": existingID})
				return
			}
		}

		// Match verification step (check match cache for 1-on-1 chats)
		if !isMatched(ctx, client, pids[0], pids[1]) {
			log.Printf("[INFO] Match not found for %s vs %s", pids[0], pids[1])
			c.JSON(http.StatusForbidden, gin.H{"detail": "Conversation initialization not permitted (no match found)"})
			return
		}

		convID := uuid.New().String()
		convRef := client.Collection(COLLECTION_CONVERSATIONS).Doc(convID)
		batch := client.Batch()

		batch.Set(convRef, map[string]interface{}{
			"id":                     convID,
			"type":                   "direct",
			"participants_key":       participantsKey,
			"participant_ids":        pids,
			"created_by":             body.ParticipantProfileIDs[0],
			"created_at":             firestore.ServerTimestamp,
			"updated_at":             firestore.ServerTimestamp,
			"last_message_id":        "",
			"last_message_text":      "",
			"last_message_sent_at":   nil,
			"last_message_sender_id": "",
			"last_message_type":      "",
		})

		batch.Create(dedupRef, map[string]interface{}{
			"conversation_id":  convID,
			"participants_key": participantsKey,
			"created_at":       firestore.ServerTimestamp,
		})

		// Create ProfileConversation mappings
		for _, pid := range pids {
			pcID := fmt.Sprintf("%s_%s", pid, convID)
			batch.Set(client.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(pcID), map[string]interface{}{
				"profile_id":      pid,
				"conversation_id": convID,
				"role":            "participant",
				"updated_at":      firestore.ServerTimestamp,
			})
		}

		if _, err := batch.Commit(ctx); err != nil {
			dedupSnap, readErr := dedupRef.Get(ctx)
			if readErr == nil && dedupSnap.Exists() {
				data := dedupSnap.Data()
				if existingID, ok := data["conversation_id"].(string); ok {
					log.Printf("[INFO] Conversation creation race resolved — returning existing %s", existingID)
					c.JSON(http.StatusOK, gin.H{"conversation_id": existingID})
					return
				}
			}
			log.Printf("[ERROR] Failed to commit conversation batch: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"detail": "Failed to create conversation"})
			return
		}

		c.JSON(http.StatusCreated, gin.H{"conversation_id": convID})
	} else {
		// Match verification step for group chats: creator must be matched with all other participants
		for _, targetPID := range pids {
			if targetPID == creatorPID {
				continue
			}
			if !isMatched(ctx, client, creatorPID, targetPID) {
				log.Printf("[INFO] Group chat match not found for creator %s vs participant %s", creatorPID, targetPID)
				c.JSON(http.StatusForbidden, gin.H{"detail": fmt.Sprintf("Conversation initialization not permitted (no match found between creator %s and participant %s)", creatorPID, targetPID)})
				return
			}
		}

		// Group conversation creation
		convID := uuid.New().String()
		convRef := client.Collection(COLLECTION_CONVERSATIONS).Doc(convID)
		batch := client.Batch()

		batch.Set(convRef, map[string]interface{}{
			"id":                     convID,
			"type":                   "group",
			"name":                   body.Name,
			"image_url":              body.ImageURL,
			"participants_key":       "",
			"participant_ids":        pids,
			"created_by":             body.ParticipantProfileIDs[0],
			"created_at":             firestore.ServerTimestamp,
			"updated_at":             firestore.ServerTimestamp,
			"last_message_id":        "",
			"last_message_text":      "",
			"last_message_sent_at":   nil,
			"last_message_sender_id": "",
			"last_message_type":      "",
		})

		// Create ProfileConversation mappings
		for _, pid := range pids {
			pcID := fmt.Sprintf("%s_%s", pid, convID)
			batch.Set(client.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(pcID), map[string]interface{}{
				"profile_id":      pid,
				"conversation_id": convID,
				"role":            "participant",
				"updated_at":      firestore.ServerTimestamp,
			})
		}

		if _, err := batch.Commit(ctx); err != nil {
			log.Printf("[ERROR] Failed to commit conversation batch: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"detail": "Failed to create conversation"})
			return
		}

		c.JSON(http.StatusCreated, gin.H{"conversation_id": convID})
	}
}

// handleSendMessage godoc
// @Summary      Send a message
// @Description  Sends a message in a conversation. For type "user" (default), sender must be a participant. For type "system" or "event", admin authorization is required and sender_profile_id is optional.
// @Tags         messages
// @Accept       json
// @Produce      json
// @Param        id    path      string         true  "Conversation ID"
// @Param        body  body      MessageCreate  true  "Message payload"
// @Success      201   {object}  MessageOut
// @Failure      403   {object}  map[string]string
// @Failure      422   {object}  map[string]string
// @Failure      500   {object}  map[string]string
// @Security     BearerAuth
// @Router       /conversations/{id}/messages [post]
func handleSendMessage(c *gin.Context) {
	auth := GetAuth(c)
	convID := c.Param("id")
	var body MessageCreate
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": err.Error()})
		return
	}

	// 1. Normalize message type (default to "user")
	msgType := strings.TrimSpace(body.Type)
	if msgType == "" {
		msgType = MessageTypeUser
	}

	// Validate message type
	switch msgType {
	case MessageTypeUser, MessageTypeSystem, MessageTypeEvent:
		// valid
	default:
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": fmt.Sprintf("Invalid message type: %s. Must be one of: user, system, event", msgType)})
		return
	}

	// 2. Authorization: non-user message types require admin (with narration exemption)
	isNarration := msgType == MessageTypeEvent &&
		body.Metadata != nil &&
		body.Metadata.EventType == "narration"
	if msgType != MessageTypeUser && !isNarration {
		if !IsAdmin(auth.Role) {
			c.JSON(http.StatusForbidden, gin.H{"detail": "Admin or Root Admin authorization required for non-user messages"})
			return
		}
	}

	// 3. Content Sanitization and Validation
	content := strings.TrimSpace(body.Content)
	if len(content) == 0 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": "Message content cannot be empty"})
		return
	}
	if len(content) > 2000 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": "Message content exceeds maximum length of 2000 characters"})
		return
	}
	body.Content = content

	ctx := context.Background()
	client, err := getDBFunc(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Internal server error"})
		return
	}

	// 4. Authorization: participant check (user messages and narration events)
	if msgType == MessageTypeUser || isNarration {
		// User messages and narrations require a sender who is a participant
		if strings.TrimSpace(body.SenderProfileID) == "" {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": "sender_profile_id is required for user messages"})
			return
		}
		pcID := fmt.Sprintf("%s_%s", body.SenderProfileID, convID)
		pcSnap, err := client.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(pcID).Get(ctx)
		if err != nil || !pcSnap.Exists() {
			c.JSON(http.StatusForbidden, gin.H{"detail": "Not a participant in this conversation"})
			return
		}
		// Verify caller owns the sender profile
		if !verifyProfileOwnership(auth, body.SenderProfileID, profilesClient) {
			c.JSON(http.StatusForbidden, gin.H{"detail": "Not authorized to send as this profile"})
			return
		}
	}
	// Non-user types (system, event) skip participant validation — admin already verified above

	// 5. Prepare Batch Write for Atomicity
	messageID := uuid.New().String()
	convRef := client.Collection(COLLECTION_CONVERSATIONS).Doc(convID)
	batch := client.Batch()

	// Create Message in sub-collection
	msgData := map[string]interface{}{
		"content":    body.Content,
		"type":       msgType,
		"created_at": firestore.ServerTimestamp,
		"updated_at": firestore.ServerTimestamp,
	}
	if body.SenderProfileID != "" {
		msgData["sent_by"] = body.SenderProfileID
	}
	// Store metadata for event/system messages
	if body.Metadata != nil && msgType != MessageTypeUser {
		msgData["metadata"] = body.Metadata
	}
	batch.Set(convRef.Collection(COLLECTION_MESSAGES).Doc(messageID), msgData)

	// Update denormalized parent fields in Conversation
	convUpdate := map[string]interface{}{
		"updated_at":           firestore.ServerTimestamp,
		"last_message_id":      messageID,
		"last_message_text":    body.Content,
		"last_message_sent_at": firestore.ServerTimestamp,
		"last_message_type":    msgType,
	}
	if body.SenderProfileID != "" {
		convUpdate["last_message_sender_id"] = body.SenderProfileID
	} else {
		convUpdate["last_message_sender_id"] = ""
	}
	batch.Set(convRef, convUpdate, firestore.MergeAll)

	// Clear typing indicator for the sender — they just sent a message.
	// This must be a separate Update (not part of the Set+MergeAll above)
	// so the dot in "typing.<id>" is treated as a nested-path separator.
	if body.SenderProfileID != "" {
		batch.Update(convRef, []firestore.Update{
			{Path: "typing." + body.SenderProfileID, Value: firestore.Delete},
		})
	}

	// Update denormalized updated_at in ProfileConversation mappings for sorting
	convSnap, err := convRef.Get(ctx)
	if err == nil && convSnap.Exists() {
		pids := parseStringSlice(convSnap.Data()["participant_ids"])
		for _, pid := range pids {
			pcID := fmt.Sprintf("%s_%s", pid, convID)
			batch.Update(client.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(pcID), []firestore.Update{
				{Path: "updated_at", Value: firestore.ServerTimestamp},
				{Path: "unread", Value: pid != body.SenderProfileID},
			})
		}
	}

	if _, err := batch.Commit(ctx); err != nil {
		log.Printf("[ERROR] Failed to commit message batch: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Failed to send message"})
		return
	}

	var outMetadata *EventMetadata
	if body.Metadata != nil && msgType != MessageTypeUser {
		outMetadata = body.Metadata
	}

	// 6. Publish message event (fire-and-forget, non-blocking)
	if messagePublisher != nil {
		go func() {
			pubCtx := context.Background()
			metaJson := ""
			if outMetadata != nil {
				b, _ := json.Marshal(outMetadata)
				metaJson = string(b)
			}
			if err := messagePublisher.PublishMessageSent(pubCtx, convID, messageID, body.SenderProfileID, body.Content, msgType, metaJson); err != nil {
				log.Printf("[WARN] Failed to publish message event: %v", err)
			}
		}()
	}

	c.JSON(http.StatusCreated, MessageOut{
		MessageID:       messageID,
		ConversationID:  convID,
		SenderProfileID: body.SenderProfileID,
		Content:         body.Content,
		Type:            msgType,
		SentAt:          _now().Format(time.RFC3339),
		Metadata:        outMetadata,
	})
}

// handleGetMessages godoc
// @Summary      Get messages in a conversation
// @Description  Returns messages in a conversation, sorted by creation time (ascending). Supports optional cursor-based pagination via limit/before/after query params. Without ?limit, returns all messages as a bare array for backwards compatibility.
// @Tags         messages
// @Produce      json
// @Param        id       path   string  true   "Conversation ID"
// @Param        limit    query  int     false  "Max messages to return (1-100, default: all)"
// @Param        before   query  string  false  "Cursor: return messages older than this RFC3339 timestamp"
// @Param        after    query  string  false  "Cursor: return messages newer than this RFC3339 timestamp"
// @Success      200  {object}  PaginatedMessagesResponse  "When ?limit is provided"
// @Failure      500  {object}  map[string]string
// @Security     BearerAuth
// @Router       /conversations/{id}/messages [get]
func handleGetMessages(c *gin.Context) {
	auth := GetAuth(c)
	convID := c.Param("id")
	ctx := context.Background()

	client, err := getDBFunc(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Database error"})
		return
	}

	// Verify caller owns at least one participating profile
	convDoc, err := client.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Get(ctx)
	if err != nil || !convDoc.Exists() {
		c.JSON(http.StatusNotFound, gin.H{"detail": "Conversation not found"})
		return
	}
	// Authorization: caller must provide a profile_id query param that
	// is a participant. The conversation doc confirms participant membership.
	pids := parseStringSlice(convDoc.Data()["participant_ids"])
	callerProfile := c.Query("profile_id")
	if callerProfile == "" {
		if !IsAdmin(auth.Role) {
			c.JSON(http.StatusBadRequest, gin.H{"detail": "profile_id query parameter is required"})
			return
		}
	} else {
		isParticipant := false
		for _, pid := range pids {
			if pid == callerProfile {
				isParticipant = true
				break
			}
		}
		if !isParticipant && !IsAdmin(auth.Role) {
			c.JSON(http.StatusForbidden, gin.H{"detail": "Not authorized to read these messages"})
			return
		}
		if isParticipant {
			// Implicit mark-as-read
			pcID := fmt.Sprintf("%s_%s", callerProfile, convID)
			client.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(pcID).Update(ctx, []firestore.Update{
				{Path: "unread", Value: false},
			})
		}
	}

	// --- Pagination parameters ---
	limitStr := c.Query("limit")
	beforeStr := c.Query("before")
	afterStr := c.Query("after")
	paginated := limitStr != "" // Use paginated envelope only when limit is explicit

	limit := 0
	if paginated {
		limit, err = strconv.Atoi(limitStr)
		if err != nil || limit < 1 {
			limit = 50
		}
		if limit > 100 {
			limit = 100
		}
	}

	// Build the Firestore query
	msgCol := client.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Collection(COLLECTION_MESSAGES)
	var q Query
	needReverse := false // true when we query DESC but want ASC output

	if beforeStr != "" {
		// Load older messages: ORDER BY created_at DESC, StartAfter(beforeTime)
		beforeTime, parseErr := time.Parse(time.RFC3339, beforeStr)
		if parseErr == nil {
			q = msgCol.OrderBy("created_at", firestore.Desc).StartAfter(beforeTime)
			needReverse = true
		}
	} else if afterStr != "" {
		// Load newer messages only (polling optimization)
		afterTime, parseErr := time.Parse(time.RFC3339, afterStr)
		if parseErr == nil {
			q = msgCol.OrderBy("created_at", firestore.Asc).StartAfter(afterTime)
		}
	}

	// Default: no cursor
	if q == nil {
		if paginated {
			// Initial paginated load: get the most recent N messages
			q = msgCol.OrderBy("created_at", firestore.Desc)
			needReverse = true
		} else {
			// Backwards compat: return everything ASC
			q = msgCol.OrderBy("created_at", firestore.Asc)
		}
	}

	// Apply limit (fetch limit+1 to detect has_more)
	fetchLimit := 0
	if paginated {
		fetchLimit = limit + 1
		q = q.Limit(fetchLimit)
	}

	iter := q.Documents(ctx)
	docs, err := iter.GetAll()
	if err != nil {
		log.Printf("[ERROR] Failed to fetch messages for %s: %v", convID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Failed to fetch messages"})
		return
	}

	// Determine has_more from the extra document
	hasMore := false
	if paginated && len(docs) > limit {
		hasMore = true
		docs = docs[:limit] // Trim the extra
	}

	// Reverse if we queried DESC but want ASC output
	if needReverse {
		for i, j := 0, len(docs)-1; i < j; i, j = i+1, j-1 {
			docs[i], docs[j] = docs[j], docs[i]
		}
	}

	results := make([]MessageOut, 0, len(docs))
	for _, doc := range docs {
		d := doc.Data()
		tVal, _ := d["created_at"].(time.Time)

		// Safely extract optional fields — sent_by may be absent for system messages
		senderID, _ := d["sent_by"].(string)
		content, _ := d["content"].(string)
		msgType, _ := d["type"].(string)
		if msgType == "" {
			msgType = MessageTypeUser // Backward compat: existing messages without type are "user"
		}

		// Extract metadata if present
		var metadata *EventMetadata
		if rawMeta, ok := d["metadata"].(map[string]interface{}); ok {
			metadata = &EventMetadata{}
			metadata.EventType, _ = rawMeta["event_type"].(string)
			metadata.InitiatedBy, _ = rawMeta["initiated_by"].(string)
			metadata.Target = parseStringSlice(rawMeta["target"])
			if len(metadata.Target) == 0 {
				metadata.Target = nil
			}
			if innerMeta, ok := rawMeta["metadata"].(map[string]interface{}); ok {
				metadata.Metadata = innerMeta
			}
		}

		results = append(results, MessageOut{
			MessageID:       doc.ID(),
			ConversationID:  convID,
			SenderProfileID: senderID,
			Content:         content,
			Type:            msgType,
			SentAt:          tVal.Format(time.RFC3339),
			Metadata:        metadata,
		})
	}

	// --- Response ---
	if !paginated {
		// Backwards compat: bare array
		if len(results) == 0 {
			c.JSON(http.StatusOK, []MessageOut{})
			return
		}
		c.JSON(http.StatusOK, results)
		return
	}

	// Paginated envelope
	resp := PaginatedMessagesResponse{
		Messages: results,
		HasMore:  hasMore,
	}
	if len(results) > 0 {
		resp.OldestTimestamp = results[0].SentAt
		resp.NewestTimestamp = results[len(results)-1].SentAt
	}

	// Include active typing indicators (TTL-filtered)
	resp.Typing = filterTypingMap(convDoc.Data())

	c.JSON(http.StatusOK, resp)
}

// handleGetConversation godoc
// @Summary      Get conversation details
// @Description  Returns conversation metadata including participants. The caller must own at least one participant profile or be admin.
// @Tags         conversations
// @Produce      json
// @Param        id    path      string  true  "Conversation ID"
// @Success      200   {object}  ConversationOut
// @Failure      403   {object}  ErrorResponse
// @Failure      404   {object}  ErrorResponse
// @Failure      500   {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /conversations/{id} [get]
func handleGetConversation(c *gin.Context) {
	auth := GetAuth(c)
	convID := c.Param("id")
	ctx := context.Background()

	client, err := getDBFunc(ctx)
	if err != nil {
		send500(c, "Database error")
		return
	}

	convDoc, err := client.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Get(ctx)
	if err != nil || !convDoc.Exists() {
		send404(c, "Conversation not found")
		return
	}

	d := convDoc.Data()
	pids := parseStringSlice(d["participant_ids"])

	// Authorization check: participant profile owner or admin
	if !IsAdmin(auth.Role) {
		ownsOne := false
		for _, pid := range pids {
			if verifyProfileOwnership(auth, pid, profilesClient) {
				ownsOne = true
				break
			}
		}
		if !ownsOne {
			send403(c, "Not authorized to view this conversation")
			return
		}
	}

	createdAtT, _ := d["created_at"].(time.Time)
	createdAt := createdAtT.Format(time.RFC3339)
	updatedAtT, _ := d["updated_at"].(time.Time)
	updatedAt := updatedAtT.Format(time.RFC3339)

	var lastMsg *LastMessageInfo
	if mid, ok := d["last_message_id"].(string); ok && mid != "" {
		sentAtT, _ := d["last_message_sent_at"].(time.Time)
		senderID, _ := d["last_message_sender_id"].(string)
		lastMsgType, _ := d["last_message_type"].(string)
		if lastMsgType == "" {
			lastMsgType = MessageTypeUser
		}
		lastMsgText, _ := d["last_message_text"].(string)
		lastMsg = &LastMessageInfo{
			Content:         lastMsgText,
			SentAt:          sentAtT.Format(time.RFC3339),
			SenderProfileID: senderID,
			Type:            lastMsgType,
		}
	}

	convType, _ := d["type"].(string)
	if convType == "" {
		convType = "direct"
	}
	var nameVal *string
	if name, ok := d["name"].(string); ok && name != "" {
		nameVal = &name
	}
	var imageUrlVal *string
	if imageUrl, ok := d["image_url"].(string); ok && imageUrl != "" {
		imageUrlVal = &imageUrl
	}

	c.JSON(http.StatusOK, ConversationOut{
		ID:             convID,
		Type:           convType,
		Name:           nameVal,
		ImageURL:       imageUrlVal,
		ParticipantIDs: pids,
		LastMessage:    lastMsg,
		CreatedAt:      &createdAt,
		UpdatedAt:      &updatedAt,
		Typing:         filterTypingMap(d),
	})
}


// handleListConversations godoc
// @Summary      List conversations for a profile
// @Description  Returns all conversations that include the given profile, sorted by most recent activity.
// @Tags         conversations
// @Produce      json
// @Param        profile_id  path      string  true  "Profile ID"
// @Success      200  {array}   ConversationOut
// @Failure      500  {object}  map[string]string
// @Security     BearerAuth
// @Router       /conversations/profile/{profile_id} [get]
func handleListConversations(c *gin.Context) {
	auth := GetAuth(c)
	profileID := c.Param("profile_id")

	// Verify caller owns this profile
	if !verifyProfileOwnership(auth, profileID, profilesClient) {
		c.JSON(http.StatusForbidden, gin.H{"detail": "Not authorized to view conversations for this profile"})
		return
	}
	ctx := context.Background()

	client, err := getDBFunc(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Database error"})
		return
	}

	// Authorization: the query below naturally scopes to this profile_id.
	// Only conversations where this profile is a participant will be returned.

	// Step 1: Query mappings
	iter := client.Collection(COLLECTION_PROFILE_CONVERSATIONS).Where("profile_id", "==", profileID).Documents(ctx)
	mappings, _ := iter.GetAll()

	if len(mappings) == 0 {
		c.JSON(http.StatusOK, []ConversationOut{})
		return
	}

	convIDs := make([]string, 0, len(mappings))
	unreadMap := make(map[string]bool)
	for _, mDoc := range mappings {
		if cid, ok := mDoc.Data()["conversation_id"].(string); ok && cid != "" {
			convIDs = append(convIDs, cid)
			if unread, ok := mDoc.Data()["unread"].(bool); ok {
				unreadMap[cid] = unread
			}
		}
	}

	if len(convIDs) == 0 {
		c.JSON(http.StatusOK, []ConversationOut{})
		return
	}

	// Build document references for batch get
	refs := make([]DocumentRef, len(convIDs))
	for i, cid := range convIDs {
		refs[i] = client.Collection(COLLECTION_CONVERSATIONS).Doc(cid)
	}

	convDocs, err := client.GetAll(ctx, refs)
	if err != nil {
		log.Printf("[ERROR] Batch conversation GetAll failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Failed to fetch conversations"})
		return
	}

	results := make([]ConversationOut, 0)
	for _, convDoc := range convDocs {
		if convDoc == nil || !convDoc.Exists() {
			continue
		}

		d := convDoc.Data()
		convType, _ := d["type"].(string)
		if convType == "" {
			convType = "direct"
		}

		// Manual hydration
		var lastMsg *LastMessageInfo
		if mid, ok := d["last_message_id"].(string); ok && mid != "" {
			sentAtT, _ := d["last_message_sent_at"].(time.Time)
			senderID, _ := d["last_message_sender_id"].(string)
			lastMsgType, _ := d["last_message_type"].(string)
			if lastMsgType == "" {
				lastMsgType = MessageTypeUser
			}
			lastMsgText, _ := d["last_message_text"].(string)
			lastMsg = &LastMessageInfo{
				Content:         lastMsgText,
				SentAt:          sentAtT.Format(time.RFC3339),
				SenderProfileID: senderID,
				Type:            lastMsgType,
			}
		} else if convType != "group" {
			// Skip empty direct conversations (created but no messages sent yet)
			continue
		}

		createdAtT, _ := d["created_at"].(time.Time)
		createdAt := createdAtT.Format(time.RFC3339)
		updatedAtT, _ := d["updated_at"].(time.Time)
		updatedAt := updatedAtT.Format(time.RFC3339)

		pids := parseStringSlice(d["participant_ids"])

		var otherID *string
		if convType == "direct" {
			for _, pid := range pids {
				if pid != profileID {
					val := pid
					otherID = &val
					break
				}
			}
		}

		var nameVal *string
		if name, ok := d["name"].(string); ok && name != "" {
			nameVal = &name
		}
		var imageUrlVal *string
		if imageUrl, ok := d["image_url"].(string); ok && imageUrl != "" {
			imageUrlVal = &imageUrl
		}

		convID := convDoc.ID()

		results = append(results, ConversationOut{
			ID:             convID,
			Type:           convType,
			Name:           nameVal,
			ImageURL:       imageUrlVal,
			ParticipantIDs: pids,
			OtherProfileID: otherID,
			LastMessage:    lastMsg,
			CreatedAt:      &createdAt,
			UpdatedAt:      &updatedAt,
			Unread:         unreadMap[convID],
			Typing:         filterTypingMap(d),
		})
	}

	sort.Slice(results, func(i, j int) bool {
		t1 := ""
		if results[i].UpdatedAt != nil {
			t1 = *results[i].UpdatedAt
		} else if results[i].CreatedAt != nil {
			t1 = *results[i].CreatedAt
		}

		t2 := ""
		if results[j].UpdatedAt != nil {
			t2 = *results[j].UpdatedAt
		} else if results[j].CreatedAt != nil {
			t2 = *results[j].CreatedAt
		}

		return t1 > t2 // Recent first
	})

	if len(results) == 0 {
		c.JSON(http.StatusOK, []ConversationOut{})
		return
	}

	c.JSON(http.StatusOK, results)
}

// handleListMatches godoc
// @Summary      List matches for a profile
// @Description  Returns matches from the local cache. Use ?new_only=true to exclude matches that already have a started conversation.
// @Tags         matches
// @Produce      json
// @Param        profile_id  path      string  true   "Profile ID"
// @Param        new_only    query     bool    false  "If true, exclude matches that already have conversations"
// @Success      200  {array}   MatchOut
// @Failure      403  {object}  map[string]string
// @Failure      500  {object}  map[string]string
// @Security     BearerAuth
// @Router       /matches/profile/{profile_id} [get]
func handleListMatches(c *gin.Context) {
	auth := GetAuth(c)
	profileID := c.Param("profile_id")

	// Verify caller owns this profile
	if !verifyProfileOwnership(auth, profileID, profilesClient) {
		c.JSON(http.StatusForbidden, gin.H{"detail": "Not authorized to list matches for this profile"})
		return
	}

	ctx := context.Background()
	client, err := getDBFunc(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Database error"})
		return
	}

	// Query discovery_matches_cache where profile_ids array-contains profileID
	iter := client.Collection(COLLECTION_CACHE).Where("profile_ids", "array-contains", profileID).Documents(ctx)
	matchDocs, err := iter.GetAll()
	if err != nil {
		log.Printf("[ERROR] Failed to list matches for profile %s: %v", profileID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Failed to query matches"})
		return
	}

	// Build the set of participants_keys that already have conversations
	// (only when new_only=true)
	newOnly := c.Query("new_only") == "true"
	conversedKeys := map[string]bool{}

	if newOnly {
		pcIter := client.Collection(COLLECTION_PROFILE_CONVERSATIONS).Where("profile_id", "==", profileID).Documents(ctx)
		pcDocs, pcErr := pcIter.GetAll()
		if pcErr == nil && len(pcDocs) > 0 {
			// Batch-get the conversations to extract participants_key
			refs := make([]DocumentRef, 0, len(pcDocs))
			for _, pcDoc := range pcDocs {
				if cid, ok := pcDoc.Data()["conversation_id"].(string); ok && cid != "" {
					refs = append(refs, client.Collection(COLLECTION_CONVERSATIONS).Doc(cid))
				}
			}
			if len(refs) > 0 {
				convDocs, convErr := client.GetAll(ctx, refs)
				if convErr == nil {
					for _, convDoc := range convDocs {
						if convDoc == nil || !convDoc.Exists() {
							continue
						}
						d := convDoc.Data()
						if pk, ok := d["participants_key"].(string); ok && pk != "" {
							conversedKeys[pk] = true
						}
					}
				}
			}
		}
	}

	results := make([]MatchOut, 0, len(matchDocs))
	for _, doc := range matchDocs {
		d := doc.Data()
		profileIDs := parseStringSlice(d["profile_ids"])

		// Compute participants_key for filtering
		if newOnly && len(profileIDs) == 2 {
			sorted := make([]string, len(profileIDs))
			copy(sorted, profileIDs)
			sort.Strings(sorted)
			pk := strings.Join(sorted, "_")
			if conversedKeys[pk] {
				continue // Skip — conversation already exists
			}
		}

		var createdAt string
		if t, ok := d["created_at"].(time.Time); ok {
			createdAt = t.Format(time.RFC3339)
		} else if s, ok := d["created_at"].(string); ok {
			createdAt = s
		}

		matchID, _ := d["match_id"].(string)
		results = append(results, MatchOut{
			ID:        matchID,
			Profiles:  profileIDs,
			CreatedAt: createdAt,
		})
	}

	c.JSON(http.StatusOK, results)
}

// handleDeleteAllMessages godoc
// @Summary      Purge all messaging data
// @Description  Deletes all conversations, messages, and profile-conversation mappings. Admin only.
// @Tags         admin
// @Success      204  "No Content"
// @Failure      403  {object}  map[string]string
// @Failure      500  {object}  map[string]string
// @Security     BearerAuth
// @Router       / [delete]
func handleDeleteAllMessages(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdmin(auth.Role) {
		c.JSON(http.StatusForbidden, gin.H{"detail": "Admin or Root Admin authorization required"})
		return
	}

	ctx := context.Background()
	client, err := getDBFunc(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Database error"})
		return
	}

	// Delete conversations and mappings (L2: Paginated purge)
	collectionsToPurge := []string{
		COLLECTION_CONVERSATIONS,
		COLLECTION_PROFILE_CONVERSATIONS,
		"conversation_dedup",
	}

	for _, collName := range collectionsToPurge {
		if collName == COLLECTION_CONVERSATIONS {
			// For conversations, we need to handle sub-collections manually because DeleteCollection
			// takes a CollectionRef which is tied to a specific parent doc for sub-collections.
			// So we still need to iterate top-level docs if they have sub-collections.
			iter := client.Collection(collName).Documents(ctx)
			for {
				doc, err := iter.Next()
				if err == iterator.Done {
					break
				}
				if err != nil {
					log.Printf("[ERROR] Failed to iterate conversations for purge: %v", err)
					break
				}
				// Purge messages sub-collection
				if err := client.DeleteCollection(ctx, doc.Ref().Collection(COLLECTION_MESSAGES), 500); err != nil {
					log.Printf("[ERROR] Failed to purge messages for conversation %s: %v", doc.ID(), err)
				}
				// Delete the conversation doc
				if _, err := doc.Ref().Delete(ctx); err != nil {
					log.Printf("[ERROR] Failed to delete conversation %s: %v", doc.ID(), err)
				}
			}
		} else {
			// For flat collections, use the helper
			if err := client.DeleteCollection(ctx, client.Collection(collName), 500); err != nil {
				log.Printf("[ERROR] Failed to purge collection %s: %v", collName, err)
			}
		}
	}

	c.Status(http.StatusNoContent)
}

// rollDie generates a cryptographically random roll for the given dice max value.
func rollDie(max int) int {
	n, _ := rand.Int(rand.Reader, big.NewInt(int64(max)))
	return int(n.Int64()) + 1 // 1 to max inclusive
}

// handleRollDice godoc
// @Summary      Roll dice
// @Description  Rolls a die of the specified type. If conversation_id is provided, posts the result as an event message to that conversation. The caller must be a participant in the conversation.
// @Tags         dice
// @Accept       json
// @Produce      json
// @Param        body  body      DiceRollRequest  true  "Dice roll payload"
// @Success      200   {object}  DiceRollResponse
// @Failure      403   {object}  map[string]string
// @Failure      422   {object}  map[string]string
// @Failure      500   {object}  map[string]string
// @Security     BearerAuth
// @Router       /roll-dice [post]
func handleRollDice(c *gin.Context) {
	auth := GetAuth(c)
	var body DiceRollRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": err.Error()})
		return
	}

	// 1. Validate dice type
	diceType := strings.ToLower(strings.TrimSpace(body.DiceType))
	maxVal, ok := ValidDiceTypes[diceType]
	if !ok {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": fmt.Sprintf("Invalid dice type: %s. Must be one of: d4, d6, d8, d12, d20", body.DiceType)})
		return
	}

	// 2. Roll the die
	result := rollDie(maxVal)

	convID := strings.TrimSpace(body.ConversationID)
	profileID := strings.TrimSpace(body.ProfileID)

	// 3. If no conversation, just return the roll
	if convID == "" {
		c.JSON(http.StatusOK, DiceRollResponse{
			DiceType: diceType,
			Result:   result,
		})
		return
	}

	// 4. Conversation mode: validate profile_id is provided
	if profileID == "" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": "profile_id is required when conversation_id is provided"})
		return
	}

	ctx := context.Background()
	client, err := getDBFunc(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Internal server error"})
		return
	}

	// 5. Verify participant exists in the conversation
	pcID := fmt.Sprintf("%s_%s", profileID, convID)
	pcSnap, err := client.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(pcID).Get(ctx)
	if err != nil || !pcSnap.Exists() {
		c.JSON(http.StatusForbidden, gin.H{"detail": "Not a participant in this conversation"})
		return
	}

	// 6. Fetch the profile's display name from the profiles service
	displayName := "An adventurer" // Fallback if profiles service is unavailable
	if profilesClient != nil {
		profile, err := profilesClient.GetProfile(profileID, auth.Token)
		if err != nil {
			log.Printf("[WARN] Failed to fetch profile %s for dice roll: %v", profileID, err)
		} else if profile != nil && profile.DisplayName != "" {
			displayName = profile.DisplayName
		}
	}

	// 7. Post an event message to the conversation
	eventContent := fmt.Sprintf("%s rolled a %d on a %s", displayName, result, diceType)
	eventMetadata := &EventMetadata{
		EventType:   "dice_roll",
		InitiatedBy: profileID,
		Metadata: map[string]interface{}{
			"value":     result,
			"item_name": diceType,
		},
	}
	messageID := uuid.New().String()
	convRef := client.Collection(COLLECTION_CONVERSATIONS).Doc(convID)
	batch := client.Batch()

	batch.Set(convRef.Collection(COLLECTION_MESSAGES).Doc(messageID), map[string]interface{}{
		"content":    eventContent,
		"type":       MessageTypeEvent,
		"sent_by":    profileID,
		"metadata":   eventMetadata,
		"created_at": firestore.ServerTimestamp,
		"updated_at": firestore.ServerTimestamp,
	})

	batch.Set(convRef, map[string]interface{}{
		"updated_at":             firestore.ServerTimestamp,
		"last_message_id":        messageID,
		"last_message_text":      eventContent,
		"last_message_sent_at":   firestore.ServerTimestamp,
		"last_message_sender_id": profileID,
		"last_message_type":      MessageTypeEvent,
	}, firestore.MergeAll)

	// Update denormalized updated_at in ProfileConversation mappings
	convSnap, err := convRef.Get(ctx)
	if err == nil && convSnap.Exists() {
		pids := parseStringSlice(convSnap.Data()["participant_ids"])
		for _, pid := range pids {
			pcID := fmt.Sprintf("%s_%s", pid, convID)
			batch.Update(client.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(pcID), []firestore.Update{
				{Path: "updated_at", Value: firestore.ServerTimestamp},
				{Path: "unread", Value: pid != profileID},
			})
		}
	}

	if _, err := batch.Commit(ctx); err != nil {
		log.Printf("[ERROR] Failed to commit dice roll message batch: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Failed to post dice roll message"})
		return
	}

	// 8. Publish message event (fire-and-forget, non-blocking)
	if messagePublisher != nil {
		go func() {
			pubCtx := context.Background()
			metaJson := ""
			if eventMetadata != nil {
				b, _ := json.Marshal(eventMetadata)
				metaJson = string(b)
			}
			if err := messagePublisher.PublishMessageSent(pubCtx, convID, messageID, profileID, eventContent, MessageTypeEvent, metaJson); err != nil {
				log.Printf("[WARN] Failed to publish dice roll event: %v", err)
			}
		}()
	}

	c.JSON(http.StatusOK, DiceRollResponse{
		DiceType:       diceType,
		Result:         result,
		ConversationID: convID,
		MessageID:      messageID,
	})
}

// typingTTL is how long a typing indicator remains valid.
const typingTTL = 600 * time.Second

// filterTypingMap extracts the "typing" map from a conversation document and
// removes entries older than typingTTL. Returns nil if no active typers.
func filterTypingMap(data map[string]interface{}) map[string]string {
	raw, ok := data["typing"].(map[string]interface{})
	if !ok || len(raw) == 0 {
		return nil
	}

	now := _now()
	result := make(map[string]string)
	for profileID, v := range raw {
		var ts time.Time
		switch t := v.(type) {
		case time.Time:
			ts = t
		case string:
			parsed, err := time.Parse(time.RFC3339, t)
			if err != nil {
				continue
			}
			ts = parsed
		default:
			continue
		}

		if now.Sub(ts) <= typingTTL {
			result[profileID] = ts.Format(time.RFC3339)
		}
	}

	if len(result) == 0 {
		return nil
	}
	return result
}

// handleTyping godoc
// @Summary      Signal typing activity
// @Description  Records that a profile is currently typing in a conversation. The typing state is cleared automatically when a message is sent or after 600 seconds.
// @Tags         conversations
// @Accept       json
// @Param        id    path      string  true  "Conversation ID"
// @Param        body  body      object  true  "Typing payload"  SchemaExample({"profile_id": "abc123"})
// @Success      204   "No Content"
// @Failure      400   {object}  map[string]string
// @Failure      403   {object}  map[string]string
// @Failure      500   {object}  map[string]string
// @Security     BearerAuth
// @Router       /conversations/{id}/typing [post]
func handleTyping(c *gin.Context) {
	auth := GetAuth(c)
	convID := c.Param("id")

	var body struct {
		ProfileID string `json:"profile_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "profile_id is required"})
		return
	}

	ctx := context.Background()
	client, err := getDBFunc(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Internal server error"})
		return
	}

	// Verify caller owns this profile
	if !verifyProfileOwnership(auth, body.ProfileID, profilesClient) {
		c.JSON(http.StatusForbidden, gin.H{"detail": "Not authorized to type as this profile"})
		return
	}

	// Verify participant membership
	pcID := fmt.Sprintf("%s_%s", body.ProfileID, convID)
	pcSnap, err := client.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(pcID).Get(ctx)
	if err != nil || !pcSnap.Exists() {
		c.JSON(http.StatusForbidden, gin.H{"detail": "Not a participant in this conversation"})
		return
	}

	// Update the typing map on the conversation document.
	// Use Update (not Set+MergeAll) so the dot in "typing.<id>" is treated
	// as a nested-path separator, creating typing: {<id>: value}.
	convRef := client.Collection(COLLECTION_CONVERSATIONS).Doc(convID)
	_, err = convRef.Update(ctx, []firestore.Update{
		{Path: "typing." + body.ProfileID, Value: _now().UTC().Format(time.RFC3339)},
	})
	if err != nil {
		log.Printf("[ERROR] Failed to update typing state for %s in %s: %v", body.ProfileID, convID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Failed to update typing state"})
		return
	}

	c.Status(http.StatusNoContent)
}
