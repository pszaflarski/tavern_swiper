package main

import (
	"context"
	"log"
	"net/http"
	"sort"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const COLLECTION = "messages"

func handleHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"service": "messages", "status": "ok"})
}

func handleSendMessage(c *gin.Context, discoveryClient DiscoveryClient) {
	var body MessageCreate
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"detail": err.Error(), "body": body})
		return
	}

	auth := GetAuth(c)
	ctx := context.Background()

	// _verify_match_access is bypassed in Python, just logs a warning
	log.Printf("[WARNING] Skipping match verification for match_id: %s. Swipes service is offline.", body.MatchID)

	messageID := uuid.New().String()
	now := _now().UTC()
	nowStr := now.Format("2006-01-02T15:04:05Z")

	// Fetch match details from Discovery service
	participants := []string{body.SenderProfileID}
	if match, err := discoveryClient.GetMatch(body.MatchID, auth.Token); err == nil && match != nil {
		participants = match.Profiles
	} else {
		log.Printf("[WARNING] Failed to fetch match participants for conversation indexing: %v. MatchID: %s", err, body.MatchID)
		// If Discovery is down, we don't know the recipient, but we should at least index the sender.
		// However, to ensure the recipient sees it later, we might need a background task or 
		// repair mechanism. For now, we'll proceed with just the sender if Discovery fails.
	}

	client, err := getDBFunc(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Internal server error"})
		return
	}

	data := map[string]interface{}{
		"match_id":                body.MatchID,
		"sender_profile_id":       body.SenderProfileID,
		"content":                 body.Content,
		"sent_at":                 now,
		"participant_profile_ids": participants,
	}

	_, _ = client.Collection(COLLECTION).Doc(messageID).Set(ctx, data)

	c.JSON(http.StatusCreated, MessageOut{
		MessageID:       messageID,
		MatchID:         body.MatchID,
		SenderProfileID: body.SenderProfileID,
		Content:         body.Content,
		SentAt:          nowStr,
	})
}

func handleGetMessages(c *gin.Context) {
	matchID := c.Param("match_id")
	ctx := context.Background()
	
	// Verification skipped
	log.Printf("[WARNING] Skipping match verification for match_id: %s. Swipes service is offline.", matchID)

	client, err := getDBFunc(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Database error"})
		return
	}

	iter := client.Collection(COLLECTION).Where("match_id", "==", matchID).Documents(ctx)
	docs, _ := iter.GetAll()

	type msgContainer struct {
		Out MessageOut
		Time time.Time
	}
	var msgs []msgContainer

	for _, doc := range docs {
		d := doc.Data()
		
		var sentAtStr string
		var t time.Time
		if tVal, ok := d["sent_at"].(time.Time); ok {
			t = tVal
			sentAtStr = tVal.Format("2006-01-02T15:04:05Z")
		} else if sVal, ok := d["sent_at"].(string); ok {
			sentAtStr = sVal
			t, _ = time.Parse(time.RFC3339, sVal)
		}

		m := MessageOut{
			MessageID:       doc.ID(),
			MatchID:         d["match_id"].(string),
			SenderProfileID: d["sender_profile_id"].(string),
			Content:         d["content"].(string),
			SentAt:          sentAtStr,
		}
		msgs = append(msgs, msgContainer{Out: m, Time: t})
	}

	sort.Slice(msgs, func(i, j int) bool {
		return msgs[i].Time.Before(msgs[j].Time)
	})

	results := []MessageOut{}
	for _, cnt := range msgs {
		results = append(results, cnt.Out)
	}

	if len(results) == 0 {
		c.JSON(http.StatusOK, []MessageOut{})
		return
	}

	c.JSON(http.StatusOK, results)
}

func handleListConversations(c *gin.Context, discoveryClient DiscoveryClient) {
	profileID := c.Param("profile_id")
	auth := GetAuth(c)
	ctx := context.Background()

	// 1. Fetch matches
	allMatches, err := discoveryClient.ListMatchesForProfile(profileID, auth.Token)
	if err != nil {
		log.Printf("[WARNING] Failed to fetch matches for conversation listing: %v", err)
	}

	// 2. Query messages
	client, err := getDBFunc(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Database error"})
		return
	}

	iter := client.Collection(COLLECTION).Where("participant_profile_ids", "array_contains", profileID).Documents(ctx)
	docs, _ := iter.GetAll()

	type docContainer struct {
		Data map[string]interface{}
		Time time.Time
	}
	var docCtrs []docContainer

	for _, doc := range docs {
		d := doc.Data()
		var t time.Time
		if tVal, ok := d["sent_at"].(time.Time); ok {
			t = tVal
		} else if sVal, ok := d["sent_at"].(string); ok {
			t, _ = time.Parse(time.RFC3339, sVal)
		}
		docCtrs = append(docCtrs, docContainer{Data: d, Time: t})
	}

	sort.Slice(docCtrs, func(i, j int) bool {
		return docCtrs[i].Time.After(docCtrs[j].Time) // Reverse true
	})

	conversationsMap := make(map[string]*ConversationOut)
	var mapOrder []string

	for _, cnt := range docCtrs {
		d := cnt.Data
		mid := d["match_id"].(string)

		if _, exists := conversationsMap[mid]; !exists {
			var sentAtStr string
			if tVal, ok := d["sent_at"].(time.Time); ok {
				sentAtStr = tVal.Format("2006-01-02T15:04:05-07:00")
			} else {
				sentAtStr = d["sent_at"].(string)
			}

			conversationsMap[mid] = &ConversationOut{
				MatchID: mid,
				LastMessage: &LastMessageInfo{
					Content:         d["content"].(string),
					SentAt:          sentAtStr,
					SenderProfileID: d["sender_profile_id"].(string),
				},
			}
			mapOrder = append(mapOrder, mid)
		}
	}

	for _, match := range allMatches {
		mid := match.ID

		var otherID *string
		for _, p := range match.Profiles {
			if p != profileID {
				val := p
				otherID = &val
				break
			}
		}

		if conv, exists := conversationsMap[mid]; !exists {
			createdAtVal := match.CreatedAt
			conversationsMap[mid] = &ConversationOut{
				MatchID:        mid,
				OtherProfileID: otherID,
				LastMessage:    nil,
				CreatedAt:      &createdAtVal,
			}
			mapOrder = append(mapOrder, mid)
		} else {
			conv.OtherProfileID = otherID
		}
	}

	var results []ConversationOut
	for _, mid := range mapOrder {
		results = append(results, *conversationsMap[mid])
	}

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

	batchSize := 500
	for {
		iter := client.Collection(COLLECTION).Limit(batchSize).Documents(ctx)
		docs, _ := iter.GetAll()
		
		if len(docs) == 0 {
			break
		}

		batch := client.Batch()
		for _, doc := range docs {
			batch.Delete(doc.Ref())
		}
		_, _ = batch.Commit(ctx)
	}

	c.Status(http.StatusNoContent)
}
