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

const (
	BOT_USERS_COLLECTION    = "bot_users"
	BOT_PROFILES_COLLECTION = "bot_profiles"
)

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
// @Summary      Register a new bot user
// @Description  Creates a new bot identity via Firebase Auth, initializes a user record, and stores encrypted credentials.
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
	slugIter := db.Collection(BOT_USERS_COLLECTION).
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

	_, err = db.Collection(BOT_USERS_COLLECTION).Doc(botID).Set(ctx, botData)
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
// @Param        id  path      string  true  "Bot User ID"
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

	doc, err := db.Collection(BOT_USERS_COLLECTION).Doc(botID).Get(ctx)
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
// @Summary      List all bot users
// @Description  Returns all registered bot user records.
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

	iter := db.Collection(BOT_USERS_COLLECTION).Documents(ctx)
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
// @Summary      Get a bot user by ID
// @Description  Returns the details of a specific bot user and all its profiles.
// @Tags         bots
// @Produce      json
// @Param        id  path      string  true  "Bot User ID"
// @Success      200  {object}  map[string]interface{}
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

	doc, err := db.Collection(BOT_USERS_COLLECTION).Doc(botID).Get(ctx)
	if err != nil || !doc.Exists() {
		httpError(c, http.StatusNotFound, "Bot not found")
		return
	}

	bot := mapToBotOut(doc.ID(), doc.Data())

	// Fetch all profiles for this bot user
	profileIter := db.Collection(BOT_PROFILES_COLLECTION).
		Where("bot_user_id", "==", botID).
		Documents(ctx)

	profiles := make([]BotProfileOut, 0)
	for {
		pDoc, err := profileIter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			break
		}
		profiles = append(profiles, mapToBotProfileOut(pDoc.ID(), pDoc.Data()))
	}

	c.JSON(http.StatusOK, gin.H{
		"bot":      bot,
		"profiles": profiles,
	})
}

// handleDeleteBot godoc
// @Summary      Delete a bot user
// @Description  Deletes a bot user record and all its bot profile records. The Firebase Auth user and profiles service data remain and can be manually purged.
// @Tags         bots
// @Param        id  path  string  true  "Bot User ID"
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

	docRef := db.Collection(BOT_USERS_COLLECTION).Doc(botID)
	_, err = docRef.Get(ctx)
	if err != nil {
		httpError(c, http.StatusNotFound, "Bot not found")
		return
	}

	// Delete all bot profiles for this user
	profileIter := db.Collection(BOT_PROFILES_COLLECTION).
		Where("bot_user_id", "==", botID).
		Documents(ctx)
	for {
		pDoc, err := profileIter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			break
		}
		pDoc.Ref().Delete(ctx)
	}

	// Delete the bot user record
	_, err = docRef.Delete(ctx)
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Failed to delete bot record")
		return
	}

	c.Status(http.StatusNoContent)
}

// handlePurgeBots godoc
// @Summary      Purge all bots
// @Description  Deletes all bot user records and all bot profile records. Root Admin only.
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

	// Purge both collections
	if err := db.DeleteCollection(ctx, db.Collection(BOT_USERS_COLLECTION), 100); err != nil {
		log.Printf("[ERROR] Failed to purge bot_users collection: %v", err)
		httpError(c, http.StatusInternalServerError, "Failed to purge bots")
		return
	}
	if err := db.DeleteCollection(ctx, db.Collection(BOT_PROFILES_COLLECTION), 100); err != nil {
		log.Printf("[ERROR] Failed to purge bot_profiles collection: %v", err)
		// Continue — bot_users already purged
	}

	c.Status(http.StatusNoContent)
}

// mapToBotOut converts a Firestore document to a BotOut response.
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

// mapToBotProfileOut converts a Firestore document to a BotProfileOut response.
func mapToBotProfileOut(id string, data map[string]interface{}) BotProfileOut {
	bp := BotProfileOut{BotProfileID: id}

	if v, ok := data["bot_user_id"].(string); ok {
		bp.BotUserID = v
	}
	if v, ok := data["profile_id"].(string); ok {
		bp.ProfileID = v
	}
	if v, ok := data["behavior_type"].(string); ok {
		bp.BehaviorType = v
	}
	if v, ok := data["created_at"].(time.Time); ok {
		bp.CreatedAt = v
	}

	return bp
}

