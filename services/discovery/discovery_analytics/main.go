package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

func getEnv(key, fallback string) string {
	if val, ok := os.LookupEnv(key); ok {
		return val
	}
	return fallback
}

func main() {
	port := getEnv("PORT", "8080")
	projectID := getEnv("GOOGLE_CLOUD_PROJECT", "tavern-swiper-dev")
	env := getEnv("ENV", "dev")

	log.Printf("🚀 Starting Discovery BigQuery CDC Replicator Service...")
	log.Printf("📌 Project: %s, Env: %s, Port: %s", projectID, env, port)

	ctx := context.Background()
	bqClient, err := NewRealBQClient(ctx, projectID, env)
	if err != nil {
		log.Fatalf("❌ Failed to initialize BigQuery client: %v", err)
	}
	defer bqClient.Close()

	// Ensure the dataset and tables are provisioned on startup
	if err := bqClient.EnsureDatasetAndTables(ctx); err != nil {
		log.Printf("⚠️ Warning: Failed to ensure dataset/tables exist: %v", err)
	}

	r := gin.Default()

	// Health check endpoints
	r.GET("/", func(c *gin.Context) {
		c.String(http.StatusOK, "Discovery CDC Replicator is running")
	})
	r.GET("/health", func(c *gin.Context) {
		c.String(http.StatusOK, "OK")
	})

	handlers := NewHandlers(bqClient)

	// Eventarc endpoint (accepting POST on root /)
	r.POST("/", handlers.HandleFirestoreEvent)

	log.Printf("🚀 Discovery Replicator Listening on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("❌ Failed to start server: %v", err)
	}
}
