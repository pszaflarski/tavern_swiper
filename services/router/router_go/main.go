// @BasePath      /router
package main

import (
	"log"
	"net/http"
	"os"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
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

	log.Printf("[INFO] Router Go Service listening on port %s", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatalf("[FATAL] Server closed: %v", err)
	}
}
