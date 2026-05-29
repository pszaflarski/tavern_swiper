package main

import "time"

// Request Models

type BotCreate struct {
	Slug        string `json:"slug" binding:"required"`
	Description string `json:"description,omitempty"` // Internal notes about this bot (not shown in-app)
}

// Response Models

type BotOut struct {
	BotID       string    `json:"bot_id"`
	Slug        string    `json:"slug"`
	Description string    `json:"description,omitempty"` // Internal notes about this bot (not shown in-app)
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
	AgentName    string    `json:"agent_name,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

type BotProfileUpdate struct {
	BehaviorType *string `json:"behavior_type"` // e.g. "tavern_keeper", "quest_giver"
	AgentName    *string `json:"agent_name"`    // e.g. "grogmar"
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
	AgentName    string                  `json:"agent_name,omitempty"`    // e.g. "barkeep-bob-agent"
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

// Behavior Models

type BehaviorTriggerRequest struct {
	BehaviorType string                 `json:"behavior_type,omitempty"`    // optional — if empty, bots_go queries all matching behaviors
	Trigger      string                 `json:"trigger" binding:"required"` // e.g. "profile_created", "profile_deleted"
	Context      map[string]interface{} `json:"context" binding:"required"` // event-specific data
}

type BehaviorTriggerResponse struct {
	Triggered int      `json:"triggered"` // number of bot profiles that acted
	Details   []string `json:"details"`   // per-profile action summaries
}

type BotEvent struct {
	EventID      string                 `json:"event_id" firestore:"event_id"`
	BehaviorType string                 `json:"behavior_type" firestore:"behavior_type"` // Optional, from request
	Trigger      string                 `json:"trigger" firestore:"trigger"`
	Context      map[string]interface{} `json:"context" firestore:"context"`
	Status       string                 `json:"status" firestore:"status"` // "received", "processed", "ignored"
	CreatedAt    time.Time              `json:"created_at" firestore:"created_at"`
}

// Async Agent Callback Models

// AgentCallbackRequest is the payload POSTed by agent_router when async
// processing completes (success or failure).
type AgentCallbackRequest struct {
	RequestID        string                 `json:"request_id"`
	Status           string                 `json:"status"`            // "success" or "error"
	Response         string                 `json:"response,omitempty"`
	Error            string                 `json:"error,omitempty"`
	Detail           string                 `json:"detail,omitempty"`
	ThreadID         string                 `json:"thread_id,omitempty"`
	Agent            string                 `json:"agent,omitempty"`
	Model            string                 `json:"model,omitempty"`
	CallbackMetadata map[string]interface{} `json:"callback_metadata"`
}

// AgentAsyncResponse is the 202 Accepted response from agent_router's
// /invoke-async endpoint.
type AgentAsyncResponse struct {
	Status    string `json:"status"`
	RequestID string `json:"request_id"`
}

