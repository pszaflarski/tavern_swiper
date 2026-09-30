package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	"cloud.google.com/go/pubsub"
	"google.golang.org/protobuf/proto"
	pb "tavern-swiper.app/profiles_go/generated"
)

type Publisher interface {
	PublishUpserted(ctx context.Context, p ProfileOut) error
	PublishDeleted(ctx context.Context, profileID string) error
	PublishAllDeleted(ctx context.Context, adminUserID string) error
}

type RealPublisher struct {
	client    *pubsub.Client
	topicID   string
	projectID string
	once      sync.Once
	initErr   error
}

// NewPublisher creates a lazy Pub/Sub publisher for profile events.
// It does NOT open a gRPC connection at construction time — the
// connection is established on the first call to publishEvent.
func NewPublisher() *RealPublisher {
	projectID := getEnv("PUBSUB_PROJECT_ID", "tavern-swiper-dev")
	tID := os.Getenv("PUBSUB_TOPIC_ID")
	if tID == "" {
		log.Println("[WARN] PUBSUB_TOPIC_ID not set, defaulting to 'profile-updates'. Set to '{env}-profiles-profile-events-v1' for correctness.")
		tID = "profile-updates"
	}

	return &RealPublisher{
		projectID: projectID,
		topicID:   tID,
	}
}

// ensureClient initialises the Pub/Sub gRPC client exactly once.
func (r *RealPublisher) ensureClient(ctx context.Context) error {
	r.once.Do(func() {
		if host := os.Getenv("PUBSUB_EMULATOR_HOST"); host != "" {
			log.Printf("[INFO] Using Pub/Sub Emulator at %s", host)
		}

		client, err := pubsub.NewClient(ctx, r.projectID)
		if err != nil {
			r.initErr = fmt.Errorf("failed to create pubsub client: %v", err)
			log.Printf("[ERROR] Lazy Pub/Sub init failed for profiles: %v", r.initErr)
			return
		}

		r.client = client
		log.Printf("[INFO] Profiles publisher initialized lazily (topic: %s, project: %s)", r.topicID, r.projectID)
	})
	return r.initErr
}

func (r *RealPublisher) publishEvent(ctx context.Context, event *pb.ProfileEvent) error {
	if err := r.ensureClient(ctx); err != nil {
		return fmt.Errorf("pubsub client unavailable: %w", err)
	}
	topic := r.client.Topic(r.topicID)

	payload, err := proto.Marshal(event)
	if err != nil {
		log.Printf("[ERROR] Protobuf marshal error: %v", err)
		return fmt.Errorf("protobuf marshal error: %w", err)
	}

	res := topic.Publish(ctx, &pubsub.Message{
		Data: payload,
	})

	_, err = res.Get(ctx)
	if err != nil {
		log.Printf("[ERROR] Failed to publish event: %v", err)
		return fmt.Errorf("pubsub publish error: %w", err)
	} else {
		log.Printf("[INFO] Published event type %v to %s", event.Type, r.topicID)
	}
	return nil
}

func (r *RealPublisher) PublishUpserted(ctx context.Context, p ProfileOut) error {
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
				IsActive:    p.IsActive,
				Age:         toProtoAge(p.Age),
				IsOc:        toProtoIsOc(p.IsOC),
				Gender:      toProtoTags(p.Gender),
				Race:        toProtoTags(p.Race),
				Fandom:      toProtoTags(p.Fandom),
				Interests:   toProtoTags(p.Interests),
				Events:      toProtoTags(p.Events),
				LookingFor:  toProtoTags(p.LookingFor),
				Generated:   p.Generated,
			},
		},
	}
	return r.publishEvent(ctx, event)
}

func toProtoAge(age *int) *int32 {
	if age == nil {
		return nil
	}
	val := int32(*age)
	return &val
}

func toProtoIsOc(isOC *bool) *bool {
	return isOC
}

func toProtoTags(tags []ProfileTag) []*pb.ProfileTag {
	if tags == nil {
		return nil
	}
	res := make([]*pb.ProfileTag, len(tags))
	for i, t := range tags {
		res[i] = &pb.ProfileTag{
			Id:       t.ID,
			Name:     t.Name,
			Slug:     t.Slug,
			Category: t.Category,
		}
	}
	return res
}

func (r *RealPublisher) PublishDeleted(ctx context.Context, profileID string) error {
	event := &pb.ProfileEvent{
		Type: pb.ProfileEvent_DELETED,
		Event: &pb.ProfileEvent_Deleted{
			Deleted: &pb.ProfileDeleted{
				ProfileId: profileID,
			},
		},
	}
	return r.publishEvent(ctx, event)
}

func (r *RealPublisher) PublishAllDeleted(ctx context.Context, adminUserID string) error {
	event := &pb.ProfileEvent{
		Type: pb.ProfileEvent_ALL_DELETED,
		Event: &pb.ProfileEvent_AllDeleted{
			AllDeleted: &pb.AllProfilesDeleted{
				AdminUserId: adminUserID,
				Timestamp:   time.Now().Format(time.RFC3339),
			},
		},
	}
	return r.publishEvent(ctx, event)
}
