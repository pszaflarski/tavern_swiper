package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"google.golang.org/api/iterator"
)

const BOTS_COLLECTION = "bots"

// handleHealth godoc
// @Summary      Health check
// @Description  Returns the health status of the bots service.
// @Tags         health
// @Produce      json
// @Success      200  {object}  HealthResponse
// @Router       /health [get]
func handleHealth(c *gin.Context) {
	c.JSON(http.StatusOK, HealthResponse{Service: "bots", Status: "ok"})
}

// handleRegisterBot godoc
// @Summary      Register a new bot
// @Description  Creates a new bot identity via Firebase Auth, initializes a user record, and optionally creates a profile. Credentials are encrypted and stored.
// @Tags         bots
// @Accept       json
// @Produce      json
// @Param        body  body      BotCreate  true  "Bot creation payload"
// @Success      201   {object}  BotOut
// @Failure      400   {object}  ErrorResponse
// @Failure      403   {object}  ErrorResponse
// @Failure      409   {object}  ErrorResponse
// @Failure      500   {object}  ErrorResponse
// @Security     BearerAuth
// @Router       / [post]
func handleRegisterBot(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdmin(auth.Role) {
		httpError(c, http.StatusForbidden, "Admin authorization required")
		return
	}

	var body BotCreate
	if err := c.ShouldBindJSON(&body); err != nil {
		validationError(c, err)
		return
	}

	ctx := context.Background()
	db, err := getDBFunc(ctx)
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Database unavailable")
		return
	}

	// Check for duplicate slug
	slugIter := db.Collection(BOTS_COLLECTION).
		Where("slug", "==", body.Slug).
		Limit(1).
		Documents(ctx)
	existing, err := slugIter.Next()
	if err == nil && existing != nil {
		data := existing.Data()
		b := mapToBotOut(existing.ID(), data)
		c.JSON(http.StatusConflict, gin.H{
			"detail":       fmt.Sprintf("Bot with slug '%s' already exists", body.Slug),
			"existing_bot": b,
		})
		return
	}

	email := fmt.Sprintf("bot-%s@bots.tavernswiper.internal", body.Slug)
	password := generateRandomPassword()

	log.Printf("[INFO] Registering bot: %s (%s)", body.Slug, email)

	// 1. Firebase Auth Registration
	if err := registerFirebaseUser(email, password); err != nil {
		log.Printf("[ERROR] Firebase registration failed: %v", err)
		httpError(c, http.StatusInternalServerError, "Failed to register bot identity")
		return
	}

	// 2. Login to get token
	jwtToken, firebaseUID, err := loginAndVerify(email, password)
	if err != nil {
		log.Printf("[ERROR] Login and verify failed: %v", err)
		httpError(c, http.StatusInternalServerError, "Failed to obtain bot token")
		return
	}

	// 3. Ensure user record exists
	if err := initUserRecord(jwtToken); err != nil {
		log.Printf("[ERROR] User record init failed: %v", err)
		httpError(c, http.StatusInternalServerError, "Failed to initialize user record")
		return
	}

	// 4. Encrypt password and store in bots DB
	encryptedPassword, err := encryptPassword(ctx, password)
	if err != nil {
		log.Printf("[ERROR] Failed to encrypt password: %v", err)
		httpError(c, http.StatusInternalServerError, "Internal security error")
		return
	}

	botID := uuid.New().String()
	now := _now().UTC()

	botData := map[string]interface{}{
		"bot_id":             botID,
		"slug":               body.Slug,
		"display_name":       body.DisplayName,
		"firebase_uid":       firebaseUID,
		"email":              email,
		"encrypted_password": encryptedPassword,
		"state":              "active",
		"created_at":         now,
	}

	_, err = db.Collection(BOTS_COLLECTION).Doc(botID).Set(ctx, botData)
	if err != nil {
		log.Printf("[ERROR] Failed to save bot record: %v", err)
		httpError(c, http.StatusInternalServerError, "Failed to save bot record")
		return
	}

	c.JSON(http.StatusCreated, BotOut{
		BotID:       botID,
		Slug:        body.Slug,
		DisplayName: body.DisplayName,
		FirebaseUID: firebaseUID,
		Email:       email,
		State:       "active",
		CreatedAt:   now,
	})
}

// handleGetCreds godoc
// @Summary      Get bot credentials
// @Description  Decrypts and returns the bot's login credentials. Verifies they work first. If verification fails (e.g. after an environment wipe), the bot is automatically re-registered.
// @Tags         bots
// @Produce      json
// @Param        id  path      string  true  "Bot ID"
// @Success      200  {object}  CredsResponse
// @Failure      403  {object}  ErrorResponse
// @Failure      404  {object}  ErrorResponse
// @Failure      500  {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /{id}/creds [post]
func handleGetCreds(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdmin(auth.Role) {
		httpError(c, http.StatusForbidden, "Admin authorization required")
		return
	}

	botID := c.Param("id")
	ctx := context.Background()
	db, err := getDBFunc(ctx)
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Database unavailable")
		return
	}

	doc, err := db.Collection(BOTS_COLLECTION).Doc(botID).Get(ctx)
	if err != nil || !doc.Exists() {
		httpError(c, http.StatusNotFound, "Bot not found")
		return
	}

	data := doc.Data()
	email, _ := data["email"].(string)
	encryptedPassword, _ := data["encrypted_password"].(string)

	password, err := decryptPassword(ctx, encryptedPassword)
	if err != nil {
		log.Printf("[ERROR] Failed to decrypt password for bot %s: %v", botID, err)
		httpError(c, http.StatusInternalServerError, "Failed to decrypt credentials")
		return
	}

	note := ""

	// Self-healing: verify creds work. If login fails, re-register.
	_, _, loginErr := loginAndVerify(email, password)
	if loginErr != nil {
		log.Printf("[WARN] Bot login failed for %s: %v. Attempting to re-register...", email, loginErr)

		if err := registerFirebaseUser(email, password); err != nil {
			log.Printf("[ERROR] Re-registration failed: %v", err)
			httpError(c, http.StatusInternalServerError, "Bot identity lost and re-registration failed")
			return
		}

		jwtToken, _, err := loginAndVerify(email, password)
		if err != nil {
			log.Printf("[ERROR] Login after re-registration failed: %v", err)
			httpError(c, http.StatusInternalServerError, "Bot login failed after re-registration")
			return
		}

		if err := initUserRecord(jwtToken); err != nil {
			log.Printf("[ERROR] User record init failed after re-registration: %v", err)
			// Continue anyway, creds work
		}

		note = "Bot was automatically re-registered."
	}

	c.JSON(http.StatusOK, CredsResponse{
		Email:    email,
		Password: password,
		Note:     note,
	})
}

