package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"cloud.google.com/go/firestore"
)

// ---------------------------------------------------------------------------
// mockBotReplyDB builds a mock Firestore client for behaviorBotReply tests.
//
//   - senderIsBot: if true, the isBotProfile guard returns a match
//   - botProfiles: list of bot_profile documents to iterate over
//   - botUserCreds: map[botUserID] -> {email, encrypted_password}
// ---------------------------------------------------------------------------
func mockBotReplyDB(senderIsBot bool, botProfiles []map[string]interface{}, botUserCreds map[string]map[string]interface{}) *mockClient {
	return &mockClient{
		collectionFunc: func(path string) FirestoreCollection {
			switch path {
			case "bot_events":
				return mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
								return mockSnapshot{exists: false}, nil
							},
							setFunc: func(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
								return &firestore.WriteResult{}, nil
							},
						}
					},
				}
			case BOT_PROFILES_COLLECTION:
				idx := 0
				return mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
								return mockSnapshot{exists: false}, nil
							},
						}
					},
					whereFunc: func(p, op string, val interface{}) FirestoreQuery {
						if p == "profile_id" {
							// isBotProfile guard query
							if senderIsBot {
								called := false
								return &mockQuery{
									documentsFunc: func(ctx context.Context) FirestoreDocumentIterator {
										return &mockIterator{
											nextFunc: func() (FirestoreDocumentSnapshot, error) {
												if called {
													return nil, fmt.Errorf("done")
												}
												called = true
												return mockSnapshot{exists: true, data: map[string]interface{}{"profile_id": "bot-sender"}}, nil
											},
										}
									},
								}
							}
							return &mockQuery{
								documentsFunc: func(ctx context.Context) FirestoreDocumentIterator {
									return &mockIterator{
										nextFunc: func() (FirestoreDocumentSnapshot, error) {
											return nil, fmt.Errorf("not found")
										},
									}
								},
							}
						}
						return &mockQuery{}
					},
					documentsFunc: func(ctx context.Context) FirestoreDocumentIterator {
						return &mockIterator{
							nextFunc: func() (FirestoreDocumentSnapshot, error) {
								if idx >= len(botProfiles) {
									return nil, fmt.Errorf("iterator done")
								}
								snap := mockSnapshot{
									exists: true,
									data:   botProfiles[idx],
									id:     fmt.Sprintf("bp-%d", idx),
								}
								idx++
								return snap, nil
							},
						}
					},
				}
			case BOT_USERS_COLLECTION:
				return mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
								if creds, ok := botUserCreds[id]; ok {
									return mockSnapshot{exists: true, data: creds}, nil
								}
								return mockSnapshot{exists: false}, fmt.Errorf("not found")
							},
						}
					},
				}
			default:
				return mockCollection{
					docFunc: func(id string) FirestoreDocument {
						return mockDoc{
							getFunc: func(ctx context.Context) (FirestoreDocumentSnapshot, error) {
								return mockSnapshot{exists: false}, nil
							},
							setFunc: func(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
								return &firestore.WriteResult{}, nil
							},
						}
					},
				}
			}
		},
	}
}

// ---------------------------------------------------------------------------
// behaviorBotReply unit tests (direct function calls)
// ---------------------------------------------------------------------------

func TestBehaviorBotReply_SkipsBotSender(t *testing.T) {
	db := mockBotReplyDB(true, nil, nil)
	count, details := behaviorBotReply(context.Background(), db, "conv-1", "bot-sender", "hello", "user", nil)

	if count != 0 {
		t.Errorf("Expected 0 triggered, got %d", count)
	}
	if len(details) == 0 || !strings.Contains(details[0], "is a bot") {
		t.Errorf("Expected bot-skip message, got %v", details)
	}
}

func TestBehaviorBotReply_NoBotProfiles(t *testing.T) {
	db := mockBotReplyDB(false, nil, nil)
	count, details := behaviorBotReply(context.Background(), db, "conv-1", "human-sender", "hello", "user", nil)

	if count != 0 {
		t.Errorf("Expected 0 triggered, got %d", count)
	}
	if len(details) == 0 || !strings.Contains(details[0], "No bot profiles") {
		t.Errorf("Expected no-profiles message, got %v", details)
	}
}

