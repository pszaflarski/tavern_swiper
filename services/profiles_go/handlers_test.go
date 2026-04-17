package main

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func setupTest() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.Default()

	// Global Middleware
	r.Use(AuthMiddleware())

	// Routes matching main.go
	r.GET("/profiles/health", handleHealth)
	
	p := r.Group("/profiles")
	{
		p.GET("/all", handleListAllProfiles)
		p.POST("/", handleCreateProfile)
		p.GET("/:id", handleGetProfile)
		p.POST("/batch", handleGetProfilesBatch)
		p.GET("/user/me/active", handleGetMyActiveProfile)
		p.GET("/user/:user_id", handleListProfilesForUser)
		p.PUT("/:id", handleUpdateProfile)
		p.POST("/:id/set_active", handleSetProfileActive)
		p.DELETE("/:id", handleDeleteProfile)
		p.POST("/:id/image", handleUploadProfileImage)
		p.DELETE("/", handleDeleteAllProfiles)
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