// handleCreateBotProfile godoc
// @Summary      Create a profile for a bot
// @Description  Creates a profile via the profiles service using the bot's own credentials. Accepts public image URLs which are downloaded and re-uploaded. The profile is tracked in the bot_profiles collection.
// @Tags         bots
// @Accept       json
// @Produce      json
// @Param        id    path      string           true  "Bot User ID"
// @Param        body  body      BotProfileCreate true  "Profile creation payload"
// @Success      201   {object}  map[string]interface{}
// @Failure      400   {object}  ErrorResponse
// @Failure      403   {object}  ErrorResponse
// @Failure      404   {object}  ErrorResponse
// @Failure      500   {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /{id}/profile [post]
func handleCreateBotProfile(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdmin(auth.Role) {
		httpError(c, http.StatusForbidden, "Admin or root_admin required")
		return
	}

	botID := c.Param("id")

	var body BotProfileCreate
	if err := c.ShouldBindJSON(&body); err != nil {
		httpError(c, http.StatusBadRequest, err.Error())
		return
	}

	client, err := getDBFunc(c.Request.Context())
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Database connection error")
		return
	}

	doc, err := client.Collection(BOT_USERS_COLLECTION).Doc(botID).Get(c.Request.Context())
	if err != nil || !doc.Exists() {
		httpError(c, http.StatusNotFound, "Bot not found")
		return
	}

	botData := doc.Data()

	passwordEnc, ok := botData["encrypted_password"].(string)
	if !ok || len(passwordEnc) == 0 {
		httpError(c, http.StatusInternalServerError, "Bot credentials corrupted")
		return
	}

	email, _ := botData["email"].(string)

	password, err := decryptPassword(c.Request.Context(), passwordEnc)
	if err != nil {
		httpError(c, http.StatusInternalServerError, "Failed to decrypt bot credentials")
		return
	}

	jwtToken, _, err := loginAndVerify(email, password)
	if err != nil {
		httpError(c, http.StatusInternalServerError, fmt.Sprintf("Failed to login as bot: %v", err))
		return
	}

	profResp, err := createBotProfile(jwtToken, body)
	if err != nil {
		httpError(c, http.StatusInternalServerError, fmt.Sprintf("Failed to create profile: %v", err))
		return
	}

	profileID, ok := profResp["profile_id"].(string)
	if !ok || profileID == "" {
		httpError(c, http.StatusInternalServerError, "Profile service returned invalid profile_id")
		return
	}

	// Process images
	for _, imgURL := range body.ImageLinks {
		imgData, filename, err := downloadImage(imgURL)
		if err != nil {
			log.Printf("[WARN] Failed to download image %s for bot %s: %v", imgURL, botID, err)
			continue
		}

		updatedProfResp, err := uploadImageToProfile(jwtToken, profileID, imgData, filename)
		if err != nil {
			log.Printf("[WARN] Failed to upload image %s for bot %s: %v", imgURL, botID, err)
			continue
		}

		// Take the latest profile response which includes the new image URLs
		profResp = updatedProfResp
	}

	// Create a bot_profiles record linking this bot user to the new profile
	botProfileID := uuid.New().String()
	now := _now().UTC()

	botProfileData := map[string]interface{}{
		"bot_profile_id": botProfileID,
		"bot_user_id":    botID,
		"profile_id":     profileID,
		"created_at":     now,
	}
	if body.BehaviorType != "" {
		botProfileData["behavior_type"] = body.BehaviorType
	}

	_, err = client.Collection(BOT_PROFILES_COLLECTION).Doc(botProfileID).Set(c.Request.Context(), botProfileData)
	if err != nil {
		log.Printf("[WARN] Failed to save bot_profile record for bot %s, profile %s: %v", botID, profileID, err)
	}

	// Include the bot_profile metadata in the response
	profResp["bot_profile_id"] = botProfileID
	profResp["behavior_type"] = body.BehaviorType

	c.JSON(http.StatusCreated, profResp)
}

// handleListBotProfiles godoc
// @Summary      List profiles for a bot user
// @Description  Returns all profiles associated with a bot user.
// @Tags         bots
// @Produce      json
// @Param        id  path      string  true  "Bot User ID"
// @Success      200  {array}   BotProfileOut
// @Failure      403  {object}  ErrorResponse
// @Failure      404  {object}  ErrorResponse
// @Failure      500  {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /{id}/profiles [get]
func handleListBotProfiles(c *gin.Context) {
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

	// Verify the bot user exists
	botDoc, err := db.Collection(BOT_USERS_COLLECTION).Doc(botID).Get(ctx)
	if err != nil || !botDoc.Exists() {
		httpError(c, http.StatusNotFound, "Bot not found")
		return
	}

	profileIter := db.Collection(BOT_PROFILES_COLLECTION).
		Where("bot_user_id", "==", botID).
		Documents(ctx)

	profiles := make([]BotProfileOut, 0)
	for {
		pDoc, err := profileIter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			httpError(c, http.StatusInternalServerError, "Failed to list bot profiles")
			return
		}
		profiles = append(profiles, mapToBotProfileOut(pDoc.ID(), pDoc.Data()))
	}

	c.JSON(http.StatusOK, profiles)
}
