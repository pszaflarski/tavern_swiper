package main

import (
	"log"
	_ "tavern-swiper.app/messages_subscriber"
	"github.com/GoogleCloudPlatform/functions-framework-go/funcframework"
)

func main() {
	if err := funcframework.Start("8008"); err != nil {
		log.Fatalf("funcframework.Start: %v\n", err)
	}
}
