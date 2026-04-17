package main

import (
	"context"
	"log"
	"os"

	"github.com/GoogleCloudPlatform/functions-framework-go/funcframework"
	_ "tavern-swiper.app/discovery_subscriber"
)

func main() {
	// The HandleProfileEvent function is registered in the package's init() function
	ctx := context.Background()
	port := "8080"
	if p := os.Getenv("PORT"); p != "" {
		port = p
	}

	if err := funcframework.Start(port); err != nil {
		log.Fatalf("funcframework.Start: %v\n", err)
	}
}
