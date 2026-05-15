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

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"

	_ "tavern-swiper.app/quests_go/docs"
)

func main() {
	_ = godotenv.Load()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8013"
	}

	r := gin.Default()

	// CORS Setup
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
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

		// Quest Status (Bot/Admin for write, user own for read)
		q.POST("/status/", handleUpdateQuestStatus)
		q.GET("/status/:user_id", handleGetUserQuestStatuses)
	}

	log.Printf("[INFO] Quests Go Service starting on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("[CRITICAL] Failed to run server: %v", err)
	}
}
