package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

var httpClient = &http.Client{Timeout: 15 * time.Second}

func registerFirebaseUser(email, password string) error {
	authURL := serviceURLs.Get("auth")
	payload := map[string]interface{}{
		"email":    email,
		"password": password,
	}
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequest("POST", authURL+"/auth/register", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to call /auth/register: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Firebase registration failed (HTTP %d): %s", resp.StatusCode, string(respBody))
	}
	return nil
}

func loginAndVerify(email, password string) (string, string, error) {
	authURL := serviceURLs.Get("auth")
	payload := map[string]interface{}{
		"email":    email,
		"password": password,
	}
	body, _ := json.Marshal(payload)

	// 1. Login
	req, _ := http.NewRequest("POST", authURL+"/auth/login", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("failed to call /auth/login: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return "", "", fmt.Errorf("login failed (HTTP %d): %s", resp.StatusCode, string(respBody))
	}

	var loginResp struct {
		IDToken string `json:"id_token"`
		UID     string `json:"uid"`
	}
	json.NewDecoder(resp.Body).Decode(&loginResp)

	// 2. Verify
	verifyPayload := map[string]interface{}{
		"id_token": loginResp.IDToken,
	}
	verifyBody, _ := json.Marshal(verifyPayload)
	vReq, _ := http.NewRequest("POST", authURL+"/auth/verify", bytes.NewBuffer(verifyBody))
	vReq.Header.Set("Content-Type", "application/json")

	vResp, err := httpClient.Do(vReq)
	if err != nil {
		return "", "", fmt.Errorf("failed to call /auth/verify: %w", err)
	}
	defer vResp.Body.Close()

	if vResp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(vResp.Body)
		return "", "", fmt.Errorf("verify failed (HTTP %d): %s", vResp.StatusCode, string(respBody))
	}

	var tokenResp struct {
		Token *string `json:"token"`
	}
	json.NewDecoder(vResp.Body).Decode(&tokenResp)

	if tokenResp.Token == nil {
		return "", "", fmt.Errorf("no token returned from verify")
	}

	return *tokenResp.Token, loginResp.UID, nil
}

func initUserRecord(jwtToken string) error {
	usersURL := serviceURLs.Get("users")
	req, _ := http.NewRequest("GET", usersURL+"/users/me", nil)
	req.Header.Set("Authorization", "Bearer "+jwtToken)

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to call /users/me: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("user init failed (HTTP %d): %s", resp.StatusCode, string(respBody))
	}
	return nil
}

func createProfile(jwtToken string, botReq BotCreate) (string, error) {
	profilesURL := serviceURLs.Get("profiles")
	payload := map[string]interface{}{
		"display_name": botReq.DisplayName,
		"bio":          botReq.Bio,
		"tagline":      botReq.Tagline,
	}
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequest("POST", profilesURL+"/profiles/", bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+jwtToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to call /profiles/: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("profile creation failed (HTTP %d): %s", resp.StatusCode, string(respBody))
	}

	var profResp struct {
		ProfileID string `json:"profile_id"`
	}
	json.NewDecoder(resp.Body).Decode(&profResp)

	return profResp.ProfileID, nil
}
