package main

import (
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"tavern-swiper.app/discovery_worker"
)

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

func main() {
	port := getEnv("PORT", "8014")
	r := gin.Default()

	// Wellness check
	r.GET("/", func(c *gin.Context) {
		c.String(http.StatusOK, "Discovery Worker is running")
	})

	// Cleanup trigger endpoint
	r.POST("/cleanup", discovery_worker.HandleCleanup)

	log.Printf("🚀 Discovery Worker listening on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("❌ Failed to start server: %v", err)
	}
}
