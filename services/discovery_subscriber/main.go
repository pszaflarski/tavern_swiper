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

	pb "tavern-swiper.app/discovery_subscriber/proto"
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
	port := getEnv("PORT", "8007")
	r := gin.Default()

	// Wellness check
	r.GET("/", func(c *gin.Context) {
		c.String(http.StatusOK, "Discovery Subscriber is running")
	})

	// Pub/Sub Push endpoint
	r.POST("/", handlePubSubPush)

	log.Printf("🚀 Discovery Subscriber listening on port %s", port)
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
	var event pb.ProfileEvent
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

func processEvent(ctx context.Context, client FirestoreClient, event *pb.ProfileEvent) error {
	if client == nil {
		log.Printf("⚠️ processEvent: firestore client is nil, skipping database operations")
		return nil
	}
	collection := "profiles_profiles_cache"

	log.Printf("📥 Processing ProfileEvent type: %s", event.Type)

	switch event.Type {
	case pb.ProfileEvent_UPSERTED:
		p := event.GetUpserted()
		log.Printf("✨ Processing UPSERTED for ProfileID: [%s], Name: %s", p.ProfileId, p.DisplayName)

		imageUrls := p.ImageUrls
		if imageUrls == nil {
			imageUrls = []string{}
		}

		data := map[string]interface{}{
			"profile_id":   p.ProfileId,
			"user_id":      p.UserId,
			"display_name": p.DisplayName,
			"tagline":      p.Tagline,
			"bio":          p.Bio,
			"image_urls":   imageUrls,
			"gender":       p.Gender,
			"is_active":    p.IsActive,
			"updated_at":   firestore.ServerTimestamp,
		}

		_, err := client.Collection(collection).Doc(p.ProfileId).Set(ctx, data)
		if err != nil {
			return fmt.Errorf("client.Set: %w", err)
		}

	case pb.ProfileEvent_DELETED:
		p := event.GetDeleted()
		log.Printf("🗑️ Processing DELETED: [%s]", p.ProfileId)

		_, err := client.Collection(collection).Doc(p.ProfileId).Delete(ctx)
		if err != nil {
			return fmt.Errorf("client.Delete: %w", err)
		}

	case pb.ProfileEvent_ALL_DELETED:
		log.Printf("🚨 Processing ALL_DELETED from admin: %s", event.GetAllDeleted().AdminUserId)
		// Admin wipe logic would go here if needed.
	}

	return nil
}
