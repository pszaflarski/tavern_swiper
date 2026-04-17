package main

type ProfileCreate struct {
	DisplayName string   `json:"display_name" binding:"required"`
	Tagline     *string  `json:"tagline"`
	Bio         *string  `json:"bio"`
	Gender      *string  `json:"gender"`
	ImageURLs   []string `json:"image_urls"`
	UserID      *string  `json:"user_id"`
	IsActive    bool     `json:"is_active"`
}

type ProfileUpdate struct {
	DisplayName *string   `json:"display_name"`
	Tagline     *string   `json:"tagline"`
	Bio         *string   `json:"bio"`
	Gender      *string   `json:"gender"`
	ImageURLs   *[]string `json:"image_urls"`
	IsActive    *bool     `json:"is_active"`
}

type ProfileBatchRequest struct {
	ProfileIDs []string `json:"profile_ids" binding:"required"`
}

type ProfileOut struct {
	ProfileID   string   `json:"profile_id"`
	UserID      string   `json:"user_id"`
	DisplayName string   `json:"display_name"`
	Tagline     *string  `json:"tagline"`
	Bio         *string  `json:"bio"`
	Gender      *string  `json:"gender"`
	ImageURLs   []string `json:"image_urls"`
	IsActive    bool     `json:"is_active"`
}
