package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// ProfileInfo is a minimal representation of a profile from the profiles service.
type ProfileInfo struct {
	ProfileID   string `json:"profile_id"`
	UserID      string `json:"user_id"`
	DisplayName string `json:"display_name"`
}

// ProfilesClient provides methods to call the profiles microservice.
type ProfilesClient interface {
	GetProfile(profileID string, token string) (*ProfileInfo, error)
}

type realProfilesClient struct {
	httpClient *http.Client
}

// NewProfilesClient creates a client for the profiles service.
// The base URL is resolved at runtime from the router.
func NewProfilesClient() ProfilesClient {
	return &realProfilesClient{
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

func (c *realProfilesClient) GetProfile(profileID string, token string) (*ProfileInfo, error) {
	baseURL := serviceURLs.Get("profiles")
	req, _ := http.NewRequest("GET", fmt.Sprintf("%s/profiles/%s", baseURL, profileID), nil)
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
