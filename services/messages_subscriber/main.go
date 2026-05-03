package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"

	"cloud.google.com/go/firestore"
	"github.com/gin-gonic/gin"
	"google.golang.org/protobuf/proto"

	"tavern-swiper.app/firestoreutil"
	pb "tavern-swiper.app/messages_subscriber/proto"
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

	// Wellness check
	r.GET("/", func(c *gin.Context) {
		c.String(http.StatusOK, "Messages Subscriber is running")
	})

	// Pub/Sub Push endpoint
	r.POST("/", handlePubSubPush)

	log.Printf("🚀 Messages Subscriber listening on port %s", port)
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

	if err := processSerializedEvent(c.Request.Context(), pushMsg.Message.Data); err != nil {
		log.Printf("❌ Failed to process event: %v", err)
		// We can return 500 here if we want Pub/Sub to retry
		c.Status(http.StatusInternalServerError)
		return
	}

	c.Status(http.StatusOK)
}

func processSerializedEvent(ctx context.Context, data []byte) error {
	var event pb.MatchEvent
	if err := proto.Unmarshal(data, &event); err != nil {
		log.Printf("❌ proto.Unmarshal Error: %v", err)
		return fmt.Errorf("proto.Unmarshal: %v", err)
	}

	client, err := getDBFunc(ctx)
	if err != nil {
		log.Printf("❌ Firestore Initialization Error: %v", err)
		return fmt.Errorf("getDBFunc: %v", err)
	}

	return processEvent(ctx, client, &event)
}

func processEvent(ctx context.Context, client firestoreutil.FirestoreClient, event *pb.MatchEvent) error {
	if client == nil {
		log.Printf("⚠️ processEvent: firestore client is nil, skipping database operations")
		return nil
	}
	collection := "discovery_matches_cache"

	log.Printf("📥 Processing MatchEvent type: %s", event.Type)

	switch event.Type {
	case pb.MatchEvent_CREATED:
		m := event.GetCreated()
		log.Printf("✨ Processing CREATED for MatchID: [%s]", m.MatchId)

		data := map[string]interface{}{
			"match_id":    m.MatchId,
			"profile_ids": m.ProfileIds,
			"created_at":  m.CreatedAt,
			"updated_at":  firestore.ServerTimestamp,
		}

		_, err := client.Collection(collection).Doc(m.MatchId).Set(ctx, data)
		if err != nil {
			return fmt.Errorf("client.Set: %w", err)
		}

	case pb.MatchEvent_DELETED:
		m := event.GetDeleted()
		log.Printf("🗑️ Processing DELETED: [%s]", m.MatchId)

		_, err := client.Collection(collection).Doc(m.MatchId).Delete(ctx)
		if err != nil {
			return fmt.Errorf("client.Delete: %w", err)
		}
	}

	return nil
}
