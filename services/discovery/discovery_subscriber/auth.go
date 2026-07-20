package main

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

var jwtSecret = []byte(getEnv("JWT_SECRET", "super-secret-tavern-key-123"))

var _now = time.Now

type AuthData struct {
	UID   string
	Role  string
	Email string
	Token string
}

func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Only enforce Tavern JWT on /admin endpoints
		if !strings.HasPrefix(c.Request.URL.Path, "/admin/") {
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

		// 1. Check if this is a Google OIDC token (already verified by Cloud Run IAM proxy in cloud)
		var unverifiedClaims jwt.MapClaims
		_, _, err := new(jwt.Parser).ParseUnverified(tokenStr, &unverifiedClaims)
		if err == nil {
			if iss, ok := unverifiedClaims["iss"].(string); ok && (strings.Contains(iss, "accounts.google.com") || strings.Contains(iss, "google.com")) {
				email, _ := unverifiedClaims["email"].(string)
				if strings.HasSuffix(email, "gserviceaccount.com") {
					c.Set("auth", AuthData{
						UID:   email,
						Role:  "admin",
						Email: email,
						Token: tokenStr,
					})
					c.Next()
					return
				}
			}
		}

		// 2. Fallback to standard Tavern JWT verification
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

		if role != "admin" && role != "root_admin" {
			c.JSON(http.StatusForbidden, gin.H{"detail": "Admin privilege required"})
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
