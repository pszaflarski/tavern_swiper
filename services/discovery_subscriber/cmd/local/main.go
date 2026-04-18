package main

import (
	"log"
	_ "tavern-swiper.app/discovery_subscriber"
	"github.com/GoogleCloudPlatform/functions-framework-go/funcframework"
)

func main() {
	if err := funcframework.StartHostPort("8007"); err != nil {
		log.Fatalf("funcframework.StartHostPort: %v\n", err)
	}
}
