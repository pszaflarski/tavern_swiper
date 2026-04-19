package messages_subscriber

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

	pb "tavern-swiper.app/messages_subscriber/proto"
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
	functions.CloudEvent("HandleMatchEvent", handleMatchEvent)
}

func getFirestoreClient(ctx context.Context) (*firestore.Client, error) {
	var err error
	fsOnce.Do(func() {
		projectID := getEnv("GOOGLE_CLOUD_PROJECT", "tavern-swiper-dev")
		firestoreDB = getEnv("FIRESTORE_DATABASE_ID", "messages-dev")
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

// handleMatchEvent consumes a CloudEvent message and updates the Firestore cache.
func handleMatchEvent(ctx context.Context, e event.Event) error {
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
	var event pb.MatchEvent
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

func processEvent(ctx context.Context, client *firestore.Client, event *pb.MatchEvent) error {
	if client == nil {
		log.Printf("⚠️ processEvent: firestore client is nil, skipping database operations")
		return nil
	}
	collection := "discovery_matches_cache"

	log.Printf("📥 Received Event of type: %s", event.Type)

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
