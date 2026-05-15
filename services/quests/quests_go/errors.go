package main

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

func send400(c *gin.Context, msg string) {
	log.Printf("[ERROR] HTTP 400: %s", msg)
	c.JSON(http.StatusBadRequest, ErrorResponse{Detail: msg})
}

func send403(c *gin.Context, msg string) {
	log.Printf("[ERROR] HTTP 403: %s", msg)
	c.JSON(http.StatusForbidden, ErrorResponse{Detail: msg})
}

func send404(c *gin.Context, msg string) {
	log.Printf("[ERROR] HTTP 404: %s", msg)
	c.JSON(http.StatusNotFound, ErrorResponse{Detail: msg})
}

func send409(c *gin.Context, msg string) {
	log.Printf("[ERROR] HTTP 409: %s", msg)
	c.JSON(http.StatusConflict, ErrorResponse{Detail: msg})
}

func send500(c *gin.Context, msg string) {
	log.Printf("[ERROR] HTTP 500: %s", msg)
	c.JSON(http.StatusInternalServerError, ErrorResponse{Detail: msg})
}

func send503(c *gin.Context, msg string) {
	log.Printf("[ERROR] HTTP 503: %s", msg)
	c.JSON(http.StatusServiceUnavailable, ErrorResponse{Detail: msg})
}
