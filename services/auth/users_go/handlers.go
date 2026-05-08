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

// healthHandler godoc
// @Summary      Health check
// @Description  Returns the health status of the users service.
// @Tags         health
// @Produce      json
// @Success      200  {object}  HealthResponse
// @Router       /health [get]
func healthHandler(c *gin.Context) {
	c.JSON(http.StatusOK, HealthResponse{
		Service: "users",
		Status:  "ok",
	})
}

// checkRootAdminHandler godoc
// @Summary      Check if root admin exists
// @Description  Returns whether a root admin user has been registered.
// @Tags         admin
// @Produce      json
// @Success      200  {object}  RootAdminExistsResponse
// @Failure      500  {object}  ErrorResponse
// @Router       /root-admin-exists [get]
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

// listUsersHandler godoc
// @Summary      List all users
// @Description  Returns all user records. Admin or Root Admin only.
// @Tags         admin
// @Produce      json
// @Param        include_deleted  query  bool  false  "Include soft-deleted users"
// @Success      200  {array}   UserOut
// @Failure      500  {object}  ErrorResponse
// @Security     BearerAuth
// @Router       / [get]
func listUsersHandler(c *gin.Context) {
	includeDeleted := c.Query("include_deleted") == "true"
	db, err := getDBFunc(c.Request.Context())
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Database unavailable")
		return
	}

	var query Query
	if includeDeleted {
		query = db.Collection("users")
	} else {
		query = db.Collection("users").Where("is_deleted", "==", false)
	}

	docs := query.Documents(c.Request.Context())
	users := make([]UserOut, 0)
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
		mapToUserOut(doc.ID(), data, &u)
		users = append(users, u)
	}

	c.JSON(http.StatusOK, users)
}

// getMeHandler godoc
// @Summary      Get current user
// @Description  Returns the authenticated user's record. Auto-initializes if not found.
// @Tags         users
// @Produce      json
// @Success      200  {object}  UserOut
// @Failure      500  {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /me [get]
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

// updateMeHandler godoc
// @Summary      Update current user
// @Description  Updates fields on the authenticated user's record.
// @Tags         users
// @Accept       json
// @Produce      json
// @Param        body  body      UserUpdate  true  "Fields to update"
// @Success      200   {object}  UserOut
// @Failure      404   {object}  ErrorResponse
// @Failure      422   {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /me [put]
func updateMeHandler(c *gin.Context) {
	auth := GetAuth(c)
	var body UserUpdate
	if err := c.ShouldBindJSON(&body); err != nil {
		validationError(c, err)
		return
	}

	// SECURITY: Block self-promotion and premium toggling before hitting the database
	if body.IsPremium != nil {
		httpError(c, http.StatusForbidden, "Cannot change your own premium status. Contact an administrator.")
		return
	}
	if body.UserType != nil {
		httpError(c, http.StatusForbidden, "Cannot change your own role. Contact an administrator.")
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

	if body.FullName != nil {
		updates = append(updates, firestore.Update{Path: "full_name", Value: *body.FullName})
	}
	// L3: Optimization - Add missing updated_at
	updates = append(updates, firestore.Update{Path: "updated_at", Value: firestore.ServerTimestamp})

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

// adminUpdateUserHandler godoc
// @Summary      Admin update user
// @Description  Updates fields on any user's record. Admin or Root Admin only.
// @Tags         admin
// @Accept       json
// @Produce      json
// @Param        uid   path      string      true  "Target user UID"
// @Param        body  body      UserUpdate  true  "Fields to update"
// @Success      200   {object}  UserOut
// @Failure      403   {object}  ErrorResponse
// @Failure      404   {object}  ErrorResponse
// @Failure      422   {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /{uid} [put]
func adminUpdateUserHandler(c *gin.Context) {
	targetUID := c.Param("uid")
	
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

	docRef := db.Collection("users").Doc(targetUID)
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
	if body.FullName != nil {
		updates = append(updates, firestore.Update{Path: "full_name", Value: *body.FullName})
	}
	updates = append(updates, firestore.Update{Path: "updated_at", Value: firestore.ServerTimestamp})

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
	mapToUserOut(targetUID, doc.Data(), &u)
	c.JSON(http.StatusOK, u)
}

// createUserHandler godoc
// @Summary      Create a user
// @Description  Creates a new user record. Handles self-registration, admin creation, and root admin singleton logic.
// @Tags         users
// @Accept       json
// @Produce      json
// @Param        body  body      UserCreate  true  "User creation payload"
// @Success      201   {object}  UserOut
// @Failure      400   {object}  ErrorResponse
// @Failure      403   {object}  ErrorResponse
// @Failure      500   {object}  ErrorResponse
// @Security     BearerAuth
// @Router       / [post]
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

// purgeAllUsersHandler godoc
// @Summary      Purge all users
// @Description  Deletes all user records and their Firebase Auth identities. Root Admin only.
// @Tags         admin
// @Success      204  "No Content"
// @Security     BearerAuth
// @Router       / [delete]
func purgeAllUsersHandler(c *gin.Context) {
	ctx := c.Request.Context()
	db, _ := getDBFunc(ctx)
	
	authSvc := os.Getenv("AUTH_SERVICE_URL")
	if authSvc == "" {
		authSvc = "http://localhost:8001"
	}

	// L2: Paginated purge for users
	for {
		iter := db.Collection("users").Limit(100).Documents(ctx)
		docs, err := iter.GetAll()
		if err != nil || len(docs) == 0 {
			break
		}

		var uids []string
		batch := db.Batch()
		for _, d := range docs {
			uids = append(uids, d.ID())
			batch.Delete(d.Ref())
		}

		// Delete from Firebase Auth via auth service
		if len(uids) > 0 {
			payload, _ := json.Marshal(map[string]interface{}{"uids": uids})
			req, _ := http.NewRequest("DELETE", authSvc+"/auth/users/", bytes.NewBuffer(payload))
			_, _ = http.DefaultClient.Do(req)
		}

		// Commit Firestore batch
		if _, err := batch.Commit(ctx); err != nil {
			log.Printf("[ERROR] Failed to commit user purge batch: %v", err)
			break
		}
	}

	c.Status(http.StatusNoContent)
}

// deleteUserHandler godoc
// @Summary      Delete a user
// @Description  Soft-deletes or hard-deletes a user by UID. Admin or Root Admin only.
// @Tags         admin
// @Param        uid   path   string  true   "Target user UID"
// @Param        hard  query  string  false  "Set to 'True' for hard delete"
// @Success      204  "No Content"
// @Failure      400  {object}  ErrorResponse
// @Failure      403  {object}  ErrorResponse
// @Failure      404  {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /{uid} [delete]
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
		q := db.Collection("users").
			Where("user_type", "==", string(RootAdmin)).
			Where("is_deleted", "==", false).
			Documents(c.Request.Context())
		activeRoots := 0
		for {
			_, err := q.Next()
			if err == iterator.Done {
				break
			}
			activeRoots++
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

// restoreUserHandler godoc
// @Summary      Restore a soft-deleted user
// @Description  Sets is_deleted=false on a user record. Admin or Root Admin only.
// @Tags         admin
// @Produce      json
// @Param        uid  path  string  true  "Target user UID"
// @Success      200  {object}  UserOut
// @Failure      404  {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /{uid}/restore [patch]
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
	u.FullName, _ = data["full_name"].(string)
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
