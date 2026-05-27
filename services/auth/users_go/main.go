// @BasePath      /users
// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
package main

import (
	"log"
	"os"
	"strings"

	_ "tavern-swiper.app/users_go/docs"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
)

func main() {
	_ = godotenv.Load()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8006" // Default for Users service
	}

	// Resolve service URLs from the router (hard fail if unavailable)
	initServiceURLs()

	r := gin.Default()

	// Middleware
	origins := os.Getenv("ALLOWED_ORIGINS")
	config := cors.DefaultConfig()
	if origins != "" {
		config.AllowOrigins = strings.Split(origins, ",")
	} else {
		config.AllowAllOrigins = true
	}
	config.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization"}
	r.Use(cors.New(config))

	// Swagger UI (before auth)
	r.GET("/users/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	// Routes
	users := r.Group("/users")
	{
		users.GET("/health", healthHandler)
		users.GET("/root-admin-exists", checkRootAdminHandler)

		// Auth protected routes
		auth := users.Group("/")
		auth.Use(AuthMiddleware())
		{
			auth.GET("/me", getMeHandler)
			auth.PUT("/me", updateMeHandler)
			auth.POST("/", createUserHandler)

			// Admin restricted
			admin := auth.Group("/")
			admin.Use(RequireRole(Admin, RootAdmin))
			{
				admin.GET("/", listUsersHandler)
				admin.PATCH("/:uid/restore", restoreUserHandler)
				admin.DELETE("/:uid", deleteUserHandler)
				admin.PUT("/:uid", adminUpdateUserHandler)
			}

			// Root Admin restricted
			root := auth.Group("/")
			root.Use(RequireRole(RootAdmin))
			{
				root.DELETE("/", purgeAllUsersHandler)
			}
		}
	}

	log.Printf("🚀 Users Service (Go) starting on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