// handleListBots godoc
// @Summary      List all bots
// @Description  Returns all registered bot records.
// @Tags         bots
// @Produce      json
// @Success      200  {array}   BotOut
// @Failure      403  {object}  ErrorResponse
// @Failure      500  {object}  ErrorResponse
// @Security     BearerAuth
// @Router       / [get]
func handleListBots(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdmin(auth.Role) {
		httpError(c, http.StatusForbidden, "Admin authorization required")
		return
	}

	ctx := context.Background()
	db, err := getDBFunc(ctx)
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Database unavailable")
		return
	}

	iter := db.Collection(BOTS_COLLECTION).Documents(ctx)
	bots := make([]BotOut, 0)

	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			httpError(c, http.StatusInternalServerError, "Failed to list bots")
			return
		}

		bots = append(bots, mapToBotOut(doc.ID(), doc.Data()))
	}

	c.JSON(http.StatusOK, bots)
}

// handleGetBot godoc
// @Summary      Get a bot by ID
// @Description  Returns the details of a specific bot.
// @Tags         bots
// @Produce      json
// @Param        id  path      string  true  "Bot ID"
// @Success      200  {object}  BotOut
// @Failure      403  {object}  ErrorResponse
// @Failure      404  {object}  ErrorResponse
// @Failure      500  {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /{id} [get]
func handleGetBot(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdmin(auth.Role) {
		httpError(c, http.StatusForbidden, "Admin authorization required")
		return
	}

	botID := c.Param("id")
	ctx := context.Background()
	db, err := getDBFunc(ctx)
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Database unavailable")
		return
	}

	doc, err := db.Collection(BOTS_COLLECTION).Doc(botID).Get(ctx)
	if err != nil || !doc.Exists() {
		httpError(c, http.StatusNotFound, "Bot not found")
		return
	}

	c.JSON(http.StatusOK, mapToBotOut(doc.ID(), doc.Data()))
}

// handleDeleteBot godoc
// @Summary      Delete a bot
// @Description  Deletes a bot record. The Firebase Auth user and profile remain and can be manually purged.
// @Tags         bots
// @Param        id  path  string  true  "Bot ID"
// @Success      204  "No Content"
// @Failure      403  {object}  ErrorResponse
// @Failure      404  {object}  ErrorResponse
// @Failure      500  {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /{id} [delete]
func handleDeleteBot(c *gin.Context) {
	auth := GetAuth(c)
	if auth.Role != "root_admin" {
		httpError(c, http.StatusForbidden, "Root Admin authorization required")
		return
	}

	botID := c.Param("id")
	ctx := context.Background()
	db, err := getDBFunc(ctx)
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Database unavailable")
		return
	}

	docRef := db.Collection(BOTS_COLLECTION).Doc(botID)
	_, err = docRef.Get(ctx)
	if err != nil {
		httpError(c, http.StatusNotFound, "Bot not found")
		return
	}

	// Just delete the bot record. The Firebase user/profile remain (can be manually purged)
	_, err = docRef.Delete(ctx)
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Failed to delete bot record")
		return
	}

	c.Status(http.StatusNoContent)
}

// handlePurgeBots godoc
// @Summary      Purge all bots
// @Description  Deletes all bot records. Root Admin only.
// @Tags         admin
// @Success      204  "No Content"
// @Failure      403  {object}  ErrorResponse
// @Failure      500  {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /all [delete]
func handlePurgeBots(c *gin.Context) {
	auth := GetAuth(c)
	if auth.Role != "root_admin" {
		httpError(c, http.StatusForbidden, "Root Admin authorization required")
		return
	}

	ctx := context.Background()
	db, err := getDBFunc(ctx)
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Database unavailable")
		return
	}

	if err := db.DeleteCollection(ctx, db.Collection(BOTS_COLLECTION), 100); err != nil {
		log.Printf("[ERROR] Failed to purge bots collection: %v", err)
		httpError(c, http.StatusInternalServerError, "Failed to purge bots")
		return
	}

	c.Status(http.StatusNoContent)
}

// mapToBotOut safely maps Firestore data to a BotOut struct.
func mapToBotOut(id string, data map[string]interface{}) BotOut {
	b := BotOut{BotID: id}

	if v, ok := data["slug"].(string); ok {
		b.Slug = v
	}
	if v, ok := data["display_name"].(string); ok {
		b.DisplayName = v
	}
	if v, ok := data["firebase_uid"].(string); ok {
		b.FirebaseUID = v
	}
	if v, ok := data["email"].(string); ok {
		b.Email = v
	}
	if v, ok := data["state"].(string); ok {
		b.State = v
	}
	if v, ok := data["created_at"].(time.Time); ok {
		b.CreatedAt = v
	}

	return b
}
