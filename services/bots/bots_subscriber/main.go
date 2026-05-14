package main

import (
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

	processEvent(&event)
	return nil
}

func processEvent(event *pb.ProfileEvent) {
	log.Printf("📥 Processing ProfileEvent type: %s", event.Type)

	switch event.Type {
	case pb.ProfileEvent_UPSERTED:
		p := event.GetUpserted()
		log.Printf("✨ [UPSERTED] ProfileID: %s, UserID: %s, Name: %s, Images: %d",
			p.ProfileId, p.UserId, p.DisplayName, len(p.ImageUrls))

	case pb.ProfileEvent_DELETED:
		p := event.GetDeleted()
		log.Printf("🗑️ [DELETED] ProfileID: %s", p.ProfileId)

	case pb.ProfileEvent_ALL_DELETED:
		a := event.GetAllDeleted()
		log.Printf("🚨 [ALL_DELETED] AdminUserID: %s", a.AdminUserId)

	default:
		log.Printf("❓ Unknown event type: %s", event.Type)
	}
}
