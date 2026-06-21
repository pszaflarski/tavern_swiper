package main

import (
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8014"
	}

	// Resolve service URLs from the router (hard fail if unavailable)
	initServiceURLs()

	r := gin.Default()

	origins := os.Getenv("ALLOWED_ORIGINS")
	config := cors.DefaultConfig()
	if origins != "" {
		config.AllowOrigins = strings.Split(origins, ",")
	} else {
		config.AllowAllOrigins = true
	}
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization"}
	r.Use(cors.New(config))

	r.GET("/notifications/health", handleHealth)

	r.Use(AuthMiddleware())

	n := r.Group("/notifications")
	{
		// Device Push Tokens
		n.POST("/tokens", handleRegisterToken)
		n.DELETE("/tokens/:token", handleUnregisterToken)

		// Pub/Sub Subscriber Endpoints (auth bypassed inside middleware)
		n.POST("/subscribers/matches", handlePubSubMatchEvent)
		n.POST("/subscribers/messages", handlePubSubMessageEvent)
	}

	log.Printf("[INFO] Notifications Go Service listening on port %s", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatalf("[FATAL] Server closed: %v", err)
	}
}
