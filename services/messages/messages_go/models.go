package main

import "time"

const (
	MessageTypeUser   = "user"
	MessageTypeSystem = "system"
	MessageTypeEvent  = "event"
)

// EventMetadata holds structured metadata for event and system messages.
// This allows the frontend to render rich event UIs beyond the plain-text content.
type EventMetadata struct {
	EventType   string                 `json:"event_type"              firestore:"event_type"`              // e.g. "dice_roll", "narration"
	InitiatedBy string                 `json:"initiated_by"            firestore:"initiated_by"`            // profile_id of who triggered the event
	Target      []string               `json:"target,omitempty"         firestore:"target,omitempty"`         // optional target profile_ids
	Metadata    map[string]interface{} `json:"metadata,omitempty"       firestore:"metadata,omitempty"`       // raw mechanical data
}

type MessageCreate struct {
	SenderProfileID string         `json:"sender_profile_id"` // Required for user messages, omitted for system/event
	Content         string         `json:"content" binding:"required"`
	Type            string         `json:"type"`     // "user" (default), "system", "event"
	Metadata        *EventMetadata `json:"metadata,omitempty"` // Optional structured metadata for event/system messages
}

type MessageOut struct {
	MessageID       string         `json:"message_id"`
	ConversationID  string         `json:"conversation_id"`
	SenderProfileID string         `json:"sender_profile_id,omitempty"`
	Content         string         `json:"content"`
	Type            string         `json:"type"`
	SentAt          string         `json:"sent_at"`
	Metadata        *EventMetadata `json:"metadata,omitempty"`
}

// PaginatedMessagesResponse is the envelope returned when the caller
// explicitly requests pagination via the ?limit query parameter.
// Without ?limit, the endpoint returns a bare []MessageOut for backwards compat.
type PaginatedMessagesResponse struct {
	Messages        []MessageOut      `json:"messages"`
	HasMore         bool              `json:"has_more"`
	OldestTimestamp string            `json:"oldest_timestamp,omitempty"`
	NewestTimestamp string            `json:"newest_timestamp,omitempty"`
	Typing          map[string]string `json:"typing,omitempty"`
}

type ConversationCreate struct {
	ParticipantProfileIDs []string `json:"participant_profile_ids" binding:"required,min=2"`
}

type LastMessageInfo struct {
	Content         string `json:"content"`
	SentAt          string `json:"sent_at"`
	SenderProfileID string `json:"sender_profile_id,omitempty"`
	Type            string `json:"type"`
}

type ConversationOut struct {
	ID              string            `json:"id"`
	ParticipantIDs  []string          `json:"participant_ids"`
	OtherProfileID  *string           `json:"other_profile_id,omitempty"`
	LastMessage     *LastMessageInfo  `json:"last_message"`
	CreatedAt       *string           `json:"created_at,omitempty"`
	UpdatedAt       *string           `json:"updated_at,omitempty"`
	Unread          bool              `json:"unread"`
	Typing          map[string]string `json:"typing,omitempty"`
}

// --- New internal Firestore models ---

type Conversation struct {
	ID                  string    `firestore:"id"`
	ParticipantsKey     string    `firestore:"participants_key"`
	ParticipantIDs      []string  `firestore:"participant_ids"`
	CreatedBy           string    `firestore:"created_by"`
	CreatedAt           time.Time `firestore:"created_at"`
	UpdatedAt           time.Time `firestore:"updated_at"`
	LastMessageID       string    `firestore:"last_message_id,omitempty"`
	LastMessageText     string    `firestore:"last_message_text,omitempty"`
	LastMessageSentAt   time.Time `firestore:"last_message_sent_at,omitempty"`
	LastMessageSenderID string    `firestore:"last_message_sender_id,omitempty"`
	LastMessageType     string    `firestore:"last_message_type,omitempty"`
}

type Message struct {
	SentBy    string         `firestore:"sent_by"`
	Content   string         `firestore:"content"`
	Type      string         `firestore:"type"`
	Metadata  *EventMetadata `firestore:"metadata,omitempty"`
	CreatedAt time.Time      `firestore:"created_at"`
	UpdatedAt time.Time      `firestore:"updated_at"`
}

type ProfileConversation struct {
	ProfileID      string `firestore:"profile_id"`
	ConversationID string `firestore:"conversation_id"`
	Role           string `firestore:"role"`
	Unread         bool   `firestore:"unread,omitempty"`
}

// --- Dice Roll models ---

// ValidDiceTypes maps dice type strings to their maximum roll values.
var ValidDiceTypes = map[string]int{
	"d4":  4,
	"d6":  6,
	"d8":  8,
	"d12": 12,
	"d20": 20,
}

type DiceRollRequest struct {
	DiceType       string `json:"type" binding:"required"`         // d4, d6, d8, d12, d20
	ConversationID string `json:"conversation_id"`                 // Optional — if present, posts an event message
	ProfileID      string `json:"profile_id"`                      // Required when conversation_id is set
}

type DiceRollResponse struct {
	DiceType       string `json:"type"`
	Result         int    `json:"result"`
	ConversationID string `json:"conversation_id,omitempty"`
	MessageID      string `json:"message_id,omitempty"` // Set when conversation_id was provided
}

// --- Match models ---

// MatchOut is the response shape for the matches endpoint.
// Mirrors Discovery's MatchOut so the frontend can switch endpoints transparently.
type MatchOut struct {
	ID        string   `json:"id"`
	Profiles  []string `json:"profiles"`
	CreatedAt string   `json:"created_at"`
}

