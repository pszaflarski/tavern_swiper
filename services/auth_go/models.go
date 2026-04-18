package main

// Request Models
type TokenRequest struct {
	IDToken string `json:"id_token" binding:"required"`
}

type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

type BulkDeleteRequest struct {
	UIDs []string `json:"uids" binding:"required"`
}

type DevMintRequest struct {
	UID   string `json:"uid" binding:"required"`
	Email string `json:"email" binding:"required,email"`
	Role  string `json:"role"`
}

// Response Models
type TokenResponse struct {
	UID   string  `json:"uid"`
	Role  string  `json:"role"`
	Token *string `json:"token"` // Pointer handles null vs empty string parity
}

type AuthResponse struct {
	IDToken string `json:"id_token"`
	UID     string `json:"uid"`
}

type HealthResponse struct {
	Service string `json:"service"`
	Status  string `json:"status"`
}

// Error Models
type ErrorResponse struct {
	Detail interface{} `json:"detail"`
}

type ValidationErrorItem struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}
