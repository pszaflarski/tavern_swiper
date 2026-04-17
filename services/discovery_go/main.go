package main

import (
	"log"
	"net/http"
	"os"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8003"
	}

	publisher, err := NewPublisher()
	if err != nil {
		log.Printf("[WARN] Pub/Sub publisher initialization failed: %v", err)
	}

	r := gin.Default()

	// CORS
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization"}
	r.Use(cors.New(config))

	// Global Middleware
	r.Use(AuthMiddleware())

	// Health check (bypasses auth internally)
	r.GET("/discovery/health", handleHealth)

	// API Group
	d := r.Group("/discovery")
	{
		d.GET("/feed/:profile_id", handleGetFeed)
		d.POST("/swipe/", func(c *gin.Context) {
			handleRecordSwipe(c, publisher)
		})
		d.GET("/matches/:id", handleGetMatch)
		d.GET("/matches/profile/:profile_id", handleListMatchesForProfile)
	}

	log.Printf("[INFO] Discovery Go Service listening on port %s", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatalf("[FATAL] Server closed: %v", err)
	}
}
