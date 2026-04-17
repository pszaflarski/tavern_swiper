package main

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
)

type ValidationDetail struct {
	Input interface{}   `json:"input"`
	Loc   []interface{} `json:"loc"`
	Msg   string        `json:"msg"`
	Type  string        `json:"type"`
}

type ValidationErrorResponse struct {
	Body   interface{}        `json:"body"`
	Detail []ValidationDetail `json:"detail"`
}

func sendValidationError(c *gin.Context, body interface{}, field string, msg string, errType string) {
	c.JSON(http.StatusUnprocessableEntity, ValidationErrorResponse{
		Body: body,
		Detail: []ValidationDetail{
			{
				Input: body,
				Loc:   []interface{}{"body", field},
				Msg:   msg,
				Type:  errType,
			},
		},
	})
}

func sendGenericError(c *gin.Context, status int, msg string) {
	c.JSON(status, gin.H{"detail": msg})
}

// ErrorResponse matches the generic FastAPI error response
type ErrorResponse struct {
	Detail string `json:"detail"`
}

func send403(c *gin.Context, msg string) {
	c.JSON(http.StatusForbidden, ErrorResponse{Detail: msg})
}

func send404(c *gin.Context, msg string) {
	c.JSON(http.StatusNotFound, ErrorResponse{Detail: msg})
}

func send400(c *gin.Context, msg string) {
	c.JSON(http.StatusBadRequest, ErrorResponse{Detail: msg})
}

func send500(c *gin.Context, msg string) {
	fmt.Printf("[ERROR] %s\n", msg)
	c.JSON(http.StatusInternalServerError, ErrorResponse{Detail: msg})
}

func send503(c *gin.Context, msg string) {
	c.JSON(http.StatusServiceUnavailable, ErrorResponse{Detail: msg})
}
