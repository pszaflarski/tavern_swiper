package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/gin-gonic/gin"
	"google.golang.org/api/iterator"
)

var _now = func() time.Time {
	return time.Now().UTC()
}

func healthHandler(c *gin.Context) {
	c.JSON(http.StatusOK, HealthResponse{
		Service: "users",
		Status:  "ok",
	})
}

func checkRootAdminHandler(c *gin.Context) {
	db, err := getDBFunc(c.Request.Context())
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Database unavailable")
		return
	}

	iter := db.Collection("users").Where("user_type", "==", string(RootAdmin)).Limit(1).Documents(c.Request.Context())
	_, err = iter.Next()
	exists := err == nil
	if err != nil && err != iterator.Done {
		log.Printf("[ERROR] check_root_admin query failure: %v", err)
	}

	c.JSON(http.StatusOK, RootAdminExistsResponse{Exists: exists})
}

func listUsersHandler(c *gin.Context) {
	includeDeleted := c.Query("include_deleted") == "true"
	db, err := getDBFunc(c.Request.Context())
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Database unavailable")
		return
	}

	docs := db.Collection("users").Documents(c.Request.Context())
	var users []UserOut
	for {
		doc, err := docs.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			httpError(c, http.StatusInternalServerError, "Failed to stream users")
			return
		}

		var u UserOut
		data := doc.Data()
		
		// Manual mapping as we have flat structures in firestore usually
		if isDel, ok := data["is_deleted"].(bool); ok && isDel && !includeDeleted {
			continue
		}
		
		mapToUserOut(doc.ID(), data, &u)
		users = append(users, u)
	}

	if users == nil {
		users = []UserOut{}
	}
	c.JSON(http.StatusOK, users)
}

func getMeHandler(c *gin.Context) {
	auth := GetAuth(c)
	db, err := getDBFunc(c.Request.Context())
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Database unavailable")
		return
	}

	docRef := db.Collection("users").Doc(auth.UID)
	doc, err := docRef.Get(c.Request.Context())

	if err != nil {
		// Simplified check for "not found"
		if strings.Contains(err.Error(), "code = NotFound") || strings.Contains(err.Error(), "no more items") {
			// SELF-HEALING: Auto-initialize user record
			log.Printf("[INFO] Auto-initializing user record for %s (%s)", auth.UID, auth.Email)
			newData := map[string]interface{}{
				"email":      auth.Email,
				"user_type":  string(auth.Role),
				"is_premium": false,
				"is_deleted": false,
				"created_at": firestore.ServerTimestamp,
			}
			_, err = docRef.Set(c.Request.Context(), newData)
			if err != nil {
				httpError(c, http.StatusInternalServerError, "Self-healing failed")
				return
			}
			var u UserOut
			mapToUserOut(auth.UID, newData, &u)
			c.JSON(http.StatusOK, u)
			return
		}
		httpError(c, http.StatusInternalServerError, "Failed to fetch user record")
		return
	}

	var u UserOut
	mapToUserOut(doc.ID(), doc.Data(), &u)
	c.JSON(http.StatusOK, u)
}

func updateMeHandler(c *gin.Context) {
	auth := GetAuth(c)
	var body UserUpdate
	if err := c.ShouldBindJSON(&body); err != nil {
		validationError(c, err)
		return
	}

	db, err := getDBFunc(c.Request.Context())
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Database unavailable")
		return
	}

	docRef := db.Collection("users").Doc(auth.UID)
	doc, err := docRef.Get(c.Request.Context())
	if err != nil || !doc.Exists() {
		httpError(c, http.StatusNotFound, "User not found")
		return
	}

	updates := []firestore.Update{}
	if body.IsPremium != nil {
		updates = append(updates, firestore.Update{Path: "is_premium", Value: *body.IsPremium})
	}
	if body.UserType != nil {
		updates = append(updates, firestore.Update{Path: "user_type", Value: string(*body.UserType)})
	}

	if len(updates) > 0 {
		_, err = docRef.Update(c.Request.Context(), updates)
		if err != nil {
			httpError(c, http.StatusInternalServerError, "Failed to update record")
			return
		}
	}

	// Refetch for return
	doc, _ = docRef.Get(c.Request.Context())
	var u UserOut
	mapToUserOut(auth.UID, doc.Data(), &u)
	c.JSON(http.StatusOK, u)
}

