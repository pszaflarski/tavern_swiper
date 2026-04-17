package main

type MessageCreate struct {
	MatchID         string `json:"match_id" binding:"required"`
	SenderProfileID string `json:"sender_profile_id" binding:"required"`
	Content         string `json:"content" binding:"required"`
}

type MessageOut struct {
	MessageID       string `json:"message_id"`
	MatchID         string `json:"match_id"`
	SenderProfileID string `json:"sender_profile_id"`
	Content         string `json:"content"`
	SentAt          string `json:"sent_at"`
}

type LastMessageInfo struct {
	Content         string `json:"content"`
	SentAt          string `json:"sent_at"`
	SenderProfileID string `json:"sender_profile_id"`
}

type ConversationOut struct {
	MatchID         string           `json:"match_id"`
	OtherProfileID  *string          `json:"other_profile_id"`
	LastMessage     *LastMessageInfo `json:"last_message"`
	CreatedAt       *string          `json:"created_at,omitempty"`
}
