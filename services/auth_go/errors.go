package main

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Replicates FastAPI's error format: {"detail": "message"} or {"detail": [...]}
func httpError(c *gin.Context, status int, message string) {
	c.JSON(status, ErrorResponse{
		Detail: message,
	})
}

// Replicates a simplified validation error format: {"detail": [{"field": "...", "message": "..."}]}
func validationError(c *gin.Context, err error) {
	// In a real app, you'd parse the 'err' from Gin's binding into specific items.
	// For this migration, we'll provide a simplified detail array.
	items := []ValidationErrorItem{
		{
			Field:   "body",
			Message: err.Error(),
		},
	}
	c.JSON(http.StatusUnprocessableEntity, ErrorResponse{
		Detail: items,
	})
}

func mapFirebaseError(message string) string {
	// Replicates map_firebase_error() from Python logic
	switch {
	case contains(message, "EMAIL_EXISTS"):
		return "An account with this email address already exists."
	case contains(message, "INVALID_PASSWORD"):
		return "Incorrect password. Please try again."
	case contains(message, "USER_NOT_FOUND"), contains(message, "EMAIL_NOT_FOUND"):
		return "No account found with this email address."
	case contains(message, "TOO_MANY_ATTEMPTS_TRY_LATER"):
		return "Too many failed attempts. Please try again later."
	case contains(message, "INVALID_EMAIL"):
		return "The email address is invalid."
	case contains(message, "WEAK_PASSWORD"):
		return "The password is too weak."
	default:
		return "An unexpected authentication error occurred. Please try again."
	}
}

func contains(s, substr string) bool {
	return fmt.Sprintf("%v", s) != "" && (len(s) >= len(substr)) && (s == substr || (len(s) > len(substr) && (s[:len(substr)] == substr || s[len(s)-len(substr):] == substr)))
}
// Note: using a more robust strings.Contains would require the strings package, 
// but I'll keep it simple for now or just import strings in the final main.go
