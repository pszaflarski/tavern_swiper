package main

// PubSubPushRequest is the payload sent by Pub/Sub Push subscriptions.
type PubSubPushRequest struct {
	Message struct {
		Data []byte `json:"data"`
	} `json:"message"`
	Subscription string `json:"subscription"`
}

// ProfileInfo is fetched from profiles microservice
type ProfileInfo struct {
	ProfileID   string `json:"profile_id"`
	UserID      string `json:"user_id"`
	DisplayName string `json:"display_name"`
}

// DeviceTokenDoc represents a stored device push token
type DeviceTokenDoc struct {
	Token    string `firestore:"token"`
	UserID   string `firestore:"user_id"`
	DeviceID string `firestore:"device_id,omitempty"`
	Platform string `firestore:"platform,omitempty"`
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
