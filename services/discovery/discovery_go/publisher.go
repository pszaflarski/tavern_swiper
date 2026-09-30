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
	discoveryproto "discovery_go/generated"
)

type Publisher interface {
	PublishMatchCreated(matchID string, profileIDs []string, createdAt time.Time) error
}

type realPublisher struct {
	client    *pubsub.Client
	topic     *pubsub.Topic
	projectID string
	topicID   string
	once      sync.Once
	initErr   error
}

// NewPublisher creates a lazy Pub/Sub publisher for discovery events.
// It does NOT open a gRPC connection at construction time — the
// connection is established on the first call to PublishMatchCreated.
func NewPublisher() Publisher {
	projectID := os.Getenv("PUBSUB_PROJECT_ID")
	if projectID == "" {
		projectID = os.Getenv("GOOGLE_CLOUD_PROJECT")
	}
	if projectID == "" {
		projectID = getEnv("PROJECT_ID", "tavern-swiper-dev")
	}
	topicID := os.Getenv("PUBSUB_TOPIC_ID")
	if topicID == "" {
		topicID = "match-events"
	}

	return &realPublisher{
		projectID: projectID,
		topicID:   topicID,
	}
}

// ensureClient initialises the Pub/Sub gRPC client exactly once.
func (p *realPublisher) ensureClient(ctx context.Context) error {
	p.once.Do(func() {
		if host := os.Getenv("PUBSUB_EMULATOR_HOST"); host != "" {
			log.Printf("[INFO] Discovery Publisher using Pub/Sub Emulator at %s", host)
		}

		client, err := pubsub.NewClient(ctx, p.projectID)
		if err != nil {
			p.initErr = fmt.Errorf("failed to create pubsub client: %v", err)
			log.Printf("[ERROR] Lazy Pub/Sub init failed for discovery: %v", p.initErr)
			return
		}

		p.client = client
		p.topic = client.Topic(p.topicID)
		log.Printf("[INFO] Discovery publisher initialized lazily (topic: %s, project: %s)", p.topicID, p.projectID)
	})
	return p.initErr
}

func (p *realPublisher) PublishMatchCreated(matchID string, profileIDs []string, createdAt time.Time) error {
	ctx := context.Background()
	if err := p.ensureClient(ctx); err != nil {
		return fmt.Errorf("pubsub client unavailable: %w", err)
	}

	event := &discoveryproto.MatchEvent{
		Type: discoveryproto.MatchEvent_CREATED,
		Event: &discoveryproto.MatchEvent_Created{
			Created: &discoveryproto.MatchCreated{
				MatchId:    matchID,
				ProfileIds: profileIDs,
				CreatedAt:  createdAt.Format(time.RFC3339),
			},
		},
	}

	data, err := proto.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal match event: %v", err)
	}

	res := p.topic.Publish(ctx, &pubsub.Message{
		Data: data,
	})
	_, err = res.Get(ctx)
	if err != nil {
		return fmt.Errorf("failed to publish match event: %v", err)
	}

	log.Printf("[INFO] Published MatchCreated event: %s", matchID)
	return nil
}

// Mock implementation
type mockPublisher struct {
	PublishedEvents []interface{}
}

func (p *mockPublisher) PublishMatchCreated(matchID string, profileIDs []string, createdAt time.Time) error {
	p.PublishedEvents = append(p.PublishedEvents, matchID)
	return nil
}
