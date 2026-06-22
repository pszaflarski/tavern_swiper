package main

import (
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

var jwtSecret = []byte(getEnv("JWT_SECRET", "super-secret-tavern-key-123"))

var _now = time.Now

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	if key == "JWT_SECRET" {
		projectID := os.Getenv("GOOGLE_CLOUD_PROJECT")
		isEmulator := os.Getenv("FIREBASE_AUTH_EMULATOR_HOST") != ""
		isDevProject := strings.HasSuffix(projectID, "-dev")
		if !isEmulator && !isDevProject && !strings.HasSuffix(os.Args[0], ".test") {
			panic("CRITICAL: " + key + " is missing in non-dev environment. Failing hard.")
		}
	}
	return fallback
}

type AuthData struct {
	UID   string
	Role  string
	Email string
	Token string
}

func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Health check bypasses auth
		if c.Request.URL.Path == "/notifications/health" {
			c.Next()
			return
		}

		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"detail": "Authorization header required"})
			c.Abort()
			return
		}

		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"detail": "Invalid authorization format"})
			c.Abort()
			return
		}

		tokenStr := parts[1]
		claims := jwt.MapClaims{}
		token, err := jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}
			return jwtSecret, nil
		}, jwt.WithTimeFunc(_now))

		if err != nil || !token.Valid {
			msg := "Invalid Tavern token"
			if err != nil {
				if strings.Contains(err.Error(), "expired") {
					msg = "Tavern token has expired"
				} else {
					msg = fmt.Sprintf("Invalid Tavern token: %v", err)
				}
			}
			c.JSON(http.StatusUnauthorized, gin.H{"detail": msg})
			c.Abort()
			return
		}

		uid, _ := claims["sub"].(string)
		role, _ := claims["role"].(string)
		email, _ := claims["email"].(string)

		if uid == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"detail": "Invalid token payload"})
			c.Abort()
			return
		}

		c.Set("auth", AuthData{
			UID:   uid,
			Role:  role,
			Email: email,
			Token: tokenStr,
		})
		c.Next()
	}
}

func GetAuth(c *gin.Context) AuthData {
	val, ok := c.Get("auth")
	if !ok {
		return AuthData{}
	}
	return val.(AuthData)
}

func IsAdmin(role string) bool {
	return role == "admin" || role == "root_admin"
}
