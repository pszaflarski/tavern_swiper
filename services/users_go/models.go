package main

import "time"

// UserType enum
type UserType string

const (
	User      UserType = "user"
	Admin     UserType = "admin"
	RootAdmin UserType = "root_admin"
)

// Base User fields
type UserBase struct {
	Email     string   `json:"email" binding:"required,email"`
	FullName  string   `json:"full_name,omitempty" firestore:"full_name,omitempty"`
	IsPremium bool     `json:"is_premium"`
	UserType  UserType `json:"user_type"`
	IsDeleted bool     `json:"is_deleted"`
}

// Request Models
type UserCreate struct {
	UserBase
	UID *string `json:"uid,omitempty"`
}

type UserUpdate struct {
	IsPremium *bool     `json:"is_premium,omitempty"`
	UserType  *UserType `json:"user_type,omitempty"`
	FullName  *string   `json:"full_name,omitempty"`
}

// Response Models
type UserOut struct {
	UserBase
	UID       string    `json:"uid"`
	CreatedAt time.Time `json:"created_at"`
}

type RootAdminExistsResponse struct {
	Exists bool `json:"exists"`
}

type HealthResponse struct {
	Service string `json:"service"`
	Status  string `json:"status"`
}

// Error Models
type ErrorResponse struct {
	Detail interface{} `json:"detail"`
}
