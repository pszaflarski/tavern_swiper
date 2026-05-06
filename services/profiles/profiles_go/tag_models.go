package main

import "time"

// Tag is the full document from the tags collection.
type Tag struct {
	ID          string     `json:"id"`
	Category    string     `json:"category"`
	Name        string     `json:"name"`
	Slug        string     `json:"slug"`
	MultiSelect bool       `json:"multi_select"`
	Status      string     `json:"status"` // "active" or "pending"
	SuggestedBy *string    `json:"suggested_by,omitempty"`
	CreatedAt   *time.Time `json:"created_at"`
	UpdatedAt   *time.Time `json:"updated_at"`
}

// ProfileTag is the denormalized subset embedded on each profile.
type ProfileTag struct {
	ID       string `json:"id"`
	Category string `json:"category"`
	Name     string `json:"name"`
	Slug     string `json:"slug"`
	Status   string `json:"status"`
}

// TagCreate is the POST body for creating a tag.
// Admins may provide a slug; regular users get one auto-generated.
type TagCreate struct {
	Category    string `json:"category" binding:"required"`
	Name        string `json:"name" binding:"required"`
	Slug        string `json:"slug"`
	MultiSelect *bool  `json:"multi_select"`
}

// TagUpdate is the PUT body for updating a tag (admin only).
type TagUpdate struct {
	Category    *string `json:"category"`
	Name        *string `json:"name"`
	Slug        *string `json:"slug"`
	MultiSelect *bool   `json:"multi_select"`
	Status      *string `json:"status"`
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
