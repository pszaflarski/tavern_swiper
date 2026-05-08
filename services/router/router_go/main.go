// @title           Router Service API
// @version         1.0
// @description     Dynamic runtime service discovery for Tavern Swiper microservices.
// @BasePath        /router
// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
package main

import (
	"log"
	"os"

	_ "router_go/docs"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8010"
	}

	r := gin.Default()

	// CORS
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization"}
	r.Use(cors.New(config))

	// Swagger UI (before auth middleware)
	r.GET("/router/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	// Auth Middleware
	r.Use(AuthMiddleware())

	// Routes
	router := r.Group("/router")
	{
		router.GET("/health", handleHealth)
		router.GET("/services", handleListServicesClean)
		router.GET("/services/:service_name", handleGetService)
		router.PUT("/services/:service_name", handleUpsertService)
		router.DELETE("/services/:service_name", handleDeleteService)
	}

	log.Printf("[INFO] Router Go Service starting on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("[CRITICAL] Failed to run server: %v", err)
	}
}
