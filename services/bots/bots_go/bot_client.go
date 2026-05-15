package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/draw"
	"image/jpeg"
	_ "image/png" // Register PNG decoder
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	xdraw "golang.org/x/image/draw"
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

func initUserRecord(adminToken string, botUID string, botEmail string) error {
	usersURL := serviceURLs.Get("users")
	payload := map[string]interface{}{
		"email":     botEmail,
		"user_type": "bot",
		"uid":       botUID,
	}
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequest("POST", usersURL+"/users/", bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to call POST /users/: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("user init failed (HTTP %d): %s", resp.StatusCode, string(respBody))
	}
	return nil
}

func createBotProfile(jwtToken string, botReq BotProfileCreate) (map[string]interface{}, error) {
	profilesURL := serviceURLs.Get("profiles")

	payload := map[string]interface{}{
		"display_name": botReq.DisplayName,
		"tagline":      botReq.Tagline,
		"bio":          botReq.Bio,
		"age":          botReq.Age,
		"is_oc":        botReq.IsOC,
		"gender":       botReq.Gender,
		"race":         botReq.Race,
		"fandom":       botReq.Fandom,
		"interests":    botReq.Interests,
		"events":       botReq.Events,
		"looking_for":  botReq.LookingFor,
		"other_tags":   botReq.OtherTags,
	}

	body, _ := json.Marshal(payload)

	req, _ := http.NewRequest("POST", profilesURL+"/profiles/", bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+jwtToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to call /profiles/: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("profile creation failed (HTTP %d): %s", resp.StatusCode, string(respBody))
	}

	var profResp map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&profResp)

	return profResp, nil
}

func uploadImageToProfile(jwtToken, profileID string, imageData []byte, filename string) (map[string]interface{}, error) {
	profilesURL := serviceURLs.Get("profiles")

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return nil, fmt.Errorf("failed to create form file: %w", err)
	}
	part.Write(imageData)
	writer.Close()

	req, _ := http.NewRequest("POST", profilesURL+"/profiles/"+profileID+"/image", body)
	req.Header.Set("Authorization", "Bearer "+jwtToken)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to call /profiles/:id/image: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("image upload failed (HTTP %d): %s", resp.StatusCode, string(respBody))
	}

	var profResp map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&profResp)

	return profResp, nil
}

// listProfilesForUser fetches all profiles for a given user_id (firebase_uid) from the profiles service.
func listProfilesForUser(jwtToken, userID string) ([]map[string]interface{}, error) {
	profilesURL := serviceURLs.Get("profiles")

	req, _ := http.NewRequest("GET", profilesURL+"/profiles/user/"+userID, nil)
	req.Header.Set("Authorization", "Bearer "+jwtToken)

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to call /profiles/user/%s: %w", userID, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("list profiles failed (HTTP %d): %s", resp.StatusCode, string(respBody))
	}

	var profiles []map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&profiles)

	return profiles, nil
}

// deleteProfile deletes a profile via the profiles service.
func deleteProfile(jwtToken, profileID string) error {
	profilesURL := serviceURLs.Get("profiles")

	req, _ := http.NewRequest("DELETE", profilesURL+"/profiles/"+profileID, nil)
	req.Header.Set("Authorization", "Bearer "+jwtToken)

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to call DELETE /profiles/%s: %w", profileID, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("delete profile failed (HTTP %d): %s", resp.StatusCode, string(respBody))
	}

	return nil
}

func downloadImage(imageURL string) ([]byte, string, error) {
	// 30 second timeout per download
	client := &http.Client{Timeout: 30 * time.Second}

	req, err := http.NewRequest("GET", imageURL, nil)
	if err != nil {
		return nil, "", fmt.Errorf("invalid URL: %w", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("download failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return nil, "", fmt.Errorf("download failed (HTTP %d)", resp.StatusCode)
	}

	contentType := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "image/") {
		return nil, "", fmt.Errorf("invalid content type: %s", contentType)
	}

	// Decode any supported image format (JPEG, PNG, etc.)
	img, _, err := image.Decode(resp.Body)
	if err != nil {
		return nil, "", fmt.Errorf("failed to decode image: %w", err)
	}

	// Resize to 1080x1350 (profiles service required dimensions)
	const targetW, targetH = 1080, 1350
	img = resizeAndCrop(img, targetW, targetH)

	// Re-encode as JPEG (profiles service requires JPEG magic bytes)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		return nil, "", fmt.Errorf("failed to encode as JPEG: %w", err)
	}

	// Build filename from URL, always with .jpg extension
	parsedURL, err := url.Parse(imageURL)
	filename := "image.jpg"
	if err == nil {
		base := path.Base(parsedURL.Path)
		if base != "" && base != "." && base != "/" {
			// Strip original extension and use .jpg
			ext := path.Ext(base)
			if ext != "" {
				base = base[:len(base)-len(ext)]
			}
			filename = base + ".jpg"
		}
	}

	return buf.Bytes(), filename, nil
}

// resizeAndCrop center-crops the source image to the target aspect ratio,
// then scales it to exactly targetW x targetH using high-quality interpolation.
func resizeAndCrop(src image.Image, targetW, targetH int) image.Image {
	srcBounds := src.Bounds()
	srcW := srcBounds.Dx()
	srcH := srcBounds.Dy()

	// Calculate crop rectangle to match target aspect ratio
	targetRatio := float64(targetW) / float64(targetH)
	srcRatio := float64(srcW) / float64(srcH)

	var cropRect image.Rectangle
	if srcRatio > targetRatio {
		// Source is wider — crop sides
		newW := int(float64(srcH) * targetRatio)
		offset := (srcW - newW) / 2
		cropRect = image.Rect(srcBounds.Min.X+offset, srcBounds.Min.Y, srcBounds.Min.X+offset+newW, srcBounds.Max.Y)
	} else {
		// Source is taller — crop top/bottom
		newH := int(float64(srcW) / targetRatio)
		offset := (srcH - newH) / 2
		cropRect = image.Rect(srcBounds.Min.X, srcBounds.Min.Y+offset, srcBounds.Max.X, srcBounds.Min.Y+offset+newH)
	}

	// Crop by creating a sub-image
	type subImager interface {
		SubImage(r image.Rectangle) image.Image
	}

	cropped := src
	if si, ok := src.(subImager); ok {
		cropped = si.SubImage(cropRect)
	} else {
		// Fallback: draw the crop manually
		tmp := image.NewRGBA(image.Rect(0, 0, cropRect.Dx(), cropRect.Dy()))
		draw.Draw(tmp, tmp.Bounds(), src, cropRect.Min, draw.Src)
		cropped = tmp
	}

	// Scale to target dimensions using Lanczos3
	dst := image.NewRGBA(image.Rect(0, 0, targetW, targetH))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), cropped, cropped.Bounds(), xdraw.Over, nil)

	return dst
}
