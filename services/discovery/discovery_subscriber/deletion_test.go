package main

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	pb "tavern-swiper.app/discovery_subscriber/proto"
)

func TestProcessEvent_AllDeleted_PurgesCache(t *testing.T) {
	skipIfRealDB(t)
	ctx := context.Background()

	// Set up a mock client with some pre-existing cached profiles
	mock := &mockClient{}
	cacheCol := mock.Collection("profiles_profiles_cache").(*mockCollection)

	// Seed two docs into the cache
	doc1 := cacheCol.Doc("p1").(*mockDoc)
	doc1.exists = true
	doc1.data = map[string]interface{}{"profile_id": "p1", "display_name": "Hero"}

	doc2 := cacheCol.Doc("p2").(*mockDoc)
	doc2.exists = true
	doc2.data = map[string]interface{}{"profile_id": "p2", "display_name": "Villain"}

	event := &pb.ProfileEvent{
		Type: pb.ProfileEvent_ALL_DELETED,
		Event: &pb.ProfileEvent_AllDeleted{
			AllDeleted: &pb.AllProfilesDeleted{
				AdminUserId: "admin-1",
				Timestamp:   "2026-05-06T12:00:00Z",
			},
		},
	}

	err := processEvent(ctx, mock, event)
	assert.NoError(t, err)

	// Verify DeleteCollection was called
	assert.True(t, mock.deleteCollectionCalled, "DeleteCollection should have been called for ALL_DELETED")
}

func TestProcessEvent_Deleted_RemovesCachedProfile(t *testing.T) {
	skipIfRealDB(t)
	ctx := context.Background()

	// Set up a mock client with a cached profile
	mock := &mockClient{}
	cacheCol := mock.Collection("profiles_profiles_cache").(*mockCollection)

	doc := cacheCol.Doc("p1").(*mockDoc)
	doc.exists = true
	doc.data = map[string]interface{}{"profile_id": "p1", "display_name": "Hero"}

	event := &pb.ProfileEvent{
		Type: pb.ProfileEvent_DELETED,
		Event: &pb.ProfileEvent_Deleted{
			Deleted: &pb.ProfileDeleted{
				ProfileId: "p1",
			},
		},
	}

	err := processEvent(ctx, mock, event)
	assert.NoError(t, err)

	// Verify the doc was deleted
	assert.False(t, doc.exists, "Cached profile should be deleted after DELETED event")
	assert.Nil(t, doc.data, "Cached profile data should be nil after deletion")
}

func TestProcessEvent_Upserted_NoIsActive(t *testing.T) {
	skipIfRealDB(t)
	ctx := context.Background()
	mock := &mockClient{}

	event := &pb.ProfileEvent{
		Type: pb.ProfileEvent_UPSERTED,
		Event: &pb.ProfileEvent_Upserted{
			Upserted: &pb.ProfileUpserted{
				ProfileId:   "p1",
				DisplayName: "Hero",
				IsActive:    true,
			},
		},
	}

	err := processEvent(ctx, mock, event)
	assert.NoError(t, err)

	// Verify Firestore data was written
	doc := mock.Collection("profiles_profiles_cache").Doc("p1").(*mockDoc)
	assert.True(t, doc.exists)
	assert.Equal(t, "Hero", doc.data["display_name"])

	// Verify is_active was NOT written to the cache
	_, hasIsActive := doc.data["is_active"]
	assert.False(t, hasIsActive, "is_active should NOT be written to the discovery cache")
}
