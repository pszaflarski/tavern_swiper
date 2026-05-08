// @BasePath      /auth
// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
package main

import (
	"log"
	"os"

	_ "tavern-swiper.app/auth_go/docs"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
)

func main() {
	// Load .env if it exists
	_ = godotenv.Load()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8001"
	}

	r := gin.Default()

	// Middleware
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization"}
	r.Use(cors.New(config))

	// Swagger UI
	r.GET("/auth/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	// Routes
	auth := r.Group("/auth")
	{
		auth.GET("/health", healthHandler)
		auth.POST("/verify", verifyTokenHandler)
		auth.POST("/register", registerHandler)
		auth.POST("/login", loginHandler)

		protected := auth.Group("/")
		protected.Use(AuthMiddleware())
		{
			protected.POST("/dev-mint", devMintHandler)
			protected.DELETE("/users/:uid", deleteUserHandler)
			protected.DELETE("/users/", deleteUsersBulkHandler)
			protected.DELETE("/all", deleteAllHandler)
		}
	}

	log.Printf("🚀 Auth Service (Go) starting on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
