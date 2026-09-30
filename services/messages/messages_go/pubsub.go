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
	pb "messages_go/generated/proto"
)

// MessagePublisher defines the interface for publishing message events.
type MessagePublisher interface {
	PublishMessageSent(ctx context.Context, conversationID, messageID, senderProfileID, content, msgType, metadataJson string) error
}

// RealMessagePublisher publishes events to Pub/Sub.
// The underlying client is initialized lazily on first publish.
type RealMessagePublisher struct {
	client    *pubsub.Client
	topicID   string
	projectID string
	once      sync.Once
	initErr   error
}

// NewMessagePublisher creates a lazy Pub/Sub publisher.
// It does NOT open a gRPC connection at construction time — the
// connection is established on the first call to PublishMessageSent.
func NewMessagePublisher() *RealMessagePublisher {
	return &RealMessagePublisher{
		projectID: getEnv("PUBSUB_PROJECT_ID", "tavern-swiper-dev"),
		topicID:   getEnv("PUBSUB_TOPIC_ID", "dev-messages-message-events-v1"),
	}
}

// ensureClient initialises the Pub/Sub gRPC client exactly once.
func (r *RealMessagePublisher) ensureClient(ctx context.Context) error {
	r.once.Do(func() {
		if host := os.Getenv("PUBSUB_EMULATOR_HOST"); host != "" {
			log.Printf("[INFO] Using Pub/Sub Emulator at %s", host)
		}

		client, err := pubsub.NewClient(ctx, r.projectID)
		if err != nil {
			r.initErr = fmt.Errorf("failed to create pubsub client: %v", err)
			log.Printf("[ERROR] Lazy Pub/Sub init failed: %v", r.initErr)
			return
		}

		r.client = client
		log.Printf("[INFO] Message publisher initialized lazily (topic: %s, project: %s)", r.topicID, r.projectID)
	})
	return r.initErr
}

// truncatePreview truncates content to maxLen characters for the event preview.
func truncatePreview(content string, maxLen int) string {
	if len(content) <= maxLen {
		return content
	}
	return content[:maxLen] + "…"
}

// PublishMessageSent publishes a MESSAGE_SENT event to Pub/Sub.
func (r *RealMessagePublisher) PublishMessageSent(ctx context.Context, conversationID, messageID, senderProfileID, content, msgType, metadataJson string) error {
	if err := r.ensureClient(ctx); err != nil {
		return fmt.Errorf("pubsub client unavailable: %w", err)
	}

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
				MetadataJson:    metadataJson,
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
