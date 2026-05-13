package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"cloud.google.com/go/pubsub"
	"google.golang.org/protobuf/proto"
	pb "messages_go/generated/proto"
)

// MessagePublisher defines the interface for publishing message events.
type MessagePublisher interface {
	PublishMessageSent(ctx context.Context, conversationID, messageID, senderProfileID, content, msgType string) error
}

// RealMessagePublisher publishes events to Pub/Sub.
type RealMessagePublisher struct {
	client  *pubsub.Client
	topicID string
}

// NewMessagePublisher creates a new Pub/Sub publisher for message events.
func NewMessagePublisher(ctx context.Context) (MessagePublisher, error) {
	projectID := getEnv("PUBSUB_PROJECT_ID", "tavern-swiper-dev")
	tID := getEnv("PUBSUB_TOPIC_ID", "dev-messages-message-events-v1")

	if host := os.Getenv("PUBSUB_EMULATOR_HOST"); host != "" {
		log.Printf("[INFO] Using Pub/Sub Emulator at %s", host)
	}

	client, err := pubsub.NewClient(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("failed to create pubsub client: %v", err)
	}

	log.Printf("[INFO] Message publisher initialized (topic: %s, project: %s)", tID, projectID)

	return &RealMessagePublisher{
		client:  client,
		topicID: tID,
	}, nil
}

// truncatePreview truncates content to maxLen characters for the event preview.
func truncatePreview(content string, maxLen int) string {
	if len(content) <= maxLen {
		return content
	}
	return content[:maxLen] + "…"
}

// PublishMessageSent publishes a MESSAGE_SENT event to Pub/Sub.
func (r *RealMessagePublisher) PublishMessageSent(ctx context.Context, conversationID, messageID, senderProfileID, content, msgType string) error {
	event := &pb.MessageEvent{
		Type: pb.MessageEvent_SENT,
		Event: &pb.MessageEvent_Sent{
			Sent: &pb.MessageSent{
				ConversationId:  conversationID,
				MessageId:       messageID,
				SenderProfileId: senderProfileID,
				MessagePreview:  truncatePreview(content, 200),
				MessageType:     msgType,
				Timestamp:       time.Now().UTC().Format(time.RFC3339),
			},
		},
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
		log.Printf("[ERROR] Failed to publish message event: %v", err)
		return fmt.Errorf("pubsub publish error: %w", err)
	}

	log.Printf("[INFO] Published MESSAGE_SENT event for conversation %s (message %s)", conversationID, messageID)
	return nil
}