func TestBehaviorBotReply_AuthFailure(t *testing.T) {
	profiles := []map[string]interface{}{
		{"bot_user_id": "bot-user-1", "profile_id": "bp-1", "agent_name": "grogmar"},
	}
	// No credentials → auth will fail
	db := mockBotReplyDB(false, profiles, map[string]map[string]interface{}{})
	count, details := behaviorBotReply(context.Background(), db, "conv-1", "human-sender", "hello", "user", nil)

	if count != 0 {
		t.Errorf("Expected 0 triggered, got %d", count)
	}
	found := false
	for _, d := range details {
		if strings.Contains(d, "Auth failed") {
			found = true
		}
	}
	if !found {
		t.Errorf("Expected auth failure detail, got %v", details)
	}
}

// ---------------------------------------------------------------------------
// isBotInConversation unit tests
// ---------------------------------------------------------------------------

func TestIsBotInConversation_Found(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]map[string]string{
			{"id": "conv-1"},
			{"id": "conv-2"},
		})
	}))
	defer server.Close()

	serviceURLs.mu.Lock()
	oldMessages := serviceURLs.urls["messages"]
	serviceURLs.urls["messages"] = server.URL
	serviceURLs.mu.Unlock()
	defer func() {
		serviceURLs.mu.Lock()
		serviceURLs.urls["messages"] = oldMessages
		serviceURLs.mu.Unlock()
	}()

	found, err := isBotInConversation("fake-token", "bp-1", "conv-2")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if !found {
		t.Error("Expected bot to be found in conversation")
	}
}

func TestIsBotInConversation_NotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]map[string]string{
			{"id": "conv-1"},
		})
	}))
	defer server.Close()

	serviceURLs.mu.Lock()
	oldMessages := serviceURLs.urls["messages"]
	serviceURLs.urls["messages"] = server.URL
	serviceURLs.mu.Unlock()
	defer func() {
		serviceURLs.mu.Lock()
		serviceURLs.urls["messages"] = oldMessages
		serviceURLs.mu.Unlock()
	}()

	found, err := isBotInConversation("fake-token", "bp-1", "conv-999")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if found {
		t.Error("Expected bot NOT to be in conversation")
	}
}

func TestIsBotInConversation_HTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer server.Close()

	serviceURLs.mu.Lock()
	oldMessages := serviceURLs.urls["messages"]
	serviceURLs.urls["messages"] = server.URL
	serviceURLs.mu.Unlock()
	defer func() {
		serviceURLs.mu.Lock()
		serviceURLs.urls["messages"] = oldMessages
		serviceURLs.mu.Unlock()
	}()

	found, err := isBotInConversation("fake-token", "bp-1", "conv-1")
	if err != nil {
		t.Fatalf("HTTP errors should not return error (graceful fallback), got: %v", err)
	}
	if found {
		t.Error("Expected false on HTTP error")
	}
}

// ---------------------------------------------------------------------------
// callAgentRouter unit tests
// ---------------------------------------------------------------------------

func TestCallAgentRouter_Success(t *testing.T) {
	var receivedPayload map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/invoke" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		json.NewDecoder(r.Body).Decode(&receivedPayload)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"response":  "Hail, adventurer!",
			"thread_id": "conv-1",
		})
	}))
	defer server.Close()

	serviceURLs.mu.Lock()
	oldAgent := serviceURLs.urls["agent_router"]
	serviceURLs.urls["agent_router"] = server.URL
	serviceURLs.mu.Unlock()
	defer func() {
		serviceURLs.mu.Lock()
		serviceURLs.urls["agent_router"] = oldAgent
		serviceURLs.mu.Unlock()
	}()

	resp, err := callAgentRouter("fake-token", "grogmar", "Hello there", "conv-1", "user", nil)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if resp != "Hail, adventurer!" {
		t.Errorf("Expected 'Hail, adventurer!', got '%s'", resp)
	}
	if receivedPayload["agent"] != "grogmar" {
		t.Errorf("Expected agent 'grogmar', got '%v'", receivedPayload["agent"])
	}
	if receivedPayload["prompt"] != "Hello there" {
		t.Errorf("Expected prompt 'Hello there', got '%v'", receivedPayload["prompt"])
	}
	if receivedPayload["thread_id"] != "conv-1" {
		t.Errorf("Expected thread_id 'conv-1', got '%v'", receivedPayload["thread_id"])
	}
}

