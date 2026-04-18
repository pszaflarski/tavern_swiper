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

	// Initialize Pub/Sub
	ctx := context.Background()
	publisher, err := NewPublisher(ctx)
	if err != nil {
		log.Printf("[WARN] Pub/Sub publisher initialization failed: %v", err)
	}

	// Routes
	r.GET("/profiles/health", handleHealth)
	
	// Profiles Group
	p := r.Group("/profiles")
	{
		p.GET("/all", handleListAllProfiles)
		p.POST("/", func(c *gin.Context) { handleCreateProfile(c, publisher) })
		p.GET("/:id", handleGetProfile)
		p.POST("/batch", handleGetProfilesBatch)
		p.GET("/user/me/active", handleGetMyActiveProfile)
		p.GET("/user/:user_id", handleListProfilesForUser)
		p.PUT("/:id", func(c *gin.Context) { handleUpdateProfile(c, publisher) })
		p.POST("/:id/set_active", func(c *gin.Context) { handleSetProfileActive(c, publisher) })
		p.DELETE("/:id", func(c *gin.Context) { handleDeleteProfile(c, publisher) })
		p.POST("/:id/image", func(c *gin.Context) { handleUploadProfileImage(c, publisher) })
		p.DELETE("/", func(c *gin.Context) { handleDeleteAllProfiles(c, publisher) })
	}

	log.Printf("[INFO] Profiles Go Service starting on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("[CRITICAL] Failed to run server: %v", err)
	}
}
