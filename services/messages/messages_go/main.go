// @BasePath      /messages
// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
package main

import (
	"log"
	"net/http"
	"os"

	_ "messages_go/docs"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8005"
	}

	// Resolve service URLs from the router (hard fail if unavailable)
	initServiceURLs()

	// Initialize cross-service clients (URLs come from the router)
	profilesClient = NewProfilesClient()

	r := gin.Default()

	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization"}
	r.Use(cors.New(config))

	// Swagger UI (before auth middleware)
	r.GET("/messages/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

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

		// Dice
		m.POST("/roll-dice", handleRollDice)

		// Admin
		m.DELETE("/", handleDeleteAllMessages)
	}

	log.Printf("[INFO] Messages Go Service listening on port %s", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatalf("[FATAL] Server closed: %v", err)
	}
}

