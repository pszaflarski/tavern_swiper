package main

type DiscoveryProfile struct {
	ProfileID   string              `json:"profile_id"`
	DisplayName string              `json:"display_name"`
	Tagline     *string             `json:"tagline,omitempty"`
	Bio         *string             `json:"bio,omitempty"`
	ImageURLs   []string            `json:"image_urls"`
	Gender      []map[string]string `json:"gender,omitempty"`
	Race        []map[string]string `json:"race,omitempty"`
	Fandom      []map[string]string `json:"fandom,omitempty"`
	Interests   []map[string]string `json:"interests,omitempty"`
	Events      []map[string]string `json:"events,omitempty"`
	LookingFor  []map[string]string `json:"looking_for,omitempty"`
	Age         *int                `json:"age,omitempty"`
	IsOC        *bool               `json:"is_oc,omitempty"`
}

type FeedResponse struct {
	Profiles []DiscoveryProfile `json:"profiles"`
}

type SwipeCreate struct {
	SwiperProfileID string `json:"swiper_profile_id" binding:"required"`
	SwipedProfileID string `json:"swiped_profile_id" binding:"required"`
	Direction       string `json:"direction" binding:"required"`
}

type SwipeOut struct {
	SwipeID         string  `json:"swipe_id"`
	SwiperProfileID string  `json:"swiper_profile_id"`
	SwipedProfileID string  `json:"swiped_profile_id"`
	Direction       string  `json:"direction"`
	CreatedAt       string  `json:"created_at"`
	ID              *string `json:"id"`             // Legacy field name
	MatchID         *string `json:"match_id"`       // New explicit field name
}

type MatchOut struct {
	ID        string   `json:"id"`
	Profiles  []string `json:"profiles"`
	CreatedAt string   `json:"created_at"`
}
