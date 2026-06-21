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

type ExpoPushMessage struct {
	To    string                 `json:"to"`
	Title string                 `json:"title,omitempty"`
	Body  string                 `json:"body,omitempty"`
	Data  map[string]interface{} `json:"data,omitempty"`
	Sound string                 `json:"sound,omitempty"`
}

type ExpoPushDetails struct {
	Error string `json:"error,omitempty"`
}

type ExpoPushResult struct {
	Status  string          `json:"status"`
	Message string          `json:"message,omitempty"`
	Details ExpoPushDetails `json:"details,omitempty"`
}

type ExpoPushResponse struct {
	Data []ExpoPushResult `json:"data"`
}

type HealthResponse struct {
	Service string `json:"service"`
	Status  string `json:"status"`
}

type PubSubPushRequest struct {
	Message struct {
		Data []byte `json:"data"`
	} `json:"message"`
}
