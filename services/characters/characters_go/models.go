package main

import "time"

// CharTag is the denormalized tag embedded on character documents.
type CharTag struct {
	ID       string `json:"id" firestore:"id"`
	Category string `json:"category" firestore:"category"`
	Name     string `json:"name" firestore:"name"`
	Slug     string `json:"slug" firestore:"slug"`
}

// CharacterCreate is the POST body for creating a character (admin only).
type CharacterCreate struct {
	DisplayName string    `json:"display_name" binding:"required"`
	Tagline     *string   `json:"tagline"`
	Bio         *string   `json:"bio"`
	Fandom      []CharTag `json:"fandom"`
	Race        []CharTag `json:"race"`
	Gender      []CharTag `json:"gender"`
	ImageIDs    []string  `json:"image_ids"`
}

// CharacterUpdate is the PUT body for updating a character (admin only).
type CharacterUpdate struct {
	DisplayName *string    `json:"display_name"`
	Tagline     *string    `json:"tagline"`
	Bio         *string    `json:"bio"`
	Fandom      *[]CharTag `json:"fandom"`
	Race        *[]CharTag `json:"race"`
	Gender      *[]CharTag `json:"gender"`
	ImageIDs    *[]string  `json:"image_ids"`
}

// CharacterOut is the response/document output with images fully resolved.
type CharacterOut struct {
	CharacterID string     `json:"character_id"`
	DisplayName string     `json:"display_name"`
	Tagline     *string    `json:"tagline"`
	Bio         *string    `json:"bio"`
	Fandom      []CharTag  `json:"fandom"`
	Race        []CharTag  `json:"race"`
	Gender      []CharTag  `json:"gender"`
	Images      []ImageOut `json:"images"`
	CreatedAt   *time.Time `json:"created_at"`
	UpdatedAt   *time.Time `json:"updated_at"`
}

// ImageUpdate is the PUT body for updating image metadata (admin only).
type ImageUpdate struct {
	SourceType   *string `json:"source_type"`
	ArtistHandle *string `json:"artist_handle"`
	ArtistName   *string `json:"artist_name"`
	ArtistLink   *string `json:"artist_link"`
	Position     *int    `json:"position"`
}

// ImageOut is the response/document output for an image.
type ImageOut struct {
	ImageID      string     `json:"image_id"`
	URL          string     `json:"url"`
	SourceType   string     `json:"source_type"`
	CharacterID  string     `json:"character_id"`
	ArtistHandle *string    `json:"artist_handle,omitempty"`
	ArtistName   *string    `json:"artist_name,omitempty"`
	ArtistLink   *string    `json:"artist_link,omitempty"`
	Position     int        `json:"position"`
	CreatedAt    *time.Time `json:"created_at"`
	UpdatedAt    *time.Time `json:"updated_at"`
}

// Tag is the full document from the character_tags collection.
type Tag struct {
	ID           string     `json:"id"`
	Category     string     `json:"category"`
	Name         string     `json:"name"`
	Slug         string     `json:"slug"`
	MultiSelect  bool       `json:"multi_select"`
	Status       string     `json:"status"` // "active" or "pending"
	ParentID     *string    `json:"parent_id,omitempty"`
	DisplayOrder int        `json:"display_order"`
	CreatedAt    *time.Time `json:"created_at"`
	UpdatedAt    *time.Time `json:"updated_at"`
}

// TagTreeNode is the response for tree traversal endpoints.
type TagTreeNode struct {
	Tag
	IsRoot     bool `json:"is_root"`
	ChildCount int  `json:"child_count"`
}

// TagCreate is the POST body for creating a character tag.
type TagCreate struct {
	Category     string  `json:"category" binding:"required"`
	Name         string  `json:"name" binding:"required"`
	Slug         string  `json:"slug"`
	MultiSelect  *bool   `json:"multi_select"`
	ParentID     *string `json:"parent_id"`
	DisplayOrder *int    `json:"display_order"`
}

// TagUpdate is the PUT body for updating a character tag (admin only).
type TagUpdate struct {
	Category     *string `json:"category"`
	Name         *string `json:"name"`
	Slug         *string `json:"slug"`
	MultiSelect  *bool   `json:"multi_select"`
	Status       *string `json:"status"`
	ParentID     *string `json:"parent_id"`
	DisplayOrder *int    `json:"display_order"`
}

// TagSearchQuery is used for the tag autocomplete search endpoint.
type TagSearchQuery struct {
	Category string `json:"category" binding:"required"`
	Name     string `json:"name" binding:"required"` // partial prefix
}

// ProfileValidationRequest represents a profile blob to validate against predefined characters.
type ProfileValidationRequest struct {
	DisplayName string   `json:"display_name" binding:"required"`
	Tagline     *string  `json:"tagline"`
	Bio         *string  `json:"bio"`
	ImageURLs   []string `json:"image_urls"`
}

// ValidationResponse is the response to the validation endpoint.
type ValidationResponse struct {
	IsGenerated bool `json:"is_generated"`
}
