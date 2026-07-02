// @title           Profiles Service API
// @version         1.0
// @description     Profile CRUD, image uploads, and active profile management.
// @BasePath      /profiles
// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
package main

import (
	"context"
	"log"
	"os"
	"strings"

	_ "tavern-swiper.app/profiles_go/docs"

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

	// Initialize Pub/Sub
	ctx := context.Background()
	publisher, err := NewPublisher(ctx)
	if err != nil {
		log.Printf("[WARN] Pub/Sub publisher initialization failed: %v", err)
	}

	// Swagger UI (before auth middleware)
	r.GET("/profiles/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	// Public sharing endpoints (before auth middleware)
	r.GET("/profiles/shared/:id", handleGetSharedProfile)
	r.POST("/profiles/:id/unshare", func(c *gin.Context) { handleUnshareProfile(c, publisher) })

	// Global Middleware
	r.Use(AuthMiddleware())

	// Routes
	r.GET("/profiles/health", handleHealth)

	// Profiles Group
	p := r.Group("/profiles")
	{
		p.GET("/all", handleListAllProfiles)
		p.POST("/", func(c *gin.Context) { handleCreateProfile(c, publisher) })
		p.GET("/:id", handleGetProfile)
		p.POST("/batch", handleGetProfilesBatch)
		p.GET("/user/me", handleListMyProfiles)
		p.GET("/user/me/active", func(c *gin.Context) { handleGetMyActiveProfile(c, publisher) })
		p.GET("/user/:user_id", handleListProfilesForUser)
		p.PUT("/:id", func(c *gin.Context) { handleUpdateProfile(c, publisher) })
		p.POST("/:id/set_active", func(c *gin.Context) { handleSetProfileActive(c, publisher) })
		p.DELETE("/:id", func(c *gin.Context) { handleDeleteProfile(c, publisher) })
		p.POST("/:id/image", func(c *gin.Context) { handleUploadProfileImage(c, publisher) })
		p.DELETE("/", func(c *gin.Context) { handleDeleteAllProfiles(c, publisher) })
		p.POST("/:id/share", func(c *gin.Context) { handleShareProfile(c, publisher) })
		p.POST("/:id/claim", func(c *gin.Context) { handleClaimProfile(c, publisher) })

		// Tags Group
		t := p.Group("/tags")
		{
			// Concrete paths first to avoid :id wildcard conflict
			t.POST("/search", handleSearchTags)
			t.POST("/validate", handleValidateTags)
			t.GET("/pending", handleListPendingTags)
			t.GET("/by-slug/:slug", handleGetTagBySlug)
			t.GET("/by-category/:category", handleListTagsByCategory)

			// Admin/CRUD with wildcards last
			t.POST("/", handleCreateTag)
			t.GET("/:id", handleGetTag)
			t.PUT("/:id", handleUpdateTag)
			t.DELETE("/:id", handleDeleteTag)
		}
	}

	log.Printf("[INFO] Profiles Go Service starting on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("[CRITICAL] Failed to run server: %v", err)
	}
}
