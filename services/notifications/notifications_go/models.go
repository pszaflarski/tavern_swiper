package main

import "time"

type TokenRegister struct {
	Token    string `json:"token" binding:"required"`
	DeviceID string `json:"device_id"`
	Platform string `json:"platform"`
}

type DeviceTokenDoc struct {
	Token     string    `firestore:"token"`
	UserID    string    `firestore:"user_id"`
	DeviceID  string    `firestore:"device_id,omitempty"`
	Platform  string    `firestore:"platform,omitempty"`
	UpdatedAt time.Time `firestore:"updated_at"`
}

type HealthResponse struct {
	Service string `json:"service"`
	Status  string `json:"status"`
}

