package main

import (
	"context"
	"log"
	"os"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	r := gin.Default()

	// CORS Setup
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization"}
	r.Use(cors.New(config))

	// Global Middleware
	r.Use(AuthMiddleware())

	// Initialize Firestore
	ctx := context.Background()
	_, err := getDBFunc(ctx)
	if err != nil {
		log.Printf("[CRITICAL] Failed to initialize Firestore: %v", err)
		// We don't exit here to allow Cloud Run to start and return 503 instead of 500/Crash
	}

	// Routes
	r.GET("/profiles/health", handleHealth)
	
	// Profiles Group
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

	log.Printf("[INFO] Profiles Go Service starting on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("[CRITICAL] Failed to run server: %v", err)
	}
}
