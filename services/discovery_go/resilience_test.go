package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"
	"time"
)

func TestHandleGetFeed_MalformedCache(t *testing.T) {
	// Mock _now for token stability
	fixedNow := time.Date(2026, 4, 17, 12, 0, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	mockPub := &mockPublisher{}
	r := setupTest(mockPub)
	
	// Resilience: malformed cache profile (missing profile_id or malformed)
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &mockClient{
			collections: map[string]*mockCollection{
				PROFILES_CACHE: {
					docs: map[string]*mockDoc{ "p1": {id: "p1", exists: true, data: map[string]interface{}{"user_id": "u1", "profile_id": "p1"}}},
					queryRes: []*mockSnap{
						{id: "p-bad", exists: true, data: map[string]interface{}{"display_name": "Ghost", "is_active": true}}, // MISSING profile_id
						{id: "p2", exists: true, data: map[string]interface{}{"profile_id": "p2", "user_id": "u2", "display_name": "Legolas", "is_active": true}},
					},
				},
			},
		}, nil
	}
	
	req, _ := http.NewRequest("GET", "/discovery/feed/p1", nil)
	req.Header.Set("Authorization", "Bearer "+signGoTestToken("u1", "user"))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200 for malformed cache, got %d: %s", w.Code, w.Body.String())
	}
	
	var resp FeedResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if len(resp.Profiles) != 1 {
		t.Errorf("Expected 1 profile (Legolas), got %d", len(resp.Profiles))
	}
}

func TestHandleListMatches_MalformedMatch(t *testing.T) {
	// Mock _now for token stability
	fixedNow := time.Date(2026, 4, 17, 12, 0, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	mockPub := &mockPublisher{}
	r := setupTest(mockPub)
	
	// Resilience: malformed match doc (missing id)
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &mockClient{
			collections: map[string]*mockCollection{
				MATCHES_COLLECTION: {
					queryRes: []*mockSnap{
						{
							id: "match-bad",
							exists: true,
							data: map[string]interface{}{
								"profiles": []interface{}{"p1", "p3"},
								// MISSING id
							},
						},
					},
				},
			},
		}, nil
	}
	
	req, _ := http.NewRequest("GET", "/discovery/matches/profile/p1", nil)
	req.Header.Set("Authorization", "Bearer "+signGoTestToken("u1", "user"))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200 for malformed match, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDiscoveryResilience_SwipeMatchDetection(t *testing.T) {
	fixedNow := time.Date(2026, 4, 17, 12, 0, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	mockPub := &mockPublisher{}
	r := setupTest(mockPub)

	// Swipe P1 -> P2 (Right)
	// We need a reciprocal swipe P2 -> P1 (Right) already in DB
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		mClient := &mockClient{
			collections: map[string]*mockCollection{
				PROFILES_CACHE: {
					docs: map[string]*mockDoc{
						"p1": {id: "p1", exists: true, data: map[string]interface{}{"user_id": "u1", "profile_id": "p1"}},
					},
				},
				SWIPES_COLLECTION: {
					queryRes: []*mockSnap{
						{id: "s-old", exists: true, data: map[string]interface{}{"swiper_profile_id": "p2", "swiped_profile_id": "p1", "direction": "right"}},
					},
				},
				MATCHES_COLLECTION: {
					docs: make(map[string]*mockDoc),
				},
			},
		}
		return mClient, nil
	}

	payload := map[string]interface{}{
		"swiper_profile_id": "p1",
		"swiped_profile_id": "p2",
		"direction":         "right",
	}
	jsonBody, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "/discovery/swipe/", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+signGoTestToken("u1", "user"))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("Expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp SwipeOut
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.MatchID == nil {
		t.Errorf("Expected MatchID to be non-nil")
	} else {
		expectedMatchID := "match_p1_p2"
		ids := []string{"p1", "p2"}
		sort.Strings(ids)
		expectedMatchID = fmt.Sprintf("match_%s_%s", ids[0], ids[1])
		if *resp.MatchID != expectedMatchID {
			t.Errorf("Expected MatchID %s, got %s", expectedMatchID, *resp.MatchID)
		}
	}

	if len(mockPub.PublishedEvents) != 1 {
		t.Errorf("Expected 1 published event, got %d", len(mockPub.PublishedEvents))
	}
}

func TestDiscoveryResilience_FeedExclusions(t *testing.T) {
	fixedNow := time.Date(2026, 4, 17, 12, 0, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	mockPub := &mockPublisher{}
	r := setupTest(mockPub)

	// User P1
	// Swiped P2 already
	// Candidate P3 available
	// Candidate P1 (Self) - should be excluded
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &mockClient{
			collections: map[string]*mockCollection{
				PROFILES_CACHE: {
					docs: map[string]*mockDoc{
						"p1": {id: "p1", exists: true, data: map[string]interface{}{"user_id": "u1", "profile_id": "p1"}},
					},
					queryRes: []*mockSnap{
						{id: "p1", exists: true, data: map[string]interface{}{"profile_id": "p1", "user_id": "u1", "display_name": "Me", "is_active": true}},
						{id: "p2", exists: true, data: map[string]interface{}{"profile_id": "p2", "user_id": "u2", "display_name": "Swiped", "is_active": true}},
						{id: "p3", exists: true, data: map[string]interface{}{"profile_id": "p3", "user_id": "u3", "display_name": "Candidate", "is_active": true}},
					},
				},
				SWIPES_COLLECTION: {
					queryRes: []*mockSnap{
						{id: "s1", exists: true, data: map[string]interface{}{"swiper_profile_id": "p1", "swiped_profile_id": "p2", "direction": "right"}},
					},
				},
			},
		}, nil
	}

	req, _ := http.NewRequest("GET", "/discovery/feed/p1", nil)
	req.Header.Set("Authorization", "Bearer "+signGoTestToken("u1", "user"))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}

	var resp FeedResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	
	// Should only have P3
	if len(resp.Profiles) != 1 {
		t.Errorf("Expected 1 candidate (P3), got %d", len(resp.Profiles))
	} else if resp.Profiles[0].ProfileID != "p3" {
		t.Errorf("Expected candidate P3, got %s", resp.Profiles[0].ProfileID)
	}
}
