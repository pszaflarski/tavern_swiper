package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"google.golang.org/protobuf/proto"

	pb "tavern-swiper.app/bots_subscriber/proto"
)

func setupTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/", func(c *gin.Context) {
		c.String(http.StatusOK, "Bots Subscriber is running")
	})
	r.POST("/", handlePubSubPush)
	return r
}

func TestHealthCheck(t *testing.T) {
	r := setupTestRouter()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}
}

func TestPubSubPush_EmptyData(t *testing.T) {
	r := setupTestRouter()

	payload := PubSubPushRequest{}
	body, _ := json.Marshal(payload)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200 for empty data, got %d", w.Code)
	}
}

func TestPubSubPush_UpsertedEvent(t *testing.T) {
	r := setupTestRouter()

	event := &pb.ProfileEvent{
		Type: pb.ProfileEvent_UPSERTED,
		Event: &pb.ProfileEvent_Upserted{
			Upserted: &pb.ProfileUpserted{
				ProfileId:   "test-profile-id",
				UserId:      "test-user-id",
				DisplayName: "Test Bot",
				ImageUrls:   []string{"https://example.com/img.jpg"},
			},
		},
	}

	data, err := proto.Marshal(event)
	if err != nil {
		t.Fatalf("Failed to marshal proto: %v", err)
	}

	pushMsg := PubSubPushRequest{}
	pushMsg.Message.Data = data
	body, _ := json.Marshal(pushMsg)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}
}

func TestPubSubPush_DeletedEvent(t *testing.T) {
	r := setupTestRouter()

	event := &pb.ProfileEvent{
		Type: pb.ProfileEvent_DELETED,
		Event: &pb.ProfileEvent_Deleted{
			Deleted: &pb.ProfileDeleted{
				ProfileId: "deleted-profile-id",
			},
		},
	}

	data, _ := proto.Marshal(event)
	pushMsg := PubSubPushRequest{}
	pushMsg.Message.Data = data
	body, _ := json.Marshal(pushMsg)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}
}
