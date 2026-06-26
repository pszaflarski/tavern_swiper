// @BasePath      /messages
// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"

	_ "messages_go/docs"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
)

// messagePublisher is the package-level Pub/Sub publisher for message events.
var messagePublisher MessagePublisher

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8005"
	}

	// Resolve service URLs from the router (hard fail if unavailable)
	initServiceURLs()

	// Initialize cross-service clients (URLs come from the router)
	profilesClient = NewProfilesClient()

	// Initialize Pub/Sub publisher for message events (non-fatal if it fails)
	ctx := context.Background()
	pub, err := NewMessagePublisher(ctx)
	if err != nil {
		log.Printf("[WARN] Failed to initialize message publisher: %v (events will not be published)", err)
	} else {
		messagePublisher = pub
	}

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

	// Swagger UI (before auth middleware)
	r.GET("/messages/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	r.GET("/messages/health", handleHealth)
	
	r.Use(AuthMiddleware())

	m := r.Group("/messages")
	{
		// Conversations
		m.POST("/conversations", handleCreateConversation)
		m.GET("/conversations/profile/:profile_id", handleListConversations)
		m.GET("/conversations/:id", handleGetConversation)

		// Messages for a specific conversation
		m.POST("/conversations/:id/messages", handleSendMessage)
		m.GET("/conversations/:id/messages", handleGetMessages)
		m.POST("/conversations/:id/typing", handleTyping)

		// Dice
		m.POST("/roll-dice", handleRollDice)

		// Matches (served from local discovery_matches_cache)
		m.GET("/matches/profile/:profile_id", handleListMatches)

		// Admin
		m.DELETE("/", handleDeleteAllMessages)
	}

	log.Printf("[INFO] Messages Go Service listening on port %s", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatalf("[FATAL] Server closed: %v", err)
	}
}

