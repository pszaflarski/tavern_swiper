package main

import (
	"context"

	"github.com/gin-gonic/gin"
)

func setupTest(publisher Publisher) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.Default()

	// Public sharing endpoints (before auth middleware)
	r.GET("/profiles/shared/:id", handleGetSharedProfile)
	r.POST("/profiles/:id/unshare", func(c *gin.Context) { handleUnshareProfile(c, publisher) })

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
		p.GET("/user/me/active", func(c *gin.Context) { handleGetMyActiveProfile(c, publisher) })
		p.GET("/user/:user_id", handleListProfilesForUser)
		p.PUT("/:id", func(c *gin.Context) { handleUpdateProfile(c, publisher) })
		p.POST("/:id/set_active", func(c *gin.Context) { handleSetProfileActive(c, publisher) })
		p.DELETE("/:id", func(c *gin.Context) { handleDeleteProfile(c, publisher) })
		p.POST("/:id/image", func(c *gin.Context) { handleUploadProfileImage(c, publisher) })
		p.DELETE("/", func(c *gin.Context) { handleDeleteAllProfiles(c, publisher) })
		p.POST("/:id/share", func(c *gin.Context) { handleShareProfile(c, publisher) })
		p.POST("/:id/claim", func(c *gin.Context) { handleClaimProfile(c, publisher) })

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

func (m *mockPublisher) PublishUpserted(ctx context.Context, p ProfileOut) error {
	m.PublishedUpserted = append(m.PublishedUpserted, p)
	return nil
}

func (m *mockPublisher) PublishDeleted(ctx context.Context, profileID string) error {
	m.PublishedDeleted = append(m.PublishedDeleted, profileID)
	return nil
}

func (m *mockPublisher) PublishAllDeleted(ctx context.Context, adminUserID string) error {
	m.PublishedAll = append(m.PublishedAll, adminUserID)
	return nil
}
