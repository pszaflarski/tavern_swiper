package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Service URL management (lightweight — only profiles service needed)
// ---------------------------------------------------------------------------

// ServiceURLs holds resolved service URLs from the router.
type ServiceURLs struct {
	mu   sync.RWMutex
	urls map[string]string
}

// Get returns the URL for a service, or empty string if not resolved.
func (s *ServiceURLs) Get(service string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.urls[service]
}

// serviceURLs is the singleton holding resolved service URLs.
var serviceURLs = &ServiceURLs{urls: make(map[string]string)}

// initServiceURLs fetches service URLs from the router at boot.
// If ROUTER_SERVICE_URL is not set (local dev), it falls back to env vars.
func initServiceURLs() {
	routerURL := os.Getenv("ROUTER_SERVICE_URL")
	if routerURL == "" {
		// Local dev or test mode — fall back to explicit env vars
		if strings.HasSuffix(os.Args[0], ".test") {
			log.Println("[INFO] Test mode detected, skipping router URL initialization")
			return
		}
		log.Println("[INFO] ROUTER_SERVICE_URL not set — using explicit env vars for service discovery")
		if profilesURL := os.Getenv("PROFILES_SERVICE_URL"); profilesURL != "" {
			serviceURLs.mu.Lock()
			serviceURLs.urls["profiles"] = profilesURL
			serviceURLs.mu.Unlock()
		}
		return
	}

	tag := os.Getenv("ROUTER_TAG")
	if tag == "" {
		tag = "default"
	}

	endpoint := fmt.Sprintf("%s/router/services?tag=%s", routerURL, tag)
	client := &http.Client{Timeout: 5 * time.Second}

	var lastErr error
	maxRetries := 5
	for attempt := 1; attempt <= maxRetries; attempt++ {
		resp, err := client.Get(endpoint)
		if err != nil {
			lastErr = err
			log.Printf("[WARN] Router fetch attempt %d/%d failed: %v", attempt, maxRetries, err)
			time.Sleep(time.Duration(attempt) * time.Second)
			continue
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			lastErr = fmt.Errorf("router returned status %d", resp.StatusCode)
			log.Printf("[WARN] Router fetch attempt %d/%d: %v", attempt, maxRetries, lastErr)
			time.Sleep(time.Duration(attempt) * time.Second)
			continue
		}

		var result struct {
			Tag      string            `json:"tag"`
			Services map[string]string `json:"services"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			resp.Body.Close()
			lastErr = err
			log.Printf("[WARN] Router response decode attempt %d/%d failed: %v", attempt, maxRetries, err)
			time.Sleep(time.Duration(attempt) * time.Second)
			continue
		}
		resp.Body.Close()

		serviceURLs.mu.Lock()
		for k, v := range result.Services {
			serviceURLs.urls[k] = v
		}
		serviceURLs.mu.Unlock()

		log.Printf("[INFO] Service URLs resolved from router (tag=%s): %v", tag, result.Services)
		return
	}

	log.Printf("[ERROR] Failed to fetch service URLs from router after %d attempts. Last error: %v", maxRetries, lastErr)
}

// ---------------------------------------------------------------------------
// Profiles service client
// ---------------------------------------------------------------------------

var httpClient = &http.Client{Timeout: 10 * time.Second}

// resolveProfileFunc allows mocking in tests.
var resolveProfileFunc = resolveUserIDByProfile

// resolveUserIDByProfile calls the profiles service to get the user_id
// for a given profile_id. Uses the caller's JWT for auth.
func resolveUserIDByProfile(token, profileID string) (string, error) {
	profilesURL := serviceURLs.Get("profiles")
	if profilesURL == "" {
		return "", fmt.Errorf("profiles service URL not resolved")
	}

	req, err := http.NewRequest("GET", profilesURL+"/profiles/"+profileID, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to call profiles service: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return "", fmt.Errorf("profiles service returned HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var profile struct {
		UserID string `json:"user_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&profile); err != nil {
		return "", fmt.Errorf("failed to decode profile response: %w", err)
	}

	if profile.UserID == "" {
		return "", fmt.Errorf("profile %s has no user_id", profileID)
	}

	return profile.UserID, nil
}
