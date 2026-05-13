package main

import "time"

// Request Models

type BotCreate struct {
	Slug        string `json:"slug" binding:"required"`
	DisplayName string `json:"display_name,omitempty"`
	Bio         string `json:"bio,omitempty"`
	Tagline     string `json:"tagline,omitempty"`
}

// Response Models

type BotOut struct {
	BotID       string    `json:"bot_id"`
	Slug        string    `json:"slug"`
	DisplayName string    `json:"display_name,omitempty"`
	UserID      string    `json:"user_id"`
	FirebaseUID string    `json:"firebase_uid"`
	Email       string    `json:"email"`
	State       string    `json:"state"`
	CreatedAt   time.Time `json:"created_at"`
}

type BotProfileOut struct {
	BotProfileID string    `json:"bot_profile_id"`
	BotUserID    string    `json:"bot_user_id"`
	ProfileID    string    `json:"profile_id"`
	BehaviorType string    `json:"behavior_type,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

type ProfileTag struct {
	ID       string `json:"id"`
	Category string `json:"category"`
	Name     string `json:"name"`
	Slug     string `json:"slug"`
	Status   string `json:"status"`
}

type BotProfileCreate struct {
	DisplayName  string                  `json:"display_name" binding:"required"`
	Tagline      *string                 `json:"tagline"`
	Bio          *string                 `json:"bio"`
	Age          *int                    `json:"age"`
	IsOC         *bool                   `json:"is_oc"`
	ImageLinks   []string                `json:"image_links"`
	BehaviorType string                  `json:"behavior_type,omitempty"` // e.g. "tavern_keeper", "quest_giver"
	Gender       []ProfileTag            `json:"gender"`
	Race         []ProfileTag            `json:"race"`
	Fandom       []ProfileTag            `json:"fandom"`
	Interests    []ProfileTag            `json:"interests"`
	Events       []ProfileTag            `json:"events"`
	LookingFor   []ProfileTag            `json:"looking_for"`
	OtherTags    map[string][]ProfileTag `json:"other_tags"`
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
