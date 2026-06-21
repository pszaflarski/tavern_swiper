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
	"github.com/golang-jwt/jwt/v5"
	"google.golang.org/protobuf/proto"

	pb "notifications_go/proto"
)

func setupTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.Default()
	r.GET("/notifications/health", handleHealth)
	r.Use(AuthMiddleware())

	n := r.Group("/notifications")
	{
		n.POST("/tokens", handleRegisterToken)
		n.DELETE("/tokens/:token", handleUnregisterToken)
		n.POST("/subscribers/matches", handlePubSubMatchEvent)
		n.POST("/subscribers/messages", handlePubSubMessageEvent)
	}
	return r
}

func signTestToken(uid, role string) string {
	claims := jwt.MapClaims{
		"sub":  uid,
		"role": role,
		"iat":  time.Now().Unix(),
		"exp":  time.Now().Add(30 * time.Minute).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := token.SignedString(jwtSecret)
	return s
}

func TestRegisterAndUnregisterToken(t *testing.T) {
	mock := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mock, nil
	}

	r := setupTestRouter()

	t.Run("RegisterToken_Success", func(t *testing.T) {
		w := httptest.NewRecorder()
		token := signTestToken("user123", "user")

		body := TokenRegister{
			Token:    "ExponentPushToken[123456]",
			DeviceID: "device-xyz",
			Platform: "android",
		}
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest("POST", "/notifications/tokens", bytes.NewBuffer(b))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")

		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
		}

		// Verify token is in DB
		docSnap, _ := mock.Collection(COLLECTION_TOKENS).Doc("ExponentPushToken[123456]").Get(context.Background())
		if !docSnap.Exists() {
			t.Errorf("Expected token doc to be created in DB")
		}
		if docSnap.Data()["user_id"] != "user123" {
			t.Errorf("Expected user_id 'user123', got '%v'", docSnap.Data()["user_id"])
		}
	})

	t.Run("RegisterToken_ValidationError", func(t *testing.T) {
		w := httptest.NewRecorder()
		token := signTestToken("user123", "user")

		body := TokenRegister{
			Token: "",
		}
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest("POST", "/notifications/tokens", bytes.NewBuffer(b))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")

		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("Expected 400, got %d", w.Code)
		}
	})

	t.Run("UnregisterToken_Success", func(t *testing.T) {
		// Pre-seed token
		mock.Collection(COLLECTION_TOKENS).Doc("ExponentPushToken[123456]").Set(context.Background(), map[string]interface{}{
			"token":   "ExponentPushToken[123456]",
			"user_id": "user123",
		})

		w := httptest.NewRecorder()
		token := signTestToken("user123", "user")

		req, _ := http.NewRequest("DELETE", "/notifications/tokens/ExponentPushToken[123456]", nil)
		req.Header.Set("Authorization", "Bearer "+token)

		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("Expected 200, got %d", w.Code)
		}

		// Verify deleted
		docSnap, _ := mock.Collection(COLLECTION_TOKENS).Doc("ExponentPushToken[123456]").Get(context.Background())
		if docSnap.Exists() {
			t.Errorf("Expected token doc to be deleted")
		}
	})

	t.Run("UnregisterToken_Forbidden_NotOwner", func(t *testing.T) {
		// Pre-seed token
		mock.Collection(COLLECTION_TOKENS).Doc("ExponentPushToken[777]").Set(context.Background(), map[string]interface{}{
			"token":   "ExponentPushToken[777]",
			"user_id": "another_user",
		})

		w := httptest.NewRecorder()
		token := signTestToken("hacker_user", "user")

		req, _ := http.NewRequest("DELETE", "/notifications/tokens/ExponentPushToken[777]", nil)
		req.Header.Set("Authorization", "Bearer "+token)

		r.ServeHTTP(w, req)

		if w.Code != http.StatusForbidden {
			t.Errorf("Expected 403, got %d", w.Code)
		}
	})
}

