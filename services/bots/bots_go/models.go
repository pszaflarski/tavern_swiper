package main

import "time"

// Request Models

type BotCreate struct {
	Slug        string `json:"slug" binding:"required"`
	DisplayName string `json:"display_name,omitempty"`
	Bio         string `json:"bio,omitempty"`
	Tagline     string `json:"tagline,omitempty"`
	// Additional profile fields can be added here
}

// Response Models

type BotOut struct {
	BotID       string    `json:"bot_id"`
	Slug        string    `json:"slug"`
	DisplayName string    `json:"display_name,omitempty"`
	FirebaseUID string    `json:"firebase_uid"`
	Email       string    `json:"email"`
	State       string    `json:"state"`
	CreatedAt   time.Time `json:"created_at"`
}

type CredsResponse struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Note     string `json:"note,omitempty"`
}

type HealthResponse struct {
	Service string `json:"service"`
	Status  string `json:"status"`
}

// Error Models
type ErrorResponse struct {
	Detail interface{} `json:"detail"`
}
