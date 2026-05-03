package main

import "time"

type MessageCreate struct {
	SenderProfileID string `json:"sender_profile_id" binding:"required"`
	Content         string `json:"content" binding:"required"`
}

type MessageOut struct {
	MessageID       string `json:"message_id"`
	ConversationID  string `json:"conversation_id"`
	SenderProfileID string `json:"sender_profile_id"`
	Content         string `json:"content"`
	SentAt          string `json:"sent_at"`
}

type ConversationCreate struct {
	ParticipantProfileIDs []string `json:"participant_profile_ids" binding:"required,min=2"`
}

type LastMessageInfo struct {
	Content         string `json:"content"`
	SentAt          string `json:"sent_at"`
	SenderProfileID string `json:"sender_profile_id"`
}

type ConversationOut struct {
	ID              string           `json:"id"`
	ParticipantIDs  []string         `json:"participant_ids"`
	OtherProfileID  *string          `json:"other_profile_id,omitempty"`
	LastMessage     *LastMessageInfo `json:"last_message"`
	CreatedAt       *string          `json:"created_at,omitempty"`
	UpdatedAt       *string          `json:"updated_at,omitempty"`
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
}

type Message struct {
	SentBy    string    `firestore:"sent_by"`
	Content   string    `firestore:"content"`
	CreatedAt time.Time `firestore:"created_at"`
	UpdatedAt time.Time `firestore:"updated_at"`
}

type ProfileConversation struct {
	ProfileID      string `firestore:"profile_id"`
	ConversationID string `firestore:"conversation_id"`
	Role           string `firestore:"role"`
}
