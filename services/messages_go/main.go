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
		port = "8005"
	}

	r := gin.Default()

	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization"}
	r.Use(cors.New(config))

	r.GET("/messages/health", handleHealth)
	
	r.Use(AuthMiddleware())

	m := r.Group("/messages")
	{
		// Conversations
		m.POST("/conversations", handleCreateConversation)
		m.GET("/conversations/profile/:profile_id", handleListConversations)

		// Messages for a specific conversation
		m.POST("/conversations/:id/messages", handleSendMessage)
		m.GET("/conversations/:id/messages", handleGetMessages)

		// Admin
		m.DELETE("/", handleDeleteAllMessages)
	}

	log.Printf("[INFO] Messages Go Service listening on port %s", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatalf("[FATAL] Server closed: %v", err)
	}
}
