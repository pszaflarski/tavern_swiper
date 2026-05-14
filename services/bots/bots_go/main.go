// @title           Bots Service API
// @version         1.0
// @description     Manage system bots and their credentials
// @BasePath        /bots
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

	_ "tavern-swiper.app/bots_go/docs"
)

func main() {
	_ = godotenv.Load()

	initServiceURLs()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8011"
	}

	r := gin.Default()

	// CORS Setup
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization"}
	r.Use(cors.New(config))

	// Swagger UI (before auth middleware)
	r.GET("/bots/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	// Global Middleware
	r.Use(AuthMiddleware())

	// Routes
	r.GET("/bots/health", handleHealth)

	b := r.Group("/bots")
	{
		b.POST("/", handleRegisterBot)
		b.GET("/", handleListBots)
		b.POST("/:id/creds", handleGetCreds)
		b.POST("/:id/profile", handleCreateBotProfile)
		b.POST("/:id/sync", handleSyncBotProfiles)
		b.GET("/:id/profiles", handleListBotProfiles)
		b.PATCH("/:id/profiles/:profile_id", handleUpdateBotProfile)
		b.POST("/behaviors/trigger", handleBehaviorTrigger)

		// Concrete paths before wildcard to avoid route conflicts
		b.DELETE("/all", handlePurgeBots)
		b.GET("/:id", handleGetBot)
		b.DELETE("/:id", handleDeleteBot)
	}

	log.Printf("[INFO] Bots Go Service starting on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("[CRITICAL] Failed to run server: %v", err)
	}
}
