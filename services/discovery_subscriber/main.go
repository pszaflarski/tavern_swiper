package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sync"

	"cloud.google.com/go/firestore"
	"github.com/GoogleCloudPlatform/functions-framework-go/funcframework"
	"github.com/GoogleCloudPlatform/functions-framework-go/functions"
	"google.golang.org/protobuf/proto"
	"net/http"

	pb "tavern-swiper.app/discovery_subscriber/proto"
)

func main() {
	port := getEnv("PORT", "8080")
	if err := funcframework.StartHostPort("0.0.0.0", port); err != nil {
		log.Fatalf("funcframework.StartHostPort: %v\n", err)
	}
}

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
	// Register the HTTP function with the Functions Framework
	functions.HTTP("HandleProfileEvent", handleProfileEvent)
}

func getFirestoreClient(ctx context.Context) (*firestore.Client, error) {
	var err error
	fsOnce.Do(func() {
		projectID := getEnv("GOOGLE_CLOUD_PROJECT", "tavern-swiper-dev")
		firestoreDB = getEnv("FIRESTORE_DATABASE_ID", "discovery")
		log.Printf("[INFO] Initializing Firestore Client for subscriber: %s, DB: %s", projectID, firestoreDB)
		fsClient, err = firestore.NewClientWithDatabase(ctx, projectID, firestoreDB)
	})
	if fsClient == nil && err == nil {
		// This handles the case where Once.Do finished but fsClient is still nil
		projectID := getEnv("GOOGLE_CLOUD_PROJECT", "tavern-swiper-dev")
		firestoreDB = getEnv("FIRESTORE_DATABASE_ID", "discovery")
		fsClient, err = firestore.NewClientWithDatabase(ctx, projectID, firestoreDB)
	}
	return fsClient, err
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

// handleProfileEvent consumes a Pub/Sub push message (HTTP POST) and updates the Firestore cache.
func handleProfileEvent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log.Printf("📥 HTTP Event Received! Method: %s", r.Method)

	if r.Method != http.MethodPost {
		http.Error(w, "Only POST allowed", http.StatusMethodNotAllowed)
		return
	}

	// Read body for logging and flexible parsing
	var bodyMap map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&bodyMap); err != nil {
		log.Printf("❌ JSON Decode Error: %v", err)
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	log.Printf("📝 Received Body: %+v", bodyMap)

	// In Pub/Sub push, the data is in message.data
	message, ok := bodyMap["message"].(map[string]interface{})
	if !ok {
		log.Printf("🤔 Warning: 'message' field missing or invalid type")
		w.WriteHeader(http.StatusOK)
		return
	}

	dataStr, ok := message["data"].(string)
	if !ok {
		log.Printf("🤔 Warning: 'data' field missing or not a string")
		w.WriteHeader(http.StatusOK)
		return
	}

	log.Printf("📦 Detected Pub/Sub Data String (length %d)", len(dataStr))
	
	// Manual base64 decode if it's a string
	data, err := base64.StdEncoding.DecodeString(dataStr)
	if err != nil {
		log.Printf("❌ Base64 Decode Error: %v", err)
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	if err := processSerializedEvent(ctx, data); err != nil {
		log.Printf("❌ Processing Error: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
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
