package main

import "time"

type ProfileCreate struct {
	DisplayName string       `json:"display_name" binding:"required"`
	Tagline     *string      `json:"tagline"`
	Bio         *string      `json:"bio"`
	ImageURLs   []string     `json:"image_urls"`
	UserID      *string      `json:"user_id"`
	IsActive    bool         `json:"is_active"`
	Age         *int         `json:"age"`
	IsOC        *bool        `json:"is_oc"`
	
	// Categorized tags
	Gender      []ProfileTag `json:"gender"`
	Race        []ProfileTag `json:"race"`
	Fandom      []ProfileTag `json:"fandom"`
	Interests   []ProfileTag `json:"interests"`
	Events      []ProfileTag `json:"events"`
	LookingFor  []ProfileTag `json:"looking_for"`
	
	// OtherTags for dynamic categories
	OtherTags   map[string][]ProfileTag `json:"other_tags"`
}

type ProfileUpdate struct {
	DisplayName *string       `json:"display_name"`
	Tagline     *string       `json:"tagline"`
	Bio         *string       `json:"bio"`
	ImageURLs   *[]string     `json:"image_urls"`
	IsActive    *bool         `json:"is_active"`
	Age         *int          `json:"age"`
	IsOC        *bool         `json:"is_oc"`
	
	// Categorized tags
	Gender      *[]ProfileTag `json:"gender"`
	Race        *[]ProfileTag `json:"race"`
	Fandom      *[]ProfileTag `json:"fandom"`
	Interests   *[]ProfileTag `json:"interests"`
	Events      *[]ProfileTag `json:"events"`
	LookingFor  *[]ProfileTag `json:"looking_for"`
	
	// OtherTags for dynamic categories
	OtherTags   *map[string][]ProfileTag `json:"other_tags"`
}

type ProfileBatchRequest struct {
	ProfileIDs []string `json:"profile_ids" binding:"required"`
}

type ProfileOut struct {
	ProfileID   string       `json:"profile_id"`
	UserID      string       `json:"user_id"`
	DisplayName string       `json:"display_name"`
	Tagline     *string      `json:"tagline"`
	Bio         *string      `json:"bio"`
	ImageURLs   []string     `json:"image_urls"`
	IsActive    bool         `json:"is_active"`
	Age         *int         `json:"age"`
	IsOC        *bool        `json:"is_oc"`
	
	// Categorized tags
	Gender      []ProfileTag `json:"gender"`
	Race        []ProfileTag `json:"race"`
	Fandom      []ProfileTag `json:"fandom"`
	Interests   []ProfileTag `json:"interests"`
	Events      []ProfileTag `json:"events"`
	LookingFor  []ProfileTag `json:"looking_for"`
	
	// OtherTags for dynamic categories
	OtherTags   map[string][]ProfileTag `json:"other_tags,omitempty"`
	
	CreatedAt   *time.Time   `json:"created_at"`
	UpdatedAt   *time.Time   `json:"updated_at"`
}
