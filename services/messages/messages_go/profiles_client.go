package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

// ProfileInfo is a minimal representation of a profile from the profiles service.
type ProfileInfo struct {
	ProfileID   string `json:"profile_id"`
	DisplayName string `json:"display_name"`
}

// ProfilesClient provides methods to call the profiles microservice.
type ProfilesClient interface {
	GetProfile(profileID string, token string) (*ProfileInfo, error)
}

type realProfilesClient struct {
	baseURL    string
	httpClient *http.Client
}

// NewProfilesClient creates a client for the profiles service.
func NewProfilesClient() ProfilesClient {
	url := os.Getenv("PROFILES_SERVICE_URL")
	if url == "" {
		url = "http://profiles:8002"
	}
	return &realProfilesClient{
		baseURL: url,
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

func (c *realProfilesClient) GetProfile(profileID string, token string) (*ProfileInfo, error) {
	req, _ := http.NewRequest("GET", fmt.Sprintf("%s/profiles/%s", c.baseURL, profileID), nil)
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	var profile ProfileInfo
	if err := json.NewDecoder(resp.Body).Decode(&profile); err != nil {
		return nil, err
	}
	return &profile, nil
}
