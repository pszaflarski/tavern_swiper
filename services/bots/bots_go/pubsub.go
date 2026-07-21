package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"cloud.google.com/go/pubsub"
	"google.golang.org/protobuf/proto"
	pb "tavern-swiper.app/bots_go/proto"
)

type AgentPublisher interface {
	PublishAgentRequest(ctx context.Context, req *pb.AgentRequestEvent) error
}

type RealAgentPublisher struct {
	client  *pubsub.Client
	topicID string
}

func NewAgentPublisher(ctx context.Context) (AgentPublisher, error) {
	projectID := getEnv("PUBSUB_PROJECT_ID", "tavern-swiper-dev")
	env := getEnv("ENV", "dev")
	topicID := os.Getenv("PUBSUB_AGENT_REQUEST_TOPIC_ID")
	if topicID == "" {
		topicID = fmt.Sprintf("%s-bots-agent-request-v1", env)
	}

	if host := os.Getenv("PUBSUB_EMULATOR_HOST"); host != "" {
		log.Printf("[INFO] AgentPublisher using Pub/Sub Emulator at %s", host)
	}

	client, err := pubsub.NewClient(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("failed to create pubsub client for agent requests: %w", err)
	}

	return &RealAgentPublisher{
		client:  client,
		topicID: topicID,
	}, nil
}

func (p *RealAgentPublisher) PublishAgentRequest(ctx context.Context, req *pb.AgentRequestEvent) error {
	topic := p.client.Topic(p.topicID)

	payload, err := proto.Marshal(req)
	if err != nil {
		return fmt.Errorf("failed to marshal AgentRequestEvent proto: %w", err)
	}

	res := topic.Publish(ctx, &pubsub.Message{
		Data: payload,
	})

	_, err = res.Get(ctx)
	if err != nil {
		return fmt.Errorf("pubsub publish AgentRequestEvent error: %w", err)
	}

	log.Printf("[INFO] Published AgentRequestEvent (request_id=%s) to topic %s", req.RequestId, p.topicID)
	return nil
}

type MockAgentPublisher struct {
	PublishedRequests []*pb.AgentRequestEvent
	ShouldError       bool
}

func (m *MockAgentPublisher) PublishAgentRequest(ctx context.Context, req *pb.AgentRequestEvent) error {
	if m.ShouldError {
		return fmt.Errorf("mock pubsub error")
	}
	m.PublishedRequests = append(m.PublishedRequests, req)
	log.Printf("[MOCK] Published AgentRequestEvent request_id=%s to topic", req.RequestId)
	return nil
}