func TestCallAgentRouter_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("LLM overloaded"))
	}))
	defer server.Close()

	serviceURLs.mu.Lock()
	oldAgent := serviceURLs.urls["agent_router"]
	serviceURLs.urls["agent_router"] = server.URL
	serviceURLs.mu.Unlock()
	defer func() {
		serviceURLs.mu.Lock()
		serviceURLs.urls["agent_router"] = oldAgent
		serviceURLs.mu.Unlock()
	}()

	_, err := callAgentRouter("fake-token", "grogmar", "Hello", "conv-1", "user", nil)
	if err == nil {
		t.Fatal("Expected error on 500 response")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("Expected error to mention HTTP 500, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// postBotMessage unit tests
// ---------------------------------------------------------------------------

func TestPostBotMessage_Success(t *testing.T) {
	var receivedPayload map[string]string
	var receivedPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedPath = r.URL.Path
		json.NewDecoder(r.Body).Decode(&receivedPayload)
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	serviceURLs.mu.Lock()
	oldMessages := serviceURLs.urls["messages"]
	serviceURLs.urls["messages"] = server.URL
	serviceURLs.mu.Unlock()
	defer func() {
		serviceURLs.mu.Lock()
		serviceURLs.urls["messages"] = oldMessages
		serviceURLs.mu.Unlock()
	}()

	err := postBotMessage("fake-token", "conv-42", "bot-profile-1", "Greetings!")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if receivedPath != "/messages/conversations/conv-42/messages" {
		t.Errorf("Unexpected path: %s", receivedPath)
	}
	if receivedPayload["sender_profile_id"] != "bot-profile-1" {
		t.Errorf("Expected sender_profile_id 'bot-profile-1', got '%s'", receivedPayload["sender_profile_id"])
	}
	if receivedPayload["content"] != "Greetings!" {
		t.Errorf("Expected content 'Greetings!', got '%s'", receivedPayload["content"])
	}
}

func TestPostBotMessage_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte("not authorized"))
	}))
	defer server.Close()

	serviceURLs.mu.Lock()
	oldMessages := serviceURLs.urls["messages"]
	serviceURLs.urls["messages"] = server.URL
	serviceURLs.mu.Unlock()
	defer func() {
		serviceURLs.mu.Lock()
		serviceURLs.urls["messages"] = oldMessages
		serviceURLs.mu.Unlock()
	}()

	err := postBotMessage("fake-token", "conv-42", "bot-profile-1", "Hello")
	if err == nil {
		t.Fatal("Expected error on 403 response")
	}
	if !strings.Contains(err.Error(), "403") {
		t.Errorf("Expected error to mention HTTP 403, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Handler-level: message_received trigger through handleBehaviorTrigger
// ---------------------------------------------------------------------------

func TestHandleBehaviorTrigger_MessageReceived_SkipsBotSender(t *testing.T) {
	originalDBFunc := getDBFunc
	defer func() { getDBFunc = originalDBFunc }()

	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mockBotReplyDB(true, nil, nil), nil
	}
	router := setupTestRouter()

	reqPayload := BehaviorTriggerRequest{
		Trigger: "message_received",
		Context: map[string]interface{}{
			"conversation_id":   "conv-1",
			"sender_profile_id": "bot-sender",
			"message_preview":   "hello",
		},
	}
	body, _ := json.Marshal(reqPayload)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/bots/behaviors/trigger", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var resp BehaviorTriggerResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Triggered != 0 {
		t.Errorf("Expected 0 triggered (bot sender), got %d", resp.Triggered)
	}
	if len(resp.Details) == 0 || !strings.Contains(resp.Details[0], "is a bot") {
		t.Errorf("Expected bot-skip detail, got %v", resp.Details)
	}
}

func TestHandleBehaviorTrigger_MessageReceived_NoBotProfiles(t *testing.T) {
	originalDBFunc := getDBFunc
	defer func() { getDBFunc = originalDBFunc }()

	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mockBotReplyDB(false, nil, nil), nil
	}
	router := setupTestRouter()

	reqPayload := BehaviorTriggerRequest{
		Trigger: "message_received",
		Context: map[string]interface{}{
			"conversation_id":   "conv-1",
			"sender_profile_id": "human-user",
			"message_preview":   "hello",
		},
	}
	body, _ := json.Marshal(reqPayload)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/bots/behaviors/trigger", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var resp BehaviorTriggerResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Triggered != 0 {
		t.Errorf("Expected 0 triggered, got %d", resp.Triggered)
	}
}

