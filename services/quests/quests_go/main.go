// @title           Quests Service API
// @version         1.0
// @description     Item catalog, user inventory, and quest management for Tavern Swiper.
// @BasePath        /quests
// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
package main

import (
	"log"
	"os"
	"strings"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"

	_ "tavern-swiper.app/quests_go/docs"
)

func main() {
	_ = godotenv.Load()

	// Initialize service URLs from router (for profiles service resolution)
	initServiceURLs()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8013"
	}

	r := gin.Default()

	// CORS Setup
	origins := os.Getenv("ALLOWED_ORIGINS")
	config := cors.DefaultConfig()
	if origins != "" {
		config.AllowOrigins = strings.Split(origins, ",")
	} else {
		config.AllowAllOrigins = true
	}
	config.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization"}
	r.Use(cors.New(config))

	// Swagger UI (before auth middleware)
	r.GET("/quests/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	// Global Middleware
	r.Use(AuthMiddleware())

	// Routes
	r.GET("/quests/health", handleHealth)

	q := r.Group("/quests")
	{
		// Item Definitions (Admin only for write, Admin/Bot for read)
		q.POST("/items/", handleCreateItem)
		q.GET("/items/", handleListItems)
		q.GET("/items/:item_id", handleGetItem)
		q.PUT("/items/:item_id", handleUpdateItem)
		q.DELETE("/items/:item_id", handleDeleteItem)

		// Inventory
		q.GET("/inventory/:user_id", handleGetInventory)
		q.POST("/inventory/grant", handleGrantItem)
		q.POST("/inventory/deduct", handleDeductItem)

		// Quest Templates (Admin for write, any auth for read)
		q.POST("/templates/", handleCreateQuestTemplate)
		q.GET("/templates/", handleListQuestTemplates)
		q.GET("/templates/:quest_id", handleGetQuestTemplate)
		q.GET("/templates/:quest_id/checkpoints", handleListCheckpointTemplates)

		// Checkpoint Templates (Admin only)
		q.POST("/checkpoints/", handleCreateCheckpointTemplate)

		// Checkpoint Status (query endpoints)
		q.GET("/checkpoints/status/:user_id/:quest_id", handleGetCheckpointStatuses)
		q.GET("/checkpoints/status/by-profile/:profile_id/:quest_id", handleGetCheckpointStatusesByProfile)
		q.GET("/checkpoints/by-bot/:bot_id", handleGetCheckpointsByBot)

		// Quest Status (Bot/Admin for write, user own for read)
		q.POST("/status/", handleUpdateQuestStatus)
		q.GET("/status/:user_id", handleGetUserQuestStatuses)

		// Quest Status by Profile (resolves profile_id → user_id internally)
		q.POST("/status/by-profile/", handleUpdateQuestStatusByProfile)
		q.GET("/status/by-profile/:profile_id", handleGetUserQuestStatusesByProfile)
	}

	log.Printf("[INFO] Quests Go Service starting on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("[CRITICAL] Failed to run server: %v", err)
	}
}
