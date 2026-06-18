package discovery_worker_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"tavern-swiper.app/discovery_worker"
)

func TestHandleCleanup_Success(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)

	// Create mock database
	mock := &discovery_worker.MockClient{
		Collections: make(map[string]*discovery_worker.MockCollection),
	}

	// Override GetDBFunc
	origGetDBFunc := discovery_worker.GetDBFunc
	discovery_worker.GetDBFunc = func(ctx context.Context) (discovery_worker.FirestoreClient, error) {
		return mock, nil
	}
	defer func() { discovery_worker.GetDBFunc = origGetDBFunc }()

	// Seed data
	col := mock.Collection(discovery_worker.SwipesCollection).(*discovery_worker.MockCollection)
	
	// Doc 1: Expired left swipe (should be queried and deleted)
	doc1 := col.Doc("swipe-expired-left").(*discovery_worker.MockDoc)
	doc1.DataVal = map[string]interface{}{
		"swiper_profile_id": "profile-1",
		"swiped_profile_id": "profile-2",
		"direction":         "left",
		"created_at":        time.Now().UTC().Add(-30 * time.Hour),
	}
	doc1.ExistsVal = true

	// Doc 2: Unexpired left swipe (should NOT be queried)
	doc2 := col.Doc("swipe-recent-left").(*discovery_worker.MockDoc)
	doc2.DataVal = map[string]interface{}{
		"swiper_profile_id": "profile-1",
		"swiped_profile_id": "profile-3",
		"direction":         "left",
		"created_at":        time.Now().UTC().Add(-10 * time.Hour),
	}
	doc2.ExistsVal = true

	// Doc 3: Expired right swipe (should NOT be queried)
	doc3 := col.Doc("swipe-expired-right").(*discovery_worker.MockDoc)
	doc3.DataVal = map[string]interface{}{
		"swiper_profile_id": "profile-1",
		"swiped_profile_id": "profile-4",
		"direction":         "right",
		"created_at":        time.Now().UTC().Add(-30 * time.Hour),
	}
	doc3.ExistsVal = true

	// Configure mock query to only return the expired left swipe (simulating Firestore filter)
	col.QueryVal = &discovery_worker.MockQuery{
		Col: col,
		Docs: []discovery_worker.DocumentSnapshot{
			&discovery_worker.MockSnap{IdVal: doc1.Id, DataValue: doc1.DataVal, ExistsFlag: doc1.ExistsVal, RefVal: doc1},
		},
	}

	// Trigger handler
	r := gin.New()
	r.POST("/cleanup", discovery_worker.HandleCleanup)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/cleanup", nil)
	r.ServeHTTP(w, req)

	// Assert response
	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	assert.NoError(t, err)
	assert.Equal(t, "success", resp["status"])
	assert.Equal(t, float64(1), resp["deleted_count"]) // json numbers unmarshal to float64

	// Assertions on the mock DB state
	assert.False(t, doc1.ExistsVal) // doc1 should be deleted
	assert.True(t, doc2.ExistsVal)  // doc2 should remain
	assert.True(t, doc3.ExistsVal)  // doc3 should remain

	// Assert query structure
	assert.Len(t, col.QueryVal.Wheres, 2)
	assert.Equal(t, "direction", col.QueryVal.Wheres[0].Path)
	assert.Equal(t, "==", col.QueryVal.Wheres[0].Op)
	assert.Equal(t, "left", col.QueryVal.Wheres[0].Value)

	assert.Equal(t, "created_at", col.QueryVal.Wheres[1].Path)
	assert.Equal(t, "<", col.QueryVal.Wheres[1].Op)
	
	// The cutoff time should be roughly 24 hours ago (default)
	cutoffVal := col.QueryVal.Wheres[1].Value.(time.Time)
	assert.WithinDuration(t, time.Now().UTC().Add(-24*time.Hour), cutoffVal, 2*time.Second)
}

func TestHandleCleanup_ConfigurableTTL(t *testing.T) {
	skipIfRealDB(t)
	gin.SetMode(gin.TestMode)

	// Set custom TTL config in env
	os.Setenv("CLEANUP_TTL_HOURS", "12")
	defer os.Unsetenv("CLEANUP_TTL_HOURS")

	// Create mock database
	mock := &discovery_worker.MockClient{
		Collections: make(map[string]*discovery_worker.MockCollection),
	}

	// Override GetDBFunc
	origGetDBFunc := discovery_worker.GetDBFunc
	discovery_worker.GetDBFunc = func(ctx context.Context) (discovery_worker.FirestoreClient, error) {
		return mock, nil
	}
	defer func() { discovery_worker.GetDBFunc = origGetDBFunc }()

	col := mock.Collection(discovery_worker.SwipesCollection).(*discovery_worker.MockCollection)
	col.QueryVal = &discovery_worker.MockQuery{
		Col:  col,
		Docs: []discovery_worker.DocumentSnapshot{},
	}

	// Trigger handler
	r := gin.New()
	r.POST("/cleanup", discovery_worker.HandleCleanup)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/cleanup", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	// Assert query structure and custom TTL value (12 hours)
	assert.Len(t, col.QueryVal.Wheres, 2)
	assert.Equal(t, "created_at", col.QueryVal.Wheres[1].Path)
	assert.Equal(t, "<", col.QueryVal.Wheres[1].Op)

	cutoffVal := col.QueryVal.Wheres[1].Value.(time.Time)
	assert.WithinDuration(t, time.Now().UTC().Add(-12*time.Hour), cutoffVal, 2*time.Second)
}