func TestHandleBehaviorTrigger_MessageReceived_MissingContext(t *testing.T) {
	originalDBFunc := getDBFunc
	defer func() { getDBFunc = originalDBFunc }()

	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mockBotReplyDB(false, nil, nil), nil
	}
	router := setupTestRouter()

	// Missing conversation_id and sender_profile_id — should skip gracefully
	reqPayload := BehaviorTriggerRequest{
		Trigger: "message_received",
		Context: map[string]interface{}{},
	}
	body, _ := json.Marshal(reqPayload)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/bots/behaviors/trigger", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}

	var resp BehaviorTriggerResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Triggered != 0 {
		t.Errorf("Expected 0 triggered when context fields are missing, got %d", resp.Triggered)
	}
}

func TestHandleBehaviorTrigger_MessageReceived_FullPipeline(t *testing.T) {
	originalDBFunc := getDBFunc
	defer func() { getDBFunc = originalDBFunc }()

	// Track what the mock servers received
	var agentRouterCalled bool
	var messagePosted bool
	var postedContent string

	// Mock external services: auth, messages, agent_router
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Auth login
		if r.Method == "POST" && r.URL.Path == "/auth/login" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"id_token":"fake-id","uid":"fake-uid"}`))
			return
		}
		// Auth verify
		if r.Method == "POST" && r.URL.Path == "/auth/verify" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"token":"fake-jwt"}`))
			return
		}
		// List conversations for a bot profile
		if r.Method == "GET" && strings.HasPrefix(r.URL.Path, "/messages/conversations/profile/") {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]map[string]string{{"id": "conv-42"}})
			return
		}
		// Agent router invoke
		if r.Method == "POST" && r.URL.Path == "/invoke" {
			agentRouterCalled = true
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{
				"response":  "Well met, traveler!",
				"thread_id": "conv-42",
			})
			return
		}
		// Post message
		if r.Method == "POST" && strings.HasPrefix(r.URL.Path, "/messages/conversations/conv-42/messages") {
			messagePosted = true
			var p map[string]string
			json.NewDecoder(r.Body).Decode(&p)
			postedContent = p["content"]
			w.WriteHeader(http.StatusCreated)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer mockServer.Close()

	// Point all service URLs at the mock server
	serviceURLs.mu.Lock()
	oldAuth := serviceURLs.urls["auth"]
	oldMsg := serviceURLs.urls["messages"]
	oldAgent := serviceURLs.urls["agent_router"]
	serviceURLs.urls["auth"] = mockServer.URL
	serviceURLs.urls["messages"] = mockServer.URL
	serviceURLs.urls["agent_router"] = mockServer.URL
	serviceURLs.mu.Unlock()
	defer func() {
		serviceURLs.mu.Lock()
		serviceURLs.urls["auth"] = oldAuth
		serviceURLs.urls["messages"] = oldMsg
		serviceURLs.urls["agent_router"] = oldAgent
		serviceURLs.mu.Unlock()
	}()

	profiles := []map[string]interface{}{
		{"bot_user_id": "bot-user-1", "profile_id": "grogmar-profile", "agent_name": "grogmar"},
	}
	creds := map[string]map[string]interface{}{
		"bot-user-1": {
			"email":              "bot@test.internal",
			"encrypted_password": "plaintext-fallback",
		},
	}

	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return mockBotReplyDB(false, profiles, creds), nil
	}

	// Override decryptPassword to return plaintext in tests
	origDecrypt := decryptPasswordFunc
	decryptPasswordFunc = func(ctx context.Context, encrypted string) (string, error) {
		return "test-password", nil
	}
	defer func() { decryptPasswordFunc = origDecrypt }()

	router := setupTestRouter()

	reqPayload := BehaviorTriggerRequest{
		Trigger: "message_received",
		Context: map[string]interface{}{
			"conversation_id":   "conv-42",
			"sender_profile_id": "human-user-profile",
			"message_preview":   "Hey Grogmar!",
		},
	}
	body, _ := json.Marshal(reqPayload)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/bots/behaviors/trigger", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var resp BehaviorTriggerResponse
	json.Unmarshal(w.Body.Bytes(), &resp)

	if resp.Triggered != 1 {
		t.Errorf("Expected 1 triggered, got %d. Details: %v", resp.Triggered, resp.Details)
	}
	if !agentRouterCalled {
		t.Error("Expected agent_router /invoke to be called")
	}
	if !messagePosted {
		t.Error("Expected message to be posted to messages service")
	}
	if postedContent != "Well met, traveler!" {
		t.Errorf("Expected posted content 'Well met, traveler!', got '%s'", postedContent)
	}
}
