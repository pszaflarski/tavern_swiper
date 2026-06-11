// @title           Characters Service API
// @version         1.0
// @description     Predefined character templates, images, and attribution metadata.
// @BasePath      /characters
// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
package main

import (
	"log"
	"os"
	"strings"

	_ "tavern-swiper.app/characters_go/docs"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	r := gin.Default()
	r.MaxMultipartMemory = 10 << 20 // 10 MB

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
	r.GET("/characters/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	// Global Middleware
	r.Use(AuthMiddleware())

	// Health check (bypassed in auth middleware)
	r.GET("/characters/health", handleHealth)
	
	// Characters Group
	cGroup := r.Group("/characters")
	{
		// Public Character routes
		cGroup.GET("/", handleListAllCharacters)
		cGroup.GET("/random", handleGetRandomCharacter)
		cGroup.POST("/validate", handleValidateProfile)
		cGroup.GET("/:id", handleGetCharacter)

		// Admin Character mutation routes
		cGroup.POST("/", handleCreateCharacter)
		cGroup.PUT("/:id", handleUpdateCharacter)
		cGroup.DELETE("/:id", handleDeleteCharacter)

		// Image routes
		cGroup.GET("/images/by-artist/:handle", handleListImagesByArtist)
		cGroup.POST("/images", handleUploadImage)
		cGroup.PUT("/images/:id", handleUpdateImage)
		cGroup.DELETE("/images/:id", handleDeleteImage)

		// Tags routes
		tGroup := cGroup.Group("/tags")
		{
			// Public tag queries
			tGroup.POST("/search", handleSearchTags)
			tGroup.GET("/by-slug/:slug", handleGetTagBySlug)
			tGroup.GET("/by-category/:category", handleListTagsByCategory)

			// Admin tag mutation
			tGroup.GET("/:id", handleGetTag)
			tGroup.POST("/", handleCreateTag)
			tGroup.PUT("/:id", handleUpdateTag)
			tGroup.DELETE("/:id", handleDeleteTag)
		}
	}

	log.Printf("[INFO] Characters Go Service starting on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("[CRITICAL] Failed to run server: %v", err)
	}
}
