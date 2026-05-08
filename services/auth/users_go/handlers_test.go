package main

import (
	"context"
	"time"
	"firebase.google.com/go/v4/auth"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// --- Mocks ---

type mockAuthClient struct {
	deleteUserFunc  func(ctx context.Context, uid string) error
	deleteUsersFunc func(ctx context.Context, uids []string) (*auth.DeleteUsersResult, error)
}

func (m *mockAuthClient) DeleteUser(ctx context.Context, uid string) error {
	return m.deleteUserFunc(ctx, uid)
}
func (m *mockAuthClient) DeleteUsers(ctx context.Context, uids []string) (*auth.DeleteUsersResult, error) {
	return m.deleteUsersFunc(ctx, uids)
}

type mockFirestoreClient struct {
	// Add mock methods if needed
}

// --- Setup ---

func setupTest() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.Default()
	
	users := r.Group("/users")
	{
		users.GET("/health", healthHandler)
		users.GET("/root-admin-exists", checkRootAdminHandler)

		// Auth protected routes
		auth := users.Group("/")
		auth.Use(AuthMiddleware())
		{
			auth.GET("/me", getMeHandler)
			auth.PUT("/me", updateMeHandler)
			auth.POST("/", createUserHandler)

			// Admin restricted
			admin := auth.Group("/")
			admin.Use(RequireRole(Admin, RootAdmin))
			{
				admin.GET("/", listUsersHandler)
				admin.PATCH("/:uid/restore", restoreUserHandler)
				admin.DELETE("/:uid", deleteUserHandler)
				admin.PUT("/:uid", adminUpdateUserHandler)
			}

			// Root Admin restricted
			root := auth.Group("/")
			root.Use(RequireRole(RootAdmin))
			{
				root.DELETE("/", purgeAllUsersHandler)
			}
		}
	}
	return r
}

func signGoTestToken(uid string, role UserType, email string) string {
	// Replicates sign_test_token from Python with fixed iat/exp
	now := time.Date(2026, 4, 17, 10, 0, 0, 0, time.UTC)
	claims := jwt.MapClaims{
		"sub":   uid,
		"role":  string(role),
		"email": email,
		"iat":   now.Unix(),
		"exp":   now.Add(365 * 24 * time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := token.SignedString(jwtSecret)
	return s
}
