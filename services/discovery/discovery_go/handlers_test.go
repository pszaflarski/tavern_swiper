package main

import (
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
	r.GET("/discovery/health", handleHealth)
	
	d := r.Group("/discovery")
	{
		d.GET("/feed/:profile_id", handleGetFeed)
		d.POST("/swipe/", func(c *gin.Context) {
			handleRecordSwipe(c, publisher)
		})
		d.GET("/matches/:id", handleGetMatch)
		d.GET("/matches/profile/:profile_id", handleListMatchesForProfile)
	}

	return r
}

func signGoTestToken(uid string, role string) string {
	now := time.Date(2026, 4, 17, 12, 0, 0, 0, time.UTC)
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
