package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

// ServiceURLs holds the resolved service URLs from the router.
type ServiceURLs struct {
	mu   sync.RWMutex
	urls map[string]string
}

// Get returns the URL for a service. Panics if the service is not found,
// since a missing service URL is a fatal misconfiguration.
func (s *ServiceURLs) Get(service string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	url, ok := s.urls[service]
	if !ok || url == "" {
		panic(fmt.Sprintf("CRITICAL: Service URL for '%s' not resolved from router. Cannot proceed.", service))
	}
	return url
}

// serviceURLs is the singleton holding resolved service URLs.
var serviceURLs = &ServiceURLs{urls: make(map[string]string)}

// initServiceURLs fetches service URLs from the router at boot.
// It retries with backoff to handle startup ordering in Docker.
// If it cannot reach the router after all retries, it panics.
func initServiceURLs() {
	routerURL := os.Getenv("ROUTER_SERVICE_URL")
	if routerURL == "" {
		panic("CRITICAL: ROUTER_SERVICE_URL is not set. Cannot discover services.")
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
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
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
			lastErr = err
			log.Printf("[WARN] Router response decode attempt %d/%d failed: %v", attempt, maxRetries, err)
			time.Sleep(time.Duration(attempt) * time.Second)
			continue
		}

		serviceURLs.mu.Lock()
		for k, v := range result.Services {
			serviceURLs.urls[k] = v
		}
		serviceURLs.mu.Unlock()

		log.Printf("[INFO] Service URLs resolved from router (tag=%s): %v", tag, result.Services)
		return
	}

	panic(fmt.Sprintf("CRITICAL: Failed to fetch service URLs from router after %d attempts. Last error: %v", maxRetries, lastErr))
}
