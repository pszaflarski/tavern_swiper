// @title         Auth Service API
// @version       1.0
// @description   Firebase Auth proxy for registration, login, token verification, and JWT minting.
// @host          localhost:8001
// @BasePath      /auth
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
	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization"},
		AllowCredentials: true,
	}))

	// Swagger UI
	r.GET("/auth/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	// Routes
	auth := r.Group("/auth")
	{
		auth.GET("/health", healthHandler)
		auth.POST("/verify", verifyTokenHandler)
		auth.POST("/register", registerHandler)
		auth.POST("/login", loginHandler)
		auth.POST("/dev-mint", devMintHandler)
		auth.DELETE("/users/:uid", deleteUserHandler)
		auth.DELETE("/users/", deleteUsersBulkHandler)
		auth.DELETE("/all", deleteAllHandler)
	}

	log.Printf("🚀 Auth Service (Go) starting on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
