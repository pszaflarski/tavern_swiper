package main

import (
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// Replicates FastAPI's error format: {"detail": "message"} or {"detail": [...]}
func httpError(c *gin.Context, status int, message string) {
	log.Printf("[ERROR] HTTP %d: %s", status, message)
	c.JSON(status, ErrorResponse{
		Detail: message,
	})
}

// Replicates a simplified validation error format matching FastAPI's structure
func validationError(c *gin.Context, err error) {
	msg := err.Error()
	errType := "value_error"
	input := msg
	field := "body"
	if strings.Contains(msg, "bool") {
		msg = "Input should be a valid boolean, unable to interpret input"
		errType = "bool_parsing"
	}

	items := []interface{}{
		map[string]interface{}{
			"input": input,
			"loc":   []interface{}{"body", field},
			"msg":   msg,
			"type":  errType,
		},
	}
	c.JSON(http.StatusUnprocessableEntity, ErrorResponse{
		Detail: items,
	})
}

// Helper to check if string contains substring
func contains(s, substr string) bool {
	return strings.Contains(s, substr)
}
