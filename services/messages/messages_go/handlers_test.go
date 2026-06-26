package main

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func setupTest() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.Default()

	r.GET("/messages/health", handleHealth)
	r.Use(AuthMiddleware())

	m := r.Group("/messages")
	{
		m.POST("/", handleSendMessage)
		m.GET("/:id", handleGetMessages)
		m.GET("/conversations/:profile_id", handleListConversations)
		m.POST("/roll-dice", handleRollDice)
		m.GET("/matches/profile/:profile_id", handleListMatches)
		m.DELETE("/", handleDeleteAllMessages)
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
