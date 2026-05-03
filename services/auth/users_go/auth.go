package main

import (
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

var jwtSecret = []byte(getEnv("JWT_SECRET", "super-secret-tavern-key-123"))

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

type AuthData struct {
	UID   string
	Role  UserType
	Email string
	Token string
}

func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			httpError(c, http.StatusUnauthorized, "Authorization header required")
			c.Abort()
			return
		}

		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			httpError(c, http.StatusUnauthorized, "Invalid authorization format")
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
		})

		if err != nil || !token.Valid {
			// FastAPI detail mapping for non-expired tokens usually "Invalid Tavern token: ..."
			msg := "Invalid Tavern token"
			if err != nil {
				if strings.Contains(err.Error(), "expired") {
					httpError(c, http.StatusUnauthorized, "Tavern token has expired")
				} else {
					httpError(c, http.StatusUnauthorized, fmt.Sprintf("Invalid Tavern token: %v", err))
				}
			} else {
				httpError(c, http.StatusUnauthorized, msg)
			}
			c.Abort()
			return
		}

		uid, _ := claims["sub"].(string)
		role, _ := claims["role"].(string)
		email, _ := claims["email"].(string)

		if uid == "" {
			httpError(c, http.StatusUnauthorized, "Invalid token payload")
			c.Abort()
			return
		}

		c.Set("auth", AuthData{
			UID:   uid,
			Role:  UserType(role),
			Email: email,
			Token: tokenStr,
		})
		c.Next()
	}
}

func RequireRole(roles ...UserType) gin.HandlerFunc {
	return func(c *gin.Context) {
		val, exists := c.Get("auth")
		if !exists {
			httpError(c, http.StatusUnauthorized, "Authentication required")
			c.Abort()
			return
		}
		auth := val.(AuthData)
		
		allowed := false
		for _, r := range roles {
			if auth.Role == r {
				allowed = true
				break
			}
		}

		if !allowed {
			httpError(c, http.StatusForbidden, "Admin or Root Admin role required")
			c.Abort()
			return
		}
		c.Next()
	}
}

func GetAuth(c *gin.Context) AuthData {
	val, _ := c.Get("auth")
	return val.(AuthData)
}
