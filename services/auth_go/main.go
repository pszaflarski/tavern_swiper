package main

import (
	"log"
	"os"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
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
