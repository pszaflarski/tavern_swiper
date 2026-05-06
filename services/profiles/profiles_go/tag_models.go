package main

import "time"

// Tag is the full document from the tags collection.
type Tag struct {
	ID          string     `json:"id"`
	Category    string     `json:"category"`
	Name        string     `json:"name"`
	Slug        string     `json:"slug"`
	MultiSelect bool       `json:"multi_select"`
	CreatedAt   *time.Time `json:"created_at"`
	UpdatedAt   *time.Time `json:"updated_at"`
}

// ProfileTag is the denormalized subset embedded on each profile.
type ProfileTag struct {
	ID       string `json:"id"`
	Category string `json:"category"`
	Name     string `json:"name"`
	Slug     string `json:"slug"`
}

// TagCreate is the POST body for creating a tag (admin only).
type TagCreate struct {
	Category    string `json:"category" binding:"required"`
	Name        string `json:"name" binding:"required"`
	Slug        string `json:"slug" binding:"required"`
	MultiSelect *bool  `json:"multi_select"`
}

// TagUpdate is the PUT body for updating a tag (admin only).
type TagUpdate struct {
	Category    *string `json:"category"`
	Name        *string `json:"name"`
	Slug        *string `json:"slug"`
	MultiSelect *bool   `json:"multi_select"`
}

// TagSuggestion is a user-submitted suggestion for a new tag.
type TagSuggestion struct {
	ID        string     `json:"id"`
	Category  string     `json:"category"`
	Name      string     `json:"name"`
	UserID    string     `json:"user_id"`
	CreatedAt *time.Time `json:"created_at"`
}

type TagSuggestionCreate struct {
	Category string `json:"category" binding:"required"`
	Name     string `json:"name" binding:"required"`
}

// TagSearchQuery is used for the autocomplete search endpoint.
type TagSearchQuery struct {
	Category string `json:"category" binding:"required"`
	Name     string `json:"name" binding:"required"` // partial prefix
}

// TagValidateRequest accepts any combination of tag fields to check existence.
type TagValidateRequest struct {
	Category    *string `json:"category"`
	Name        *string `json:"name"`
	Slug        *string `json:"slug"`
	MultiSelect *bool   `json:"multi_select"`
}

type TagValidateResponse struct {
	Valid   bool  `json:"valid"`
	Matches []Tag `json:"matches"`
}
