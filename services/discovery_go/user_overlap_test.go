package main

import (
	"tavern-swiper.app/firestoreutil"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestUserOverlapInFeed(t *testing.T) {
	skipIfRealDB(t)
	// Mock _now for token stability (matches signGoTestToken time)
	fixedNow := time.Date(2026, 4, 17, 12, 0, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	// Setup
	mockDB := &mockClient{
		collections: make(map[string]*mockCollection),
	}
	getDBFunc = func(ctx context.Context) (firestoreutil.FirestoreClient, error) {
		return mockDB, nil
	}

	userId := "user-123"
	profile1 := "profile-warrior"
	profile2 := "profile-mage"

	// 1. Setup Swiper Profile (Warrior)
	mockDB.Collection(PROFILES_CACHE).Doc(profile1).Set(nil, map[string]interface{}{
		"profile_id": profile1,
		"user_id":    userId,
		"is_active":  true,
	})

	// 2. Setup pipeline mock with Candidate Profile (Mage) - same user_id
	candidateSnaps := []*mockSnap{
		{
			id: profile2,
			data: map[string]interface{}{
				"profile_id":   profile2,
				"user_id":      userId,
				"display_name": "Mage Hero",
				"is_active":    true,
			},
			exists: true,
		},
	}
	oldFeed := getFeedCandidatesFunc
	getFeedCandidatesFunc = mockGetFeedCandidates(candidateSnaps)
	defer func() { getFeedCandidatesFunc = oldFeed }()

	// 3. Execution
	r := setupTest(nil)
	token := signGoTestToken(userId, "user")
	
	req, _ := http.NewRequest("GET", "/discovery/feed/"+profile1, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// 4. Assertions
	assert.Equal(t, http.StatusOK, w.Code)
	
	var resp FeedResponse
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	assert.NoError(t, err)

	// Verify that profile2 (same user) IS in the feed
	found := false
	for _, p := range resp.Profiles {
		if p.ProfileID == profile2 {
			found = true
			break
		}
	}
	assert.True(t, found, "A users own other profile should be visible in their discovery feed")
}

func TestUserOverlapSwipe(t *testing.T) {
	skipIfRealDB(t)
	// Mock _now for token stability
	fixedNow := time.Date(2026, 4, 17, 12, 0, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	// Setup
	mockDB := &mockClient{
		collections: make(map[string]*mockCollection),
	}
	getDBFunc = func(ctx context.Context) (firestoreutil.FirestoreClient, error) {
		return mockDB, nil
	}

	userId := "user-123"
	profile1 := "profile-warrior"
	profile2 := "profile-mage"

	// Setup Swiper
	mockDB.Collection(PROFILES_CACHE).Doc(profile1).Set(nil, map[string]interface{}{
		"profile_id": profile1,
		"user_id":    userId,
		"is_active":  true,
	})

	// Execution: Swipe RIGHT on own other profile
	r := setupTest(nil)
	token := signGoTestToken(userId, "user")
	
	body := SwipeCreate{
		SwiperProfileID: profile1,
		SwipedProfileID: profile2,
		Direction:       "right",
	}
	payload, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", "/discovery/swipe/", bytes.NewBuffer(payload))
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// Assertions
	assert.Equal(t, http.StatusCreated, w.Code)
}
