package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"google.golang.org/protobuf/proto"

	pb "tavern-swiper.app/notifications_subscriber/proto"
)

func setupTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.Default()
	r.GET("/", func(c *gin.Context) {
		c.String(http.StatusOK, "Notifications Subscriber is running")
	})
	r.POST("/", handlePubSubPush)
	return r
}

func TestHealth(t *testing.T) {
	r := setupTestRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func TestPubSubPush_EmptyData(t *testing.T) {
	r := setupTestRouter()
	w := httptest.NewRecorder()
	body := `{"message":{"data":""},"subscription":"test-sub"}`
	req, _ := http.NewRequest("POST", "/", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200 for empty data, got %d", w.Code)
	}
}

func TestMatchEvent_CREATED(t *testing.T) {
	mock := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mock, nil
	}

	var expoMu sync.Mutex
	var expoReceivedBodies []string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/router/services":
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(fmt.Sprintf(`{"tag": "default", "services": {"profiles": "http://%s", "messages": "http://%s"}}`, r.Host, r.Host)))
		case "/profiles/batch":
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`[
				{"profile_id": "prof_alice", "user_id": "user_alice", "display_name": "Alice"},
				{"profile_id": "prof_bob", "user_id": "user_bob", "display_name": "Bob"}
			]`))
		case "/expo/send":
			buf := new(bytes.Buffer)
			buf.ReadFrom(r.Body)
			expoMu.Lock()
			expoReceivedBodies = append(expoReceivedBodies, buf.String())
			expoMu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"data": [{"status": "ok"}]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	os.Setenv("ROUTER_SERVICE_URL", "http://"+server.Listener.Addr().String())
	os.Setenv("EXPO_PUSH_URL", "http://"+server.Listener.Addr().String()+"/expo/send")
	os.Setenv("JWT_SECRET", "test-secret")
	defer func() {
		os.Unsetenv("ROUTER_SERVICE_URL")
		os.Unsetenv("EXPO_PUSH_URL")
		os.Unsetenv("JWT_SECRET")
	}()

	initServiceURLs()

	// Pre-seed tokens
	mock.Collection(COLLECTION_TOKENS).Doc("TokenBob").Set(context.Background(), map[string]interface{}{
		"token":   "TokenBob",
		"user_id": "user_bob",
	})
	mock.Collection(COLLECTION_TOKENS).Doc("TokenAlice").Set(context.Background(), map[string]interface{}{
		"token":   "TokenAlice",
		"user_id": "user_alice",
	})

	event := &pb.MatchEvent{
		Type: pb.MatchEvent_CREATED,
		Event: &pb.MatchEvent_Created{
			Created: &pb.MatchCreated{
				MatchId:    "match123",
				ProfileIds: []string{"prof_alice", "prof_bob"},
			},
		},
	}

	pbBytes, _ := proto.Marshal(event)
	pushReq := PubSubPushRequest{Subscription: "projects/tavern-swiper-dev/subscriptions/dev-notifications-match-sub"}
	pushReq.Message.Data = pbBytes

	b, _ := json.Marshal(pushReq)
	req, _ := http.NewRequest("POST", "/", bytes.NewBuffer(b))
	req.Header.Set("Content-Type", "application/json")

	r := setupTestRouter()
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	time.Sleep(100 * time.Millisecond)

	expoMu.Lock()
	combinedBody := strings.Join(expoReceivedBodies, " | ")
	expoMu.Unlock()

	if !strings.Contains(combinedBody, "TokenBob") || !strings.Contains(combinedBody, "TokenAlice") {
		t.Errorf("Expected Expo push to contain participant tokens, got: %s", combinedBody)
	}
}

func TestMessageEvent_SENT(t *testing.T) {
	mock := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mock, nil
	}

	var expoMu sync.Mutex
	var expoReceivedBodies []string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/router/services":
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(fmt.Sprintf(`{"tag": "default", "services": {"profiles": "http://%s", "messages": "http://%s"}}`, r.Host, r.Host)))
		case "/profiles/batch":
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`[
				{"profile_id": "prof_alice", "user_id": "user_alice", "display_name": "Alice"},
				{"profile_id": "prof_bob", "user_id": "user_bob", "display_name": "Bob"}
			]`))
		case "/messages/conversations/conv123":
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"id": "conv123", "participant_ids": ["prof_alice", "prof_bob"]}`))
		case "/expo/send":
			buf := new(bytes.Buffer)
			buf.ReadFrom(r.Body)
			expoMu.Lock()
			expoReceivedBodies = append(expoReceivedBodies, buf.String())
			expoMu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"data": [{"status": "ok"}]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	os.Setenv("ROUTER_SERVICE_URL", "http://"+server.Listener.Addr().String())
	os.Setenv("EXPO_PUSH_URL", "http://"+server.Listener.Addr().String()+"/expo/send")
	os.Setenv("JWT_SECRET", "test-secret")
	defer func() {
		os.Unsetenv("ROUTER_SERVICE_URL")
		os.Unsetenv("EXPO_PUSH_URL")
		os.Unsetenv("JWT_SECRET")
	}()

	initServiceURLs()

	mock.Collection(COLLECTION_TOKENS).Doc("TokenBob").Set(context.Background(), map[string]interface{}{
		"token":   "TokenBob",
		"user_id": "user_bob",
	})

	event := &pb.MessageEvent{
		Type: pb.MessageEvent_SENT,
		Event: &pb.MessageEvent_Sent{
			Sent: &pb.MessageSent{
				ConversationId:  "conv123",
				MessageId:       "msg777",
				SenderProfileId: "prof_alice",
				MessagePreview:  "Let's meet at the tavern!",
				MessageType:     "user",
			},
		},
	}

	pbBytes, _ := proto.Marshal(event)
	pushReq := PubSubPushRequest{Subscription: "projects/tavern-swiper-dev/subscriptions/dev-notifications-message-sub"}
	pushReq.Message.Data = pbBytes

	b, _ := json.Marshal(pushReq)
	req, _ := http.NewRequest("POST", "/", bytes.NewBuffer(b))
	req.Header.Set("Content-Type", "application/json")

	r := setupTestRouter()
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	time.Sleep(100 * time.Millisecond)

	expoMu.Lock()
	combinedBody := strings.Join(expoReceivedBodies, " | ")
	expoMu.Unlock()

	if !strings.Contains(combinedBody, "TokenBob") {
		t.Errorf("Expected Expo push to target TokenBob, got: %s", combinedBody)
	}
	if !strings.Contains(combinedBody, "New Message from Alice") {
		t.Errorf("Expected push title with Alice, got: %s", combinedBody)
	}
}
