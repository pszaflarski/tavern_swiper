package main

import (
	"fmt"
	"net/http"

	"cloud.google.com/go/firestore"
	"github.com/gin-gonic/gin"
)

// handleHealth godoc
// @Summary      Health check
// @Description  Returns the health status of the router service.
// @Tags         health
// @Produce      json
// @Success      200  {object}  map[string]string
// @Router       /health [get]
func handleHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// handleListServicesClean godoc
// @Summary      List all services
// @Description  Returns all services for a specific tag. Includes default fallbacks.
// @Tags         services
// @Produce      json
// @Param        tag  query     string  false  "Service tag environment" default(default)
// @Success      200  {object}  map[string]interface{}
// @Failure      500  {object}  map[string]string
// @Router       /services [get]
func handleListServicesClean(c *gin.Context) {
	tag := c.DefaultQuery("tag", "default")
	ctx := c.Request.Context()
	db, err := getDBFunc(ctx)
	if err != nil {
		send500(c, err.Error())
		return
	}

	// 1. Get all known service names (from 'default' tag) using Enterprise Pipeline
	knownServices := make(map[string]string)

	defaultPipeline := db.Pipeline().
		Collection("service_routes").
		Where(firestore.Equal("tag", "default"))

	defaultSnapshot := defaultPipeline.Execute(ctx)
	defaultIter := defaultSnapshot.Results()
	defer defaultIter.Stop()

	for {
		res, err := defaultIter.Next()
		if err != nil {
			break
		}
		data := res.Data()
		service, _ := data["service"].(string)
		url, _ := data["url"].(string)
		if service != "" {
			knownServices[service] = url
		}
	}

	responseMap := make(map[string]interface{})
	if tag == "default" {
		for s, url := range knownServices {
			responseMap[s] = url
		}
	} else {
		// 2. Query for the specific tag using Enterprise Pipeline
		tagPipeline := db.Pipeline().
			Collection("service_routes").
			Where(firestore.Equal("tag", tag))

		tagSnapshot := tagPipeline.Execute(ctx)
		tagIter := tagSnapshot.Results()
		defer tagIter.Stop()

		taggedServices := make(map[string]string)
		for {
			res, err := tagIter.Next()
			if err != nil {
				break
			}
			data := res.Data()
			service, _ := data["service"].(string)
			url, _ := data["url"].(string)
			if service != "" {
				taggedServices[service] = url
			}
		}

		// Merge: if service exists in 'default' but not in 'tagged', set to null
		for s := range knownServices {
			if url, ok := taggedServices[s]; ok {
				responseMap[s] = url
			} else {
				responseMap[s] = nil
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"tag":      tag,
		"services": responseMap,
	})
}

// handleGetService godoc
// @Summary      Get a specific service
// @Description  Returns the routing URL for a specific service by name and tag.
// @Tags         services
// @Produce      json
// @Param        service_name  path      string  true   "Service Name"
// @Param        tag           query     string  false  "Service tag environment" default(default)
// @Success      200           {object}  SingleServiceResponse
// @Failure      404           {object}  map[string]string
// @Failure      500           {object}  map[string]string
// @Router       /services/{service_name} [get]
func handleGetService(c *gin.Context) {
	name := c.Param("service_name")
	tag := c.DefaultQuery("tag", "default")
	ctx := c.Request.Context()
	db, err := getDBFunc(ctx)
	if err != nil {
		send500(c, err.Error())
		return
	}

	docID := fmt.Sprintf("%s_%s", name, tag)
	doc, err := db.Collection("service_routes").Doc(docID).Get(ctx)
	if err != nil {
		send404(c, fmt.Sprintf("Service %s with tag %s not found", name, tag))
		return
	}

	var route ServiceRoute
	if err := doc.DataTo(&route); err != nil {
		send500(c, "Failed to parse route data")
		return
	}

	c.JSON(http.StatusOK, SingleServiceResponse{
		Service: route.Service,
		Tag:     route.Tag,
		URL:     route.URL,
	})
}

// handleUpsertService godoc
// @Summary      Upsert a service route
// @Description  Creates or updates a service route. Admin only.
// @Tags         services
// @Accept       json
// @Produce      json
// @Param        service_name  path      string         true  "Service Name"
// @Param        body          body      ServiceUpdate  true  "Route details"
// @Success      200           {object}  map[string]string
// @Failure      400           {object}  map[string]string
// @Failure      403           {object}  map[string]string
// @Failure      500           {object}  map[string]string
// @Security     BearerAuth
// @Router       /services/{service_name} [put]
func handleUpsertService(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdmin(auth.Role) {
		send403(c, "Admin privileges required")
		return
	}

	name := c.Param("service_name")
	var input ServiceUpdate
	if err := c.ShouldBindJSON(&input); err != nil {
		send400(c, err.Error())
		return
	}

	ctx := c.Request.Context()
	db, err := getDBFunc(ctx)
	if err != nil {
		send500(c, err.Error())
		return
	}

	docID := fmt.Sprintf("%s_%s", name, input.Tag)

	// Idempotent upsert with MergeAll avoids nil-pointer panic on check
	_, err = db.Collection("service_routes").Doc(docID).Set(ctx, map[string]interface{}{
		"service":    name,
		"tag":        input.Tag,
		"url":        input.URL,
		"created_at": firestore.ServerTimestamp,
		"updated_at": firestore.ServerTimestamp,
	}, firestore.MergeAll)

	if err != nil {
		send500(c, err.Error())
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "updated", "service": name, "tag": input.Tag})
}

// handleDeleteService godoc
// @Summary      Delete a service route
// @Description  Deletes a specific service route. Admin only.
// @Tags         services
// @Produce      json
// @Param        service_name  path      string  true  "Service Name"
// @Param        tag           query     string  true  "Service tag environment"
// @Success      200           {object}  map[string]string
// @Failure      400           {object}  map[string]string
// @Failure      403           {object}  map[string]string
// @Failure      500           {object}  map[string]string
// @Security     BearerAuth
// @Router       /services/{service_name} [delete]
func handleDeleteService(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdmin(auth.Role) {
		send403(c, "Admin privileges required")
		return
	}

	name := c.Param("service_name")
	tag := c.Query("tag")
	if tag == "" {
		send400(c, "tag query parameter required for deletion")
		return
	}

	ctx := c.Request.Context()
	db, err := getDBFunc(ctx)
	if err != nil {
		send500(c, err.Error())
		return
	}

	docID := fmt.Sprintf("%s_%s", name, tag)
	_, err = db.Collection("service_routes").Doc(docID).Delete(ctx)
	if err != nil {
		send500(c, err.Error())
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "deleted", "service": name, "tag": tag})
}
