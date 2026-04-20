package main

import (
	"context"
	"log"
	"net/http"
	"fmt"
	"sort"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	COLLECTION_MESSAGES              = "messages"
	COLLECTION_CONVERSATIONS         = "conversations"
	COLLECTION_PROFILE_CONVERSATIONS = "profile_conversations"
	COLLECTION_CACHE                 = "discovery_matches_cache"
)

func handleHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"service": "messages", "status": "ok"})
}

func handleCreateConversation(c *gin.Context) {
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

	// 1. Unique check and participant count enforcement
	uniqueMap := make(map[string]bool)
	for _, pid := range body.ParticipantProfileIDs {
		uniqueMap[strings.TrimSpace(pid)] = true
	}

	if len(uniqueMap) != 2 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": "Conversation must have exactly 2 unique participants"})
		return
	}

	// 2. Sort and Join
	pids := make([]string, 0, len(uniqueMap))
	for pid := range uniqueMap {
		pids = append(pids, pid)
	}
	sort.Strings(pids)
	participantsKey := strings.Join(pids, "_")

	// 2. Check for existing conversation with this key
	iter := client.Collection(COLLECTION_CONVERSATIONS).Where("participants_key", "==", participantsKey).Limit(1).Documents(ctx)
	docs, err := iter.GetAll()
	if err == nil && len(docs) > 0 {
		d := docs[0].Data()
		c.JSON(http.StatusOK, gin.H{"conversation_id": d["id"].(string)})
		return
	}

	// 3. Verification step (check match cache for 1-on-1 chats)
	if len(pids) == 2 {
		cacheIter := client.Collection(COLLECTION_CACHE).Where("profile_ids", "array_contains", pids[0]).Documents(ctx)
		cacheDocs, _ := cacheIter.GetAll()

		allowed := false
		for _, cd := range cacheDocs {
			data := cd.Data()
			if pList, ok := data["profile_ids"].([]interface{}); ok {
				hasOther := false
				for _, p := range pList {
					if p.(string) == pids[1] {
						hasOther = true
						break
					}
				}
				if hasOther {
					allowed = true
					break
				}
			}
		}

		if !allowed {
			c.JSON(http.StatusForbidden, gin.H{"detail": "Conversation initialization not permitted (no match found)"})
			return
		}
	}

	// 4. Create new Conversation
	convID := uuid.New().String()
	now := _now().UTC()
	conv := Conversation{
		ID:              convID,
		ParticipantsKey: participantsKey,
		ParticipantIDs:  pids,
		CreatedBy:       pids[0], // Arbitrary for now
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	_, _ = client.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Set(ctx, conv)

	// 5. Create ProfileConversation mappings
	for _, pid := range pids {
		pcID := fmt.Sprintf("%s_%s", pid, convID)
		pc := ProfileConversation{
			ProfileID:      pid,
			ConversationID: convID,
			Role:           "participant",
		}
		_, _ = client.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(pcID).Set(ctx, pc)
	}

	c.JSON(http.StatusCreated, gin.H{"conversation_id": convID})
}

func handleSendMessage(c *gin.Context) {
	convID := c.Param("id")
	var body MessageCreate
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": err.Error()})
		return
	}

	// 1. Content Sanitization and Validation
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

	// Verify participant exists
	pcID := fmt.Sprintf("%s_%s", body.SenderProfileID, convID)
	pcSnap, err := client.Collection(COLLECTION_PROFILE_CONVERSATIONS).Doc(pcID).Get(ctx)
	if err != nil || !pcSnap.Exists() {
		c.JSON(http.StatusForbidden, gin.H{"detail": "Not a participant in this conversation"})
		return
	}

	// Create Message
	messageID := uuid.New().String()
	now := _now().UTC()
	msg := Message{
		SentBy:    body.SenderProfileID,
		Content:   body.Content,
		CreatedAt: now,
		UpdatedAt: now,
	}

	convRef := client.Collection(COLLECTION_CONVERSATIONS).Doc(convID)
	_, _ = convRef.Collection(COLLECTION_MESSAGES).Doc(messageID).Set(ctx, msg)

	// Update denormalized parent fields
	_, _ = convRef.Set(ctx, map[string]interface{}{
		"updated_at":             now,
		"last_message_id":        messageID,
		"last_message_text":      body.Content,
		"last_message_sent_at":   now,
		"last_message_sender_id": body.SenderProfileID,
	}, firestore.MergeAll)

	c.JSON(http.StatusCreated, MessageOut{
		MessageID:       messageID,
		ConversationID:  convID,
		SenderProfileID: body.SenderProfileID,
		Content:         body.Content,
		SentAt:          now.Format(time.RFC3339),
	})
}

