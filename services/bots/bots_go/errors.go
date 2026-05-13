package main

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

func httpError(c *gin.Context, status int, detail interface{}) {
	log.Printf("[ERROR] HTTP %d: %v", status, detail)
	c.JSON(status, ErrorResponse{Detail: detail})
}

func validationError(c *gin.Context, err error) {
	log.Printf("[ERROR] Validation error: %v", err)
	c.JSON(http.StatusUnprocessableEntity, ErrorResponse{Detail: err.Error()})
}
