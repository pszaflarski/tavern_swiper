package discovery_subscriber

import (
	"context"
	"fmt"
	"log"
	"os"
	"sync"

	"cloud.google.com/go/firestore"
	"github.com/GoogleCloudPlatform/functions-framework-go/functions"
	"github.com/cloudevents/sdk-go/v2/event"
	"google.golang.org/protobuf/proto"

	pb "discovery_subscriber/proto"
)

// PubSubMessage is the payload of a Pub/Sub event.
type PubSubMessage struct {
	Data []byte `json:"data"`
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
		firestoreDB = getEnv("FIRESTORE_DATABASE_ID", "profiles")
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
	var msg PubSubMessage
	if err := e.DataAs(&msg); err != nil {
		return fmt.Errorf("event.DataAs: %v", err)
	}

	var event pb.ProfileEvent
	if err := proto.Unmarshal(msg.Data, &event); err != nil {
		return fmt.Errorf("proto.Unmarshal: %v", err)
	}

	client, err := getFirestoreClient(ctx)
	if err != nil {
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

	switch event.Type {
	case pb.ProfileEvent_UPSERTED:
		p := event.GetUpserted()
		log.Printf("✨ Processing UPSERTED: [%s] %s", p.ProfileId, p.DisplayName)

		data := map[string]interface{}{
			"profile_id":   p.ProfileId,
			"user_id":      p.UserId,
			"display_name": p.DisplayName,
			"tagline":      p.Tagline,
			"bio":          p.Bio,
			"image_urls":   p.ImageUrls,
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
