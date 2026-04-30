package main

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func setupTest(publisher Publisher) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.Default()

	// Global Middleware
	r.Use(AuthMiddleware())

	// Routes matching main.go
	r.GET("/profiles/health", handleHealth)
	
	p := r.Group("/profiles")
	{
		p.GET("/all", handleListAllProfiles)
		p.POST("/", func(c *gin.Context) { handleCreateProfile(c, publisher) })
		p.GET("/:id", handleGetProfile)
		p.POST("/batch", handleGetProfilesBatch)
		p.GET("/user/me", handleListMyProfiles)
		p.GET("/user/me/active", handleGetMyActiveProfile)
		p.GET("/user/:user_id", handleListProfilesForUser)
		p.PUT("/:id", func(c *gin.Context) { handleUpdateProfile(c, publisher) })
		p.POST("/:id/set_active", func(c *gin.Context) { handleSetProfileActive(c, publisher) })
		p.DELETE("/:id", func(c *gin.Context) { handleDeleteProfile(c, publisher) })
		p.POST("/:id/image", func(c *gin.Context) { handleUploadProfileImage(c, publisher) })
		p.DELETE("/", func(c *gin.Context) { handleDeleteAllProfiles(c, publisher) })
	}

	return r
}

func signGoTestToken(uid string, role string) string {
	now := time.Date(2026, 4, 17, 10, 0, 0, 0, time.UTC)
	return signGoTestTokenWithTimes(uid, role, now, now.Add(30*time.Minute))
}

func signGoTestTokenWithTimes(uid string, role string, iat time.Time, exp time.Time) string {
	claims := jwt.MapClaims{
		"sub":  uid,
		"role": role,
		"iat":  iat.Unix(),
		"exp":  exp.Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := token.SignedString(jwtSecret)
	return s
}

type mockPublisher struct {
	PublishedUpserted []ProfileOut
	PublishedDeleted  []string
	PublishedAll      []string
}

func (m *mockPublisher) PublishUpserted(ctx context.Context, p ProfileOut) {
	m.PublishedUpserted = append(m.PublishedUpserted, p)
}

func (m *mockPublisher) PublishDeleted(ctx context.Context, profileID string) {
	m.PublishedDeleted = append(m.PublishedDeleted, profileID)
}

func (m *mockPublisher) PublishAllDeleted(ctx context.Context, adminUserID string) {
	m.PublishedAll = append(m.PublishedAll, adminUserID)
}
