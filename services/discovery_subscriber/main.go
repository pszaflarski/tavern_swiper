package discovery_subscriber

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sync"

	"cloud.google.com/go/firestore"
	"github.com/GoogleCloudPlatform/functions-framework-go/functions"
	"github.com/cloudevents/sdk-go/v2/event"
	"google.golang.org/protobuf/proto"

	pb "tavern-swiper.app/discovery_subscriber/proto"
)

// PubSubMessage is the payload of a Pub/Sub event.
type PubSubMessage struct {
	Message struct {
		Data []byte `json:"data"`
	} `json:"message"`
}

var (
	fsClient    *firestore.Client
	fsOnce      sync.Once
	firestoreDB string
)

func init() {
	// Register the CloudEvent function with the Functions Framework
	functions.CloudEvent("HandleProfileEvent", handleProfileEvent)
}

func getFirestoreClient(ctx context.Context) (*firestore.Client, error) {
	var err error
	fsOnce.Do(func() {
		projectID := getEnv("GOOGLE_CLOUD_PROJECT", "tavern-swiper-dev")
		firestoreDB = getEnv("FIRESTORE_DATABASE_ID", "discovery-dev")
		fsClient, err = firestore.NewClientWithDatabase(ctx, projectID, firestoreDB)
	})
	return fsClient, err
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

// handleProfileEvent consumes a CloudEvent message and updates the Firestore cache.
func handleProfileEvent(ctx context.Context, e event.Event) error {
	log.Printf("📥 CloudEvent Received! ID: %s, Source: %s", e.ID(), e.Source())

	// 1. Try to parse as the nested structure (Eventarc standard)
	var nestedMsg struct {
		Message struct {
			Data []byte `json:"data"`
		} `json:"message"`
	}

	rawJSON := e.Data()
	if err := json.Unmarshal(rawJSON, &nestedMsg); err == nil && len(nestedMsg.Message.Data) > 0 {
		log.Printf("📦 Detected Nested Eventarc Format (found %d bytes)", len(nestedMsg.Message.Data))
		return processSerializedEvent(ctx, nestedMsg.Message.Data)
	}

	// 2. Fallback: Try to parse as flat PubSubMessage (legacy/direct)
	var flatMsg struct {
		Data []byte `json:"data"`
	}
	if err := json.Unmarshal(rawJSON, &flatMsg); err == nil && len(flatMsg.Data) > 0 {
		log.Printf("📦 Detected Flat Pub/Sub Format (found %d bytes)", len(flatMsg.Data))
		return processSerializedEvent(ctx, flatMsg.Data)
	}

	log.Printf("🤔 Warning: Received event data but could not find 'data' field in expected structures. Raw: %s", string(rawJSON))
	return nil
}

func processSerializedEvent(ctx context.Context, data []byte) error {
	var event pb.ProfileEvent
	if err := proto.Unmarshal(data, &event); err != nil {
		log.Printf("❌ proto.Unmarshal Error: %v", err)
		return fmt.Errorf("proto.Unmarshal: %v", err)
	}

	client, err := getFirestoreClient(ctx)
	if err != nil {
		log.Printf("❌ Firestore Initialization Error: %v", err)
		return fmt.Errorf("getFirestoreClient: %v", err)
	}

	return processEvent(ctx, client, &event)
}

func processEvent(ctx context.Context, client *firestore.Client, event *pb.ProfileEvent) error {
	if client == nil {
		log.Printf("⚠️ processEvent: firestore client is nil, skipping database operations")
		return nil
	}
	collection := "profiles_profiles_cache"

	log.Printf("📥 Received Event of type: %s", event.Type)

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
