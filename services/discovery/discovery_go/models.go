package main

type DiscoveryProfile struct {
	ProfileID      string   `json:"profile_id"`
	DisplayName    string   `json:"display_name"`
	Tagline        *string  `json:"tagline"`
	Bio            *string  `json:"bio"`
	Gender         *string  `json:"gender"`
	ImageURLs      []string `json:"image_urls"`
	CharacterClass *string  `json:"character_class"`
	Realm          *string  `json:"realm"`
	Talents        []string `json:"talents"`
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
