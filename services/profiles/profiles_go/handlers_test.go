package main

import (
	"context"

	"github.com/gin-gonic/gin"
)

func setupTest(publisher Publisher) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.Default()

	// Global Middleware
	r.Use(AuthMiddleware())

	// Routes matching main.go
	r.GET("/profiles/health", handleHealth)
	
	p := r.Group("/profiles")
	{
		p.GET("/all", handleListAllProfiles)
		p.POST("/", func(c *gin.Context) { handleCreateProfile(c, publisher) })
		p.GET("/:id", handleGetProfile)
		p.POST("/batch", handleGetProfilesBatch)
		p.GET("/user/me", handleListMyProfiles)
		p.GET("/user/me/active", handleGetMyActiveProfile)
		p.GET("/user/:user_id", handleListProfilesForUser)
		p.PUT("/:id", func(c *gin.Context) { handleUpdateProfile(c, publisher) })
		p.POST("/:id/set_active", func(c *gin.Context) { handleSetProfileActive(c, publisher) })
		p.DELETE("/:id", func(c *gin.Context) { handleDeleteProfile(c, publisher) })
		p.POST("/:id/image", func(c *gin.Context) { handleUploadProfileImage(c, publisher) })
		p.DELETE("/", func(c *gin.Context) { handleDeleteAllProfiles(c, publisher) })

		// Tags Group
		t := p.Group("/tags")
		{
			// Concrete paths first to avoid :id wildcard conflict
			t.POST("/search", handleSearchTags)
			t.POST("/validate", handleValidateTags)
			t.GET("/pending", handleListPendingTags)
			t.GET("/by-slug/:slug", handleGetTagBySlug)
			t.GET("/by-category/:category", handleListTagsByCategory)

			// Admin/CRUD with wildcards last
			t.POST("/", handleCreateTag)
			t.GET("/:id", handleGetTag)
			t.PUT("/:id", handleUpdateTag)
			t.DELETE("/:id", handleDeleteTag)
		}
	}

	return r
}

type mockPublisher struct {
	PublishedUpserted []ProfileOut
	PublishedDeleted  []string
	PublishedAll      []string
}

func (m *mockPublisher) PublishUpserted(ctx context.Context, p ProfileOut) {
	m.PublishedUpserted = append(m.PublishedUpserted, p)
}

func (m *mockPublisher) PublishDeleted(ctx context.Context, profileID string) {
	m.PublishedDeleted = append(m.PublishedDeleted, profileID)
}

func (m *mockPublisher) PublishAllDeleted(ctx context.Context, adminUserID string) {
	m.PublishedAll = append(m.PublishedAll, adminUserID)
}
