package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type DiscoveryMatch struct {
	ID        string   `json:"id"`
	Profiles  []string `json:"profiles"`
	CreatedAt string   `json:"created_at"`
}

type DiscoveryClient interface {
	GetMatch(matchID string, token string) (*DiscoveryMatch, error)
	ListMatchesForProfile(profileID string, token string) ([]DiscoveryMatch, error)
}

type realDiscoveryClient struct {
	httpClient *http.Client
}

// NewDiscoveryClient creates a client for the discovery service.
// The base URL is resolved at runtime from the router.
func NewDiscoveryClient() DiscoveryClient {
	return &realDiscoveryClient{
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

func (c *realDiscoveryClient) GetMatch(matchID string, token string) (*DiscoveryMatch, error) {
	baseURL := serviceURLs.Get("discovery")
	req, _ := http.NewRequest("GET", fmt.Sprintf("%s/discovery/matches/%s", baseURL, matchID), nil)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	var match DiscoveryMatch
	if err := json.NewDecoder(resp.Body).Decode(&match); err != nil {
		return nil, err
	}
	return &match, nil
}

func (c *realDiscoveryClient) ListMatchesForProfile(profileID string, token string) ([]DiscoveryMatch, error) {
	baseURL := serviceURLs.Get("discovery")
	req, _ := http.NewRequest("GET", fmt.Sprintf("%s/discovery/matches/profile/%s", baseURL, profileID), nil)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	var matches []DiscoveryMatch
	if err := json.NewDecoder(resp.Body).Decode(&matches); err != nil {
		return nil, err
	}
	return matches, nil
}