func createUserHandler(c *gin.Context) {
	auth := GetAuth(c)
	var body UserCreate
	if err := c.ShouldBindJSON(&body); err != nil {
		validationError(c, err)
		return
	}

	targetUID := auth.UID
	db, err := getDBFunc(c.Request.Context())
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Database unavailable")
		return
	}

	// 1. Root Admin Singleton Logic
	if body.UserType == RootAdmin {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
		defer cancel()
		q := db.Collection("users").Where("user_type", "==", string(RootAdmin)).Limit(1).Documents(ctx)
		existingRoot, err := q.Next()
		if err == nil {
			if existingRoot.ID() == auth.UID {
				var u UserOut
				mapToUserOut(auth.UID, existingRoot.Data(), &u)
				c.JSON(http.StatusCreated, u)
				return
			}
			httpError(c, http.StatusBadRequest, "A root admin already exists.")
			return
		}
		targetUID = auth.UID
	} else if body.UID != nil {
		// 2. Admin creation logic
		if auth.Role != Admin && auth.Role != RootAdmin {
			httpError(c, http.StatusForbidden, "Admin authorization required")
			return
		}
		targetUID = *body.UID
	} else {
		// 3. Self-registration
		if body.UserType != User {
			httpError(c, http.StatusForbidden, "Can only self-register as 'user' type")
			return
		}
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	docRef := db.Collection("users").Doc(targetUID)
	doc, err := docRef.Get(ctx)
	
	if err == nil && doc.Exists() {
		log.Printf("[INFO] User record already exists for %s, returning existing record (Idempotent)", targetUID)
		var u UserOut
		mapToUserOut(targetUID, doc.Data(), &u)
		c.JSON(http.StatusCreated, u)
		return
	}

	// Create new
	newData := map[string]interface{}{
		"email":      body.Email,
		"user_type":  string(body.UserType),
		"is_premium": body.IsPremium,
		"is_deleted": body.IsDeleted,
		"created_at": firestore.ServerTimestamp,
	}
	_, err = docRef.Set(ctx, newData)
	if err != nil {
		httpError(c, http.StatusInternalServerError, fmt.Sprintf("Failed to create user record: %v", err))
		return
	}
	var u UserOut
	mapToUserOut(targetUID, newData, &u)
	c.JSON(http.StatusCreated, u)
}

func purgeAllUsersHandler(c *gin.Context) {
	db, _ := getDBFunc(c.Request.Context())
	docs, _ := db.Collection("users").Documents(c.Request.Context()).GetAll()
	
	var uids []string
	for _, d := range docs {
		uids = append(uids, d.ID())
	}

	if len(uids) > 0 {
		authSvc := os.Getenv("AUTH_SERVICE_URL")
		if authSvc == "" {
			authSvc = "http://localhost:8001"
		}
		payload, _ := json.Marshal(map[string]interface{}{"uids": uids})
		req, _ := http.NewRequest("DELETE", authSvc+"/auth/users/", bytes.NewBuffer(payload))
		http.DefaultClient.Do(req)
	}

	// Batch delete from firestore
	batch := db.Batch()
	for _, d := range docs {
		batch.Delete(d.Ref())
	}
	batch.Commit(c.Request.Context())

	c.Status(http.StatusNoContent)
}

func deleteUserHandler(c *gin.Context) {
	targetUID := c.Param("uid")
	hard := c.Query("hard") == "True"
	auth := GetAuth(c)
	db, _ := getDBFunc(c.Request.Context())

	docRef := db.Collection("users").Doc(targetUID)
	doc, err := docRef.Get(c.Request.Context())
	if err != nil || !doc.Exists() {
		httpError(c, http.StatusNotFound, "User not found")
		return
	}

	data := doc.Data()
	if data["user_type"] == string(RootAdmin) {
		if auth.Role != RootAdmin {
			httpError(c, http.StatusForbidden, "Only a Root Admin can delete another Root Admin.")
			return
		}
		q := db.Collection("users").Where("user_type", "==", string(RootAdmin)).Documents(c.Request.Context())
		activeRoots := 0
		for {
			d, err := q.Next()
			if err == iterator.Done { break }
			if isDel, ok := d.Data()["is_deleted"].(bool); ok && !isDel {
				activeRoots++
			}
		}
		if activeRoots <= 1 {
			httpError(c, http.StatusBadRequest, "Cannot delete the last active root admin.")
			return
		}
	}

	if hard {
		authSvc := os.Getenv("AUTH_SERVICE_URL")
		if authSvc == "" { authSvc = "http://localhost:8001" }
		req, _ := http.NewRequest("DELETE", fmt.Sprintf("%s/auth/users/%s", authSvc, targetUID), nil)
		http.DefaultClient.Do(req)
		docRef.Delete(c.Request.Context())
	} else {
		docRef.Update(c.Request.Context(), []firestore.Update{{Path: "is_deleted", Value: true}})
	}

	c.Status(http.StatusNoContent)
}

func restoreUserHandler(c *gin.Context) {
	targetUID := c.Param("uid")
	db, _ := getDBFunc(c.Request.Context())
	docRef := db.Collection("users").Doc(targetUID)
	doc, err := docRef.Get(c.Request.Context())
	if err != nil || !doc.Exists() {
		httpError(c, http.StatusNotFound, "User not found")
		return
	}

	docRef.Update(c.Request.Context(), []firestore.Update{{Path: "is_deleted", Value: false}})
	
	// Return updated
	updated, _ := docRef.Get(c.Request.Context())
	var u UserOut
	mapToUserOut(targetUID, updated.Data(), &u)
	c.JSON(http.StatusOK, u)
}

// Helpers
func mapToUserOut(uid string, data map[string]interface{}, u *UserOut) {
	u.UID = uid
	u.Email, _ = data["email"].(string)
	u.IsPremium, _ = data["is_premium"].(bool)
	if ut, ok := data["user_type"].(string); ok {
		u.UserType = UserType(ut)
	}
	u.IsDeleted, _ = data["is_deleted"].(bool)
	if ct, ok := data["created_at"].(time.Time); ok {
		u.CreatedAt = ct
	} else if cts, ok := data["created_at"].(string); ok {
		// Handle string timestamps if needed (Firestore SDK usually returns time.Time)
		t, _ := time.Parse(time.RFC3339, cts)
		u.CreatedAt = t
	}
}
