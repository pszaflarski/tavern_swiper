package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"cloud.google.com/go/pubsub"
	"google.golang.org/protobuf/proto"
	discoveryproto "discovery_go/generated"
)

type Publisher interface {
	PublishMatchCreated(matchID string, profileIDs []string, createdAt time.Time) error
}

type realPublisher struct {
	client *pubsub.Client
	topic  *pubsub.Topic
}

func NewPublisher() (Publisher, error) {
	projectID := os.Getenv("PUBSUB_PROJECT_ID")
	topicID := os.Getenv("PUBSUB_TOPIC_ID")
	if topicID == "" {
		log.Println("[WARN] PUBSUB_TOPIC_ID not set, defaulting to 'match-events'. Set to '{env}-discovery-match-events-v1' for correctness.")
		topicID = "match-events"
	}

	ctx := context.Background()
	client, err := pubsub.NewClient(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("failed to create pubsub client: %v", err)
	}

	topic := client.Topic(topicID)
	return &realPublisher{client: client, topic: topic}, nil
}

func (p *realPublisher) PublishMatchCreated(matchID string, profileIDs []string, createdAt time.Time) error {
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

	ctx := context.Background()
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