func TestPubSubHandlers(t *testing.T) {
	mock := &mockClient{}
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mock, nil
	}

	// Set up mock HTTP server to simulate Router, Profiles, Messages and Expo
	var expoMu sync.Mutex
	var expoReceivedBodies []string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/router/services":
			// Mock router resolution pointing back to our test server
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
			// Capture body of push notifications sent
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

	// Configure environment variables for test
	os.Setenv("ROUTER_SERVICE_URL", "http://"+server.Listener.Addr().String())
	os.Setenv("EXPO_PUSH_URL", "http://"+server.Listener.Addr().String()+"/expo/send")
	defer func() {
		os.Unsetenv("ROUTER_SERVICE_URL")
		os.Unsetenv("EXPO_PUSH_URL")
	}()

	// Initialize service URLs (router client resolution)
	initServiceURLs()

	r := setupTestRouter()

	t.Run("MatchEvent_CREATED", func(t *testing.T) {
		// Pre-seed recipient tokens
		mock.Collection(COLLECTION_TOKENS).Doc("TokenBob").Set(context.Background(), map[string]interface{}{
			"token":      "TokenBob",
			"user_id":    "user_bob",
			"updated_at": time.Now(),
		})
		mock.Collection(COLLECTION_TOKENS).Doc("TokenAlice").Set(context.Background(), map[string]interface{}{
			"token":      "TokenAlice",
			"user_id":    "user_alice",
			"updated_at": time.Now(),
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
		pushReq := PubSubPushRequest{}
		pushReq.Message.Data = pbBytes

		b, _ := json.Marshal(pushReq)
		req, _ := http.NewRequest("POST", "/notifications/subscribers/matches", bytes.NewBuffer(b))
		req.Header.Set("Content-Type", "application/json")

		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
		}

		// Wait slightly for async notification dispatch routine
		time.Sleep(100 * time.Millisecond)

		expoMu.Lock()
		combinedBody := strings.Join(expoReceivedBodies, " | ")
		expoMu.Unlock()

		if !strings.Contains(combinedBody, "TokenBob") || !strings.Contains(combinedBody, "TokenAlice") {
			t.Errorf("Expected Expo push body to contain participant tokens, got: %s", combinedBody)
		}
		if !strings.Contains(combinedBody, "You matched with Bob!") && !strings.Contains(combinedBody, "You matched with Alice!") {
			t.Errorf("Expected push body to contain match announcement, got: %s", combinedBody)
		}
	})

	t.Run("MessageEvent_SENT", func(t *testing.T) {
		expoMu.Lock()
		expoReceivedBodies = nil // Reset capture
		expoMu.Unlock()

		// Pre-seed recipient token (Bob is receiver)
		mock.Collection(COLLECTION_TOKENS).Doc("TokenBob").Set(context.Background(), map[string]interface{}{
			"token":      "TokenBob",
			"user_id":    "user_bob",
			"updated_at": time.Now(),
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
		pushReq := PubSubPushRequest{}
		pushReq.Message.Data = pbBytes

		b, _ := json.Marshal(pushReq)
		req, _ := http.NewRequest("POST", "/notifications/subscribers/messages", bytes.NewBuffer(b))
		req.Header.Set("Content-Type", "application/json")

		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
		}

		// Wait for async dispatch
		time.Sleep(100 * time.Millisecond)

		expoMu.Lock()
		combinedBody := strings.Join(expoReceivedBodies, " | ")
		expoMu.Unlock()

		if !strings.Contains(combinedBody, "TokenBob") {
			t.Errorf("Expected Expo push body to target recipient TokenBob, got: %s", combinedBody)
		}
		if !strings.Contains(combinedBody, "New Message from Alice") || !strings.Contains(combinedBody, "Let's meet at the tavern!") {
			t.Errorf("Expected push notification details in body, got: %s", combinedBody)
		}
	})
}
