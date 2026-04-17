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

	discoveryClient := NewDiscoveryClient()
	r := gin.Default()

	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization"}
	r.Use(cors.New(config))

	r.GET("/messages/health", handleHealth)
	
	r.Use(AuthMiddleware())

	m := r.Group("/messages")
	{
		m.POST("/", func(c *gin.Context) {
			handleSendMessage(c, discoveryClient)
		})
		m.GET("/:match_id", handleGetMessages)
		m.GET("/conversations/:profile_id", func(c *gin.Context) {
			handleListConversations(c, discoveryClient)
		})
		m.DELETE("/", handleDeleteAllMessages)
	}

	log.Printf("[INFO] Messages Go Service listening on port %s", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatalf("[FATAL] Server closed: %v", err)
	}
}