func handleGetMessages(c *gin.Context) {
	convID := c.Param("id")
	ctx := context.Background()

	client, err := getDBFunc(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Database error"})
		return
	}

	// Query from sub-collection: conversations/{id}/messages
	iter := client.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Collection(COLLECTION_MESSAGES).Documents(ctx)
	docs, err := iter.GetAll()
	if err != nil {
		log.Printf("[ERROR] Failed to fetch messages for %s: %v", convID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Failed to fetch messages"})
		return
	}

	var results []MessageOut
	for _, doc := range docs {
		d := doc.Data()
		tVal, _ := d["created_at"].(time.Time)

		results = append(results, MessageOut{
			MessageID:       doc.ID(),
			ConversationID:  convID,
			SenderProfileID: d["sent_by"].(string),
			Content:         d["content"].(string),
			SentAt:          tVal.Format(time.RFC3339),
		})
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].SentAt < results[j].SentAt
	})

	if len(results) == 0 {
		c.JSON(http.StatusOK, []MessageOut{})
		return
	}

	c.JSON(http.StatusOK, results)
}

func handleListConversations(c *gin.Context) {
	profileID := c.Param("profile_id")
	ctx := context.Background()

	client, err := getDBFunc(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Database error"})
		return
	}

	// Step 1: Query mappings
	iter := client.Collection(COLLECTION_PROFILE_CONVERSATIONS).Where("profile_id", "==", profileID).Documents(ctx)
	mappings, _ := iter.GetAll()

	var results []ConversationOut
	for _, mDoc := range mappings {
		mapping := mDoc.Data()
		convID := mapping["conversation_id"].(string)

		convDoc, err := client.Collection(COLLECTION_CONVERSATIONS).Doc(convID).Get(ctx)
		if err == nil && convDoc.Exists() {
			d := convDoc.Data()

			var lastMsg *LastMessageInfo
			if mid, ok := d["last_message_id"].(string); ok && mid != "" {
				sentAtT, _ := d["last_message_sent_at"].(time.Time)
				lastMsg = &LastMessageInfo{
					Content:         d["last_message_text"].(string),
					SentAt:          sentAtT.Format(time.RFC3339),
					SenderProfileID: d["last_message_sender_id"].(string),
				}
			}

			createdAtT, _ := d["created_at"].(time.Time)
			createdAt := createdAtT.Format(time.RFC3339)
			updatedAtT, _ := d["updated_at"].(time.Time)
			updatedAt := updatedAtT.Format(time.RFC3339)

			var pids []string
			if rawPIDs, ok := d["participant_ids"].([]interface{}); ok {
				for _, rawPID := range rawPIDs {
					pids = append(pids, rawPID.(string))
				}
			}

			var otherID *string
			for _, pid := range pids {
				if pid != profileID {
					val := pid
					otherID = &val
					break
				}
			}

			results = append(results, ConversationOut{
				ID:             convID,
				ParticipantIDs: pids,
				OtherProfileID: otherID,
				LastMessage:    lastMsg,
				CreatedAt:      &createdAt,
				UpdatedAt:      &updatedAt,
			})
		}
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

	// Delete conversations and mappings
	collectionsToPurge := []string{
		COLLECTION_CONVERSATIONS,
		COLLECTION_PROFILE_CONVERSATIONS,
	}

	for _, collName := range collectionsToPurge {
		iter := client.Collection(collName).Documents(ctx)
		docs, _ := iter.GetAll()

		for _, doc := range docs {
			// If it's a conversation, delete its messages sub-collection first
			if collName == COLLECTION_CONVERSATIONS {
				msgIter := doc.Ref().Collection(COLLECTION_MESSAGES).Documents(ctx)
				msgDocs, _ := msgIter.GetAll()
				if len(msgDocs) > 0 {
					msgBatch := client.Batch()
					for _, mDoc := range msgDocs {
						msgBatch.Delete(mDoc.Ref())
					}
					_, _ = msgBatch.Commit(ctx)
				}
			}
			_, _ = doc.Ref().Delete(ctx)
		}
	}

	c.Status(http.StatusNoContent)
}
