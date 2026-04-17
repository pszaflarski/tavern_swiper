package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"cloud.google.com/go/pubsub"
	"google.golang.org/protobuf/proto"
	pb "tavern-swiper.app/profiles_go/generated"
)

var (
	pubClient *pubsub.Client
	topicID   = getEnv("PUBSUB_TOPIC_ID", "profile-updates")
)

func getPubSubClient(ctx context.Context) (*pubsub.Client, error) {
	if pubClient != nil {
		return pubClient, nil
	}

	projectID := getEnv("PUBSUB_PROJECT_ID", "tavern-swiper-dev")
	
	// Check for emulator
	if host := os.Getenv("PUBSUB_EMULATOR_HOST"); host != "" {
		log.Printf("[INFO] Using Pub/Sub Emulator at %s", host)
	}

	client, err := pubsub.NewClient(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("failed to create pubsub client: %v", err)
	}
	pubClient = client
	return pubClient, nil
}

func publishEvent(ctx context.Context, event *pb.ProfileEvent) {
	client, err := getPubSubClient(ctx)
	if err != nil {
		log.Printf("[ERROR] Pub/Sub client error: %v", err)
		return
	}

	topic := client.Topic(topicID)
	
	payload, err := proto.Marshal(event)
	if err != nil {
		log.Printf("[ERROR] Protobuf marshal error: %v", err)
		return
	}

	res := topic.Publish(ctx, &pubsub.Message{
		Data: payload,
	})

	// We block for result to match Python's future.result() behavior if needed,
	// or just log errors.
	_, err = res.Get(ctx)
	if err != nil {
		log.Printf("[ERROR] Failed to publish event: %v", err)
	} else {
		log.Printf("[INFO] Published event type %v to %s", event.Type, topicID)
	}
}

func PublishUpserted(ctx context.Context, p ProfileOut) {
	event := &pb.ProfileEvent{
		Type: pb.ProfileEvent_UPSERTED,
		Event: &pb.ProfileEvent_Upserted{
			Upserted: &pb.ProfileUpserted{
				ProfileId:   p.ProfileID,
				UserId:      p.UserID,
				DisplayName: p.DisplayName,
				Tagline:     p.Tagline,
				Bio:         p.Bio,
				ImageUrls:   p.ImageURLs,
				Gender:      p.Gender,
				IsActive:    p.IsActive,
			},
		},
	}
	publishEvent(ctx, event)
}

func PublishDeleted(ctx context.Context, profileID string) {
	event := &pb.ProfileEvent{
		Type: pb.ProfileEvent_DELETED,
		Event: &pb.ProfileEvent_Deleted{
			Deleted: &pb.ProfileDeleted{
				ProfileId: profileID,
			},
		},
	}
	publishEvent(ctx, event)
}

func PublishAllDeleted(ctx context.Context, adminUserID string) {
	event := &pb.ProfileEvent{
		Type: pb.ProfileEvent_ALL_DELETED,
		Event: &pb.ProfileEvent_AllDeleted{
			AllDeleted: &pb.AllProfilesDeleted{
				AdminUserId: adminUserID,
				Timestamp:   time.Now().Format(time.RFC3339),
			},
		},
	}
	publishEvent(ctx, event)
}
