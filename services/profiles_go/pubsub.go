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

type Publisher interface {
	PublishUpserted(ctx context.Context, p ProfileOut)
	PublishDeleted(ctx context.Context, profileID string)
	PublishAllDeleted(ctx context.Context, adminUserID string)
}

type RealPublisher struct {
	client  *pubsub.Client
	topicID string
}

func NewPublisher(ctx context.Context) (Publisher, error) {
	projectID := getEnv("PUBSUB_PROJECT_ID", "tavern-swiper-dev")
	tID := getEnv("PUBSUB_TOPIC_ID", "profile-updates")

	// Check for emulator
	if host := os.Getenv("PUBSUB_EMULATOR_HOST"); host != "" {
		log.Printf("[INFO] Using Pub/Sub Emulator at %s", host)
	}

	client, err := pubsub.NewClient(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("failed to create pubsub client: %v", err)
	}

	return &RealPublisher{
		client:  client,
		topicID: tID,
	}, nil
}

func (r *RealPublisher) publishEvent(ctx context.Context, event *pb.ProfileEvent) {
	topic := r.client.Topic(r.topicID)
	
	payload, err := proto.Marshal(event)
	if err != nil {
		log.Printf("[ERROR] Protobuf marshal error: %v", err)
		return
	}

	res := topic.Publish(ctx, &pubsub.Message{
		Data: payload,
	})

	_, err = res.Get(ctx)
	if err != nil {
		log.Printf("[ERROR] Failed to publish event: %v", err)
	} else {
		log.Printf("[INFO] Published event type %v to %s", event.Type, r.topicID)
	}
}

func (r *RealPublisher) PublishUpserted(ctx context.Context, p ProfileOut) {
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
	r.publishEvent(ctx, event)
}

func (r *RealPublisher) PublishDeleted(ctx context.Context, profileID string) {
	event := &pb.ProfileEvent{
		Type: pb.ProfileEvent_DELETED,
		Event: &pb.ProfileEvent_Deleted{
			Deleted: &pb.ProfileDeleted{
				ProfileId: profileID,
			},
		},
	}
	r.publishEvent(ctx, event)
}

func (r *RealPublisher) PublishAllDeleted(ctx context.Context, adminUserID string) {
	event := &pb.ProfileEvent{
		Type: pb.ProfileEvent_ALL_DELETED,
		Event: &pb.ProfileEvent_AllDeleted{
			AllDeleted: &pb.AllProfilesDeleted{
				AdminUserId: adminUserID,
				Timestamp:   time.Now().Format(time.RFC3339),
			},
		},
	}
	r.publishEvent(ctx, event)
}
