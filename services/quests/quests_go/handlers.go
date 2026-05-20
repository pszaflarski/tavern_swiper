package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sort"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// handleHealth godoc
// @Summary      Health check
// @Description  Returns service health status
// @Tags         health
// @Produce      json
// @Success      200  {object}  map[string]string
// @Router       /quests/health [get]
func handleHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "quests_go"})
}

// =============================================================================
// Item Definition Handlers (Admin Only)
// =============================================================================

// handleCreateItem godoc
// @Summary      Create item definition
// @Description  Create a new item in the game catalog. Admin only.
// @Tags         items
// @Accept       json
// @Produce      json
// @Param        body  body      ItemDefinitionCreate  true  "Item definition"
// @Success      201   {object}  ItemDefinition
// @Failure      400   {object}  ErrorResponse
// @Failure      403   {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /quests/items/ [post]
func handleCreateItem(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdmin(auth.Role) {
		send403(c, "Only admins can create items")
		return
	}

	var req ItemDefinitionCreate
	if err := c.ShouldBindJSON(&req); err != nil {
		send400(c, fmt.Sprintf("Invalid request body: %v", err))
		return
	}

	if !validCategories[req.Category] {
		send400(c, fmt.Sprintf("Invalid category '%s'. Valid: currency, weapon, armor, consumable, cosmetic, key_item, badge", req.Category))
		return
	}
	if req.Rarity != "" && !validRarities[req.Rarity] {
		send400(c, fmt.Sprintf("Invalid rarity '%s'. Valid: common, uncommon, rare, epic, legendary", req.Rarity))
		return
	}
	for _, a := range req.Actions {
		if !validActions[a] {
			send400(c, fmt.Sprintf("Invalid action '%s'. Valid: use, trade, gift, equip", a))
			return
		}
	}

	ctx := c.Request.Context()
	db, err := getDBFunc(ctx)
	if err != nil {
		send503(c, "Database unavailable")
		return
	}

	now := time.Now()
	item := ItemDefinition{
		ItemID:      uuid.New().String(),
		Name:        req.Name,
		Description: req.Description,
		ImageURL:    req.ImageURL,
		Category:    req.Category,
		Rarity:      req.Rarity,
		MaxStack:    req.MaxStack,
		Tradeable:   req.Tradeable,
		Actions:     req.Actions,
		Metadata:    req.Metadata,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	_, err = db.Collection("item_definitions").Doc(item.ItemID).Set(ctx, item)
	if err != nil {
		send500(c, fmt.Sprintf("Failed to create item: %v", err))
		return
	}

	log.Printf("[INFO] Item created: %s (%s) by %s", item.Name, item.ItemID, auth.Email)
	c.JSON(http.StatusCreated, item)
}

// handleListItems godoc
// @Summary      List all items
// @Description  List all items in the catalog. Admin and bot only.
// @Tags         items
// @Produce      json
// @Success      200  {array}   ItemDefinition
// @Failure      403  {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /quests/items/ [get]
func handleListItems(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdminOrBot(auth.Role) {
		send403(c, "Only admins and bots can browse the item catalog")
		return
	}

	ctx := c.Request.Context()
	db, err := getDBFunc(ctx)
	if err != nil {
		send503(c, "Database unavailable")
		return
	}

	iter := db.Collection("item_definitions").Documents(ctx)
	docs, err := iter.GetAll()
	if err != nil {
		send500(c, fmt.Sprintf("Failed to list items: %v", err))
		return
	}

	items := make([]ItemDefinition, 0, len(docs))
	for _, doc := range docs {
		data := doc.Data()
		item := mapToItemDefinition(data, doc.ID())
		items = append(items, item)
	}

	c.JSON(http.StatusOK, items)
}

// handleGetItem godoc
// @Summary      Get item definition
// @Description  Get a single item definition by ID. Admin and bot only.
// @Tags         items
// @Produce      json
// @Param        item_id  path      string  true  "Item ID"
// @Success      200      {object}  ItemDefinition
// @Failure      403      {object}  ErrorResponse
// @Failure      404      {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /quests/items/{item_id} [get]
func handleGetItem(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdminOrBot(auth.Role) {
		send403(c, "Only admins and bots can view item definitions")
		return
	}

	itemID := c.Param("item_id")

	ctx := c.Request.Context()
	db, err := getDBFunc(ctx)
	if err != nil {
		send503(c, "Database unavailable")
		return
	}

	snap, err := db.Collection("item_definitions").Doc(itemID).Get(ctx)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			send404(c, fmt.Sprintf("Item '%s' not found", itemID))
			return
		}
		send500(c, fmt.Sprintf("Failed to get item: %v", err))
		return
	}

	item := mapToItemDefinition(snap.Data(), snap.ID())
	c.JSON(http.StatusOK, item)
}

// handleUpdateItem godoc
// @Summary      Update item definition
// @Description  Update an existing item definition. Admin only.
// @Tags         items
// @Accept       json
// @Produce      json
// @Param        item_id  path      string                true  "Item ID"
// @Param        body     body      ItemDefinitionUpdate   true  "Fields to update"
// @Success      200      {object}  ItemDefinition
// @Failure      400      {object}  ErrorResponse
// @Failure      403      {object}  ErrorResponse
// @Failure      404      {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /quests/items/{item_id} [put]
func handleUpdateItem(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdmin(auth.Role) {
		send403(c, "Only admins can update items")
		return
	}

	itemID := c.Param("item_id")

	var req ItemDefinitionUpdate
	if err := c.ShouldBindJSON(&req); err != nil {
		send400(c, fmt.Sprintf("Invalid request body: %v", err))
		return
	}

	if req.Category != nil && !validCategories[*req.Category] {
		send400(c, fmt.Sprintf("Invalid category '%s'", *req.Category))
		return
	}
	if req.Rarity != nil && !validRarities[*req.Rarity] {
		send400(c, fmt.Sprintf("Invalid rarity '%s'", *req.Rarity))
		return
	}
	if req.Actions != nil {
		for _, a := range *req.Actions {
			if !validActions[a] {
				send400(c, fmt.Sprintf("Invalid action '%s'. Valid: use, trade, gift, equip", a))
				return
			}
		}
	}

	ctx := c.Request.Context()
	db, err := getDBFunc(ctx)
	if err != nil {
		send503(c, "Database unavailable")
		return
	}

	// Verify item exists
	docRef := db.Collection("item_definitions").Doc(itemID)
	snap, err := docRef.Get(ctx)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			send404(c, fmt.Sprintf("Item '%s' not found", itemID))
			return
		}
		send500(c, fmt.Sprintf("Failed to get item: %v", err))
		return
	}

	// Build update map
	updates := map[string]interface{}{
		"updated_at": time.Now(),
	}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}
	if req.ImageURL != nil {
		updates["image_url"] = *req.ImageURL
	}
	if req.Category != nil {
		updates["category"] = *req.Category
	}
	if req.Rarity != nil {
		updates["rarity"] = *req.Rarity
	}
	if req.MaxStack != nil {
		updates["max_stack"] = *req.MaxStack
	}
	if req.Tradeable != nil {
		updates["tradeable"] = *req.Tradeable
	}
	if req.Metadata != nil {
		updates["metadata"] = *req.Metadata
	}
	if req.Actions != nil {
		updates["actions"] = *req.Actions
	}

	_, err = docRef.Set(ctx, updates, mergeAllOption())
	if err != nil {
		send500(c, fmt.Sprintf("Failed to update item: %v", err))
		return
	}

	// Fetch updated doc
	snap, err = docRef.Get(ctx)
	if err != nil {
		send500(c, fmt.Sprintf("Failed to read updated item: %v", err))
		return
	}

	item := mapToItemDefinition(snap.Data(), snap.ID())
	log.Printf("[INFO] Item updated: %s (%s) by %s", item.Name, item.ItemID, auth.Email)
	c.JSON(http.StatusOK, item)
}

// handleDeleteItem godoc
// @Summary      Delete item definition
// @Description  Remove an item definition from the catalog. Admin only.
// @Tags         items
// @Produce      json
// @Param        item_id  path      string  true  "Item ID"
// @Success      200      {object}  map[string]string
// @Failure      403      {object}  ErrorResponse
// @Failure      404      {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /quests/items/{item_id} [delete]
func handleDeleteItem(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdmin(auth.Role) {
		send403(c, "Only admins can delete items")
		return
	}

	itemID := c.Param("item_id")

	ctx := c.Request.Context()
	db, err := getDBFunc(ctx)
	if err != nil {
		send503(c, "Database unavailable")
		return
	}

	// Verify item exists
	_, err = db.Collection("item_definitions").Doc(itemID).Get(ctx)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			send404(c, fmt.Sprintf("Item '%s' not found", itemID))
			return
		}
		send500(c, fmt.Sprintf("Failed to get item: %v", err))
		return
	}

	_, err = db.Collection("item_definitions").Doc(itemID).Delete(ctx)
	if err != nil {
		send500(c, fmt.Sprintf("Failed to delete item: %v", err))
		return
	}

	log.Printf("[INFO] Item deleted: %s by %s", itemID, auth.Email)
	c.JSON(http.StatusOK, gin.H{"detail": "Item deleted", "item_id": itemID})
}

// =============================================================================
// Inventory Handlers
// =============================================================================

// handleGetInventory godoc
// @Summary      Get user inventory
// @Description  List all items in a user's inventory. Users can only view their own.
// @Tags         inventory
// @Produce      json
// @Param        user_id  path      string  true  "User ID"
// @Success      200      {array}   InventoryEntryOut
// @Failure      403      {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /quests/inventory/{user_id} [get]
func handleGetInventory(c *gin.Context) {
	auth := GetAuth(c)
	userID := c.Param("user_id")

	// Users can only view their own inventory; admins and bots can view anyone's
	if !IsAdminOrBot(auth.Role) && auth.UID != userID {
		send403(c, "You can only view your own inventory")
		return
	}

	ctx := c.Request.Context()
	db, err := getDBFunc(ctx)
	if err != nil {
		send503(c, "Database unavailable")
		return
	}

	// Get inventory entries
	iter := db.Collection("user_inventory").Where("user_id", "==", userID).Documents(ctx)
	docs, err := iter.GetAll()
	if err != nil {
		send500(c, fmt.Sprintf("Failed to get inventory: %v", err))
		return
	}

	entries := make([]InventoryEntryOut, 0, len(docs))
	for _, doc := range docs {
		data := doc.Data()
		entry := mapToInventoryEntry(data)

		// Look up the item definition to populate name/desc/image
		itemSnap, itemErr := db.Collection("item_definitions").Doc(entry.ItemID).Get(ctx)
		if itemErr == nil {
			itemData := itemSnap.Data()
			entry.Name, _ = itemData["name"].(string)
			entry.Description, _ = itemData["description"].(string)
			entry.ImageURL, _ = itemData["image_url"].(string)
			entry.Category, _ = itemData["category"].(string)
			entry.Rarity, _ = itemData["rarity"].(string)
			entry.Actions = stringsFromMap(itemData, "actions")
		}

		entries = append(entries, entry)
	}

	c.JSON(http.StatusOK, entries)
}

// handleGrantItem godoc
// @Summary      Grant items to a user
// @Description  Add items to a user's inventory. Admin and bot only.
// @Tags         inventory
// @Accept       json
// @Produce      json
// @Param        body  body      InventoryGrantRequest  true  "Grant request"
// @Success      200   {object}  InventoryEntryOut
// @Failure      400   {object}  ErrorResponse
// @Failure      403   {object}  ErrorResponse
// @Failure      404   {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /quests/inventory/grant [post]
func handleGrantItem(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdminOrBot(auth.Role) {
		send403(c, "Only admins and bots can grant items")
		return
	}

	var req InventoryGrantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		send400(c, fmt.Sprintf("Invalid request body: %v", err))
		return
	}

	if req.Quantity <= 0 {
		send400(c, "Quantity must be positive")
		return
	}

	ctx := c.Request.Context()
	db, err := getDBFunc(ctx)
	if err != nil {
		send503(c, "Database unavailable")
		return
	}

	// Verify item exists and check max_stack
	itemSnap, err := db.Collection("item_definitions").Doc(req.ItemID).Get(ctx)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			send404(c, fmt.Sprintf("Item '%s' not found in catalog", req.ItemID))
			return
		}
		send500(c, fmt.Sprintf("Failed to look up item: %v", err))
		return
	}
	itemData := itemSnap.Data()
	maxStack := 0
	if ms, ok := itemData["max_stack"]; ok {
		if msInt, ok := ms.(int64); ok {
			maxStack = int(msInt)
		}
	}

	// Get or create inventory entry
	docID := fmt.Sprintf("inv_%s_%s", req.UserID, req.ItemID)
	invDoc := db.Collection("user_inventory").Doc(docID)
	now := time.Now()

	existingSnap, err := invDoc.Get(ctx)
	currentQty := 0
	isNew := true
	if err == nil && existingSnap.Exists() {
		isNew = false
		data := existingSnap.Data()
		if q, ok := data["quantity"]; ok {
			if qInt, ok := q.(int64); ok {
				currentQty = int(qInt)
			}
		}
	}

	newQty := currentQty + req.Quantity

	// Check max_stack
	if maxStack > 0 && newQty > maxStack {
		send400(c, fmt.Sprintf("Cannot exceed max stack of %d for this item (current: %d, granting: %d)", maxStack, currentQty, req.Quantity))
		return
	}

	entry := UserInventoryEntry{
		UserID:     req.UserID,
		ItemID:     req.ItemID,
		Quantity:   newQty,
		UpdatedAt:  now,
	}
	if isNew {
		entry.AcquiredAt = now
	}

	_, err = invDoc.Set(ctx, entry)
	if err != nil {
		send500(c, fmt.Sprintf("Failed to grant item: %v", err))
		return
	}

	log.Printf("[INFO] Granted %dx %s to user %s (by %s)", req.Quantity, req.ItemID, req.UserID, auth.UID)

	out := InventoryEntryOut{
		ItemID:      req.ItemID,
		Quantity:    newQty,
		AcquiredAt:  entry.AcquiredAt,
		UpdatedAt:   now,
		Name:             stringFromMap(itemData, "name"),
		Description:      stringFromMap(itemData, "description"),
		ImageURL:         stringFromMap(itemData, "image_url"),
		Category:         stringFromMap(itemData, "category"),
		Rarity:           stringFromMap(itemData, "rarity"),
		Actions:          stringsFromMap(itemData, "actions"),
	}
	c.JSON(http.StatusOK, out)
}

// handleDeductItem godoc
// @Summary      Deduct items from a user
// @Description  Remove items from a user's inventory. Admin and bot only.
// @Tags         inventory
// @Accept       json
// @Produce      json
// @Param        body  body      InventoryDeductRequest  true  "Deduct request"
// @Success      200   {object}  InventoryEntryOut
// @Failure      400   {object}  ErrorResponse
// @Failure      403   {object}  ErrorResponse
// @Failure      404   {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /quests/inventory/deduct [post]
func handleDeductItem(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdminOrBot(auth.Role) {
		send403(c, "Only admins and bots can deduct items")
		return
	}

	var req InventoryDeductRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		send400(c, fmt.Sprintf("Invalid request body: %v", err))
		return
	}

	if req.Quantity <= 0 {
		send400(c, "Quantity must be positive")
		return
	}

	ctx := c.Request.Context()
	db, err := getDBFunc(ctx)
	if err != nil {
		send503(c, "Database unavailable")
		return
	}

	docID := fmt.Sprintf("inv_%s_%s", req.UserID, req.ItemID)
	invDoc := db.Collection("user_inventory").Doc(docID)

	existingSnap, err := invDoc.Get(ctx)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			send404(c, fmt.Sprintf("User %s does not have item %s", req.UserID, req.ItemID))
			return
		}
		send500(c, fmt.Sprintf("Failed to get inventory entry: %v", err))
		return
	}

	data := existingSnap.Data()
	currentQty := 0
	if q, ok := data["quantity"]; ok {
		if qInt, ok := q.(int64); ok {
			currentQty = int(qInt)
		}
	}

	newQty := currentQty - req.Quantity
	if newQty < 0 {
		send400(c, fmt.Sprintf("Insufficient quantity (current: %d, deducting: %d)", currentQty, req.Quantity))
		return
	}

	now := time.Now()

	if newQty == 0 {
		// Remove the inventory entry entirely
		_, err = invDoc.Delete(ctx)
		if err != nil {
			send500(c, fmt.Sprintf("Failed to delete inventory entry: %v", err))
			return
		}
		log.Printf("[INFO] Deducted %dx %s from user %s (removed, qty=0)", req.Quantity, req.ItemID, req.UserID)
		c.JSON(http.StatusOK, InventoryEntryOut{
			ItemID:   req.ItemID,
			Quantity: 0,
		})
		return
	}

	// Update quantity
	updates := map[string]interface{}{
		"quantity":   newQty,
		"updated_at": now,
	}
	_, err = invDoc.Set(ctx, updates, mergeAllOption())
	if err != nil {
		send500(c, fmt.Sprintf("Failed to deduct item: %v", err))
		return
	}

	log.Printf("[INFO] Deducted %dx %s from user %s (remaining: %d)", req.Quantity, req.ItemID, req.UserID, newQty)

	// Look up item definition for response
	itemSnap, _ := db.Collection("item_definitions").Doc(req.ItemID).Get(ctx)
	var itemData map[string]interface{}
	if itemSnap != nil {
		itemData = itemSnap.Data()
	}

	out := InventoryEntryOut{
		ItemID:      req.ItemID,
		Quantity:    newQty,
		UpdatedAt:   now,
		Name:             stringFromMap(itemData, "name"),
		Description:      stringFromMap(itemData, "description"),
		ImageURL:         stringFromMap(itemData, "image_url"),
		Category:         stringFromMap(itemData, "category"),
		Rarity:           stringFromMap(itemData, "rarity"),
		Actions:          stringsFromMap(itemData, "actions"),
	}
	c.JSON(http.StatusOK, out)
}

// =============================================================================
// Helpers
// =============================================================================

func mapToItemDefinition(data map[string]interface{}, id string) ItemDefinition {
	item := ItemDefinition{
		ItemID: id,
	}
	if v, ok := data["name"].(string); ok {
		item.Name = v
	}
	if v, ok := data["description"].(string); ok {
		item.Description = v
	}
	if v, ok := data["image_url"].(string); ok {
		item.ImageURL = v
	}
	if v, ok := data["category"].(string); ok {
		item.Category = v
	}
	if v, ok := data["rarity"].(string); ok {
		item.Rarity = v
	}
	if v, ok := data["max_stack"].(int64); ok {
		item.MaxStack = int(v)
	}
	if v, ok := data["tradeable"].(bool); ok {
		item.Tradeable = v
	}
	item.Actions = stringsFromMap(data, "actions")
	if v, ok := data["metadata"].(map[string]interface{}); ok {
		item.Metadata = v
	}
	if v, ok := data["created_at"].(time.Time); ok {
		item.CreatedAt = v
	}
	if v, ok := data["updated_at"].(time.Time); ok {
		item.UpdatedAt = v
	}
	return item
}

func mapToInventoryEntry(data map[string]interface{}) InventoryEntryOut {
	entry := InventoryEntryOut{}
	if v, ok := data["item_id"].(string); ok {
		entry.ItemID = v
	}
	if v, ok := data["quantity"].(int64); ok {
		entry.Quantity = int(v)
	}
	if v, ok := data["acquired_at"].(time.Time); ok {
		entry.AcquiredAt = v
	}
	if v, ok := data["updated_at"].(time.Time); ok {
		entry.UpdatedAt = v
	}
	return entry
}

func stringFromMap(m map[string]interface{}, key string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

// stringsFromMap extracts a []string from a Firestore data map.
func stringsFromMap(m map[string]interface{}, key string) []string {
	if m == nil {
		return nil
	}
	raw, ok := m[key]
	if !ok || raw == nil {
		return nil
	}
	if arr, ok := raw.([]interface{}); ok {
		result := make([]string, 0, len(arr))
		for _, v := range arr {
			if s, ok := v.(string); ok {
				result = append(result, s)
			}
		}
		return result
	}
	return nil
}

// mergeAllOption returns a Firestore MergeAll option for partial updates.
func mergeAllOption() firestore.SetOption {
	return firestore.MergeAll
}

// grantQuestRewards grants all rewards from a quest to a user's inventory.
// This is a best-effort operation — individual grant failures are logged but
// do not block the quest completion response.
func grantQuestRewards(ctx context.Context, db FirestoreClient, rewards []QuestReward, userID string) {
	if len(rewards) == 0 {
		return
	}

	now := time.Now()
	for _, reward := range rewards {
		if reward.ItemID == "" || reward.Quantity <= 0 {
			log.Printf("[WARN] Skipping invalid reward: item_id=%q, quantity=%d", reward.ItemID, reward.Quantity)
			continue
		}

		docID := fmt.Sprintf("inv_%s_%s", userID, reward.ItemID)
		invDoc := db.Collection("user_inventory").Doc(docID)

		// Read current quantity
		currentQty := 0
		isNew := true
		existingSnap, err := invDoc.Get(ctx)
		if err == nil && existingSnap.Exists() {
			isNew = false
			if q, ok := existingSnap.Data()["quantity"].(int64); ok {
				currentQty = int(q)
			}
		}

		entry := UserInventoryEntry{
			UserID:     userID,
			ItemID:     reward.ItemID,
			Quantity:   currentQty + reward.Quantity,
			UpdatedAt:  now,
		}
		if isNew {
			entry.AcquiredAt = now
		}

		_, err = invDoc.Set(ctx, entry)
		if err != nil {
			log.Printf("[ERROR] Failed to grant quest reward %dx %s to user %s: %v", reward.Quantity, reward.ItemID, userID, err)
			continue
		}

		log.Printf("[INFO] Quest reward granted: %dx %s to user %s", reward.Quantity, reward.ItemID, userID)
	}
}

// =============================================================================
// Quest Template Handlers (Admin Only)
// =============================================================================

// handleCreateQuestTemplate godoc
// @Summary      Create quest template
// @Description  Create a new quest template. Admin only. Uses deterministic quest_id for idempotent seeding.
// @Tags         quests
// @Accept       json
// @Produce      json
// @Param        body  body      QuestTemplateCreate  true  "Quest template"
// @Success      201   {object}  QuestTemplate
// @Failure      400   {object}  ErrorResponse
// @Failure      403   {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /quests/templates/ [post]
func handleCreateQuestTemplate(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdmin(auth.Role) {
		send403(c, "Only admins can create quest templates")
		return
	}

	var req QuestTemplateCreate
	if err := c.ShouldBindJSON(&req); err != nil {
		send400(c, fmt.Sprintf("Invalid request body: %v", err))
		return
	}

	if !validQuestTypes[req.QuestType] {
		send400(c, fmt.Sprintf("Invalid quest_type '%s'. Valid: story, daily, weekly, achievement", req.QuestType))
		return
	}

	questStatus := req.Status
	if questStatus == "" {
		questStatus = "active"
	}
	if !validQuestStatuses[questStatus] {
		send400(c, fmt.Sprintf("Invalid status '%s'. Valid: draft, active, retired", questStatus))
		return
	}

	ctx := c.Request.Context()
	db, err := getDBFunc(ctx)
	if err != nil {
		send503(c, "Database unavailable")
		return
	}

	now := time.Now()
	quest := QuestTemplate{
		QuestID:     req.QuestID,
		Title:       req.Title,
		Description: req.Description,
		QuestType:   req.QuestType,
		Status:      questStatus,
		SortOrder:   req.SortOrder,
		Rewards:     req.Rewards,
		Metadata:    req.Metadata,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	_, err = db.Collection("quest_templates").Doc(quest.QuestID).Set(ctx, quest)
	if err != nil {
		send500(c, fmt.Sprintf("Failed to create quest template: %v", err))
		return
	}

	log.Printf("[INFO] Quest template created: %s (%s) by %s", quest.Title, quest.QuestID, auth.Email)
	c.JSON(http.StatusCreated, quest)
}

// handleListQuestTemplates godoc
// @Summary      List quest templates
// @Description  List all quest templates. Any authenticated user can view active quests.
// @Tags         quests
// @Produce      json
// @Success      200  {array}   QuestTemplate
// @Security     BearerAuth
// @Router       /quests/templates/ [get]
func handleListQuestTemplates(c *gin.Context) {
	auth := GetAuth(c)

	ctx := c.Request.Context()
	db, err := getDBFunc(ctx)
	if err != nil {
		send503(c, "Database unavailable")
		return
	}

	iter := db.Collection("quest_templates").Documents(ctx)
	docs, err := iter.GetAll()
	if err != nil {
		send500(c, fmt.Sprintf("Failed to list quest templates: %v", err))
		return
	}

	quests := make([]QuestTemplate, 0, len(docs))
	for _, doc := range docs {
		data := doc.Data()
		quest := mapToQuestTemplate(data, doc.ID())
		// Non-admins only see active quests
		if !IsAdmin(auth.Role) && quest.Status != "active" {
			continue
		}
		quests = append(quests, quest)
	}

	c.JSON(http.StatusOK, quests)
}

// handleGetQuestTemplate godoc
// @Summary      Get quest template
// @Description  Get a single quest template by ID.
// @Tags         quests
// @Produce      json
// @Param        quest_id  path      string  true  "Quest ID"
// @Success      200       {object}  QuestTemplate
// @Failure      404       {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /quests/templates/{quest_id} [get]
func handleGetQuestTemplate(c *gin.Context) {
	questID := c.Param("quest_id")

	ctx := c.Request.Context()
	db, err := getDBFunc(ctx)
	if err != nil {
		send503(c, "Database unavailable")
		return
	}

	snap, err := db.Collection("quest_templates").Doc(questID).Get(ctx)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			send404(c, fmt.Sprintf("Quest '%s' not found", questID))
			return
		}
		send500(c, fmt.Sprintf("Failed to get quest template: %v", err))
		return
	}

	quest := mapToQuestTemplate(snap.Data(), snap.ID())

	// Load checkpoints from subcollection
	checkpoints, cpErr := loadCheckpointTemplates(ctx, db, questID)
	if cpErr != nil {
		log.Printf("[WARN] Failed to load checkpoints for quest %s: %v", questID, cpErr)
		// Non-fatal — return quest without checkpoints
	} else if len(checkpoints) > 0 {
		quest.Checkpoints = checkpoints
	}

	c.JSON(http.StatusOK, quest)
}

// =============================================================================
// Quest Status Handlers
// =============================================================================

// handleUpdateQuestStatus godoc
// @Summary      Update quest status
// @Description  Start, complete, or fail a quest for a user. Admin and bot only.
// @Tags         quest-status
// @Accept       json
// @Produce      json
// @Param        body  body      QuestStatusUpdate  true  "Quest status update"
// @Success      200   {object}  QuestStatus
// @Failure      400   {object}  ErrorResponse
// @Failure      403   {object}  ErrorResponse
// @Failure      404   {object}  ErrorResponse
// @Failure      409   {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /quests/status/ [post]
func handleUpdateQuestStatus(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdminOrBot(auth.Role) {
		send403(c, "Only admins and bots can update quest status")
		return
	}

	var req QuestStatusUpdate
	if err := c.ShouldBindJSON(&req); err != nil {
		send400(c, fmt.Sprintf("Invalid request body: %v", err))
		return
	}

	if !validProgressStatuses[req.Status] {
		send400(c, fmt.Sprintf("Invalid status '%s'. Valid: started, completed, failed", req.Status))
		return
	}

	ctx := c.Request.Context()
	db, err := getDBFunc(ctx)
	if err != nil {
		send503(c, "Database unavailable")
		return
	}

	// Verify quest template exists and load rewards
	questSnap, err := db.Collection("quest_templates").Doc(req.QuestID).Get(ctx)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			send404(c, fmt.Sprintf("Quest '%s' not found", req.QuestID))
			return
		}
		send500(c, fmt.Sprintf("Failed to look up quest: %v", err))
		return
	}
	questTemplate := mapToQuestTemplate(questSnap.Data(), questSnap.ID())

	// Doc ID keyed by user_id to prevent duplicate completions across profiles
	docID := fmt.Sprintf("quest_%s_%s", req.QuestID, req.UserID)
	docRef := db.Collection("quest_status").Doc(docID)
	now := time.Now()

	// Check if status already exists
	existingSnap, err := docRef.Get(ctx)
	if err == nil && existingSnap.Exists() {
		existingData := existingSnap.Data()
		existingStatus, _ := existingData["status"].(string)

		// Once completed, the quest is locked — the first profile keeps the credit.
		// Record a "blocked" entry for this profile so quest status is searchable by profile_id.
		if existingStatus == "completed" {
			existingProfileID, _ := existingData["profile_id"].(string)

			// If the SAME profile is re-submitting, just return 409
			if existingProfileID == req.ProfileID {
				send409(c, fmt.Sprintf("Quest '%s' is already completed by this profile", req.QuestID))
				return
			}

			// Different profile — create a separate "blocked" record keyed by profile
			blockedDocID := fmt.Sprintf("quest_%s_%s_%s", req.QuestID, req.UserID, req.ProfileID)
			blockedRef := db.Collection("quest_status").Doc(blockedDocID)

			// Idempotent: don't create duplicate blocked records
			blockedSnap, _ := blockedRef.Get(ctx)
			if blockedSnap != nil && blockedSnap.Exists() {
				send409(c, fmt.Sprintf("Quest '%s' is already completed by user %s (profile %s blocked)", req.QuestID, req.UserID, req.ProfileID))
				return
			}

			blockedStatus := QuestStatus{
				QuestID:   req.QuestID,
				UserID:    req.UserID,
				ProfileID: req.ProfileID,
				Status:    "blocked",
				CreatedAt: now,
				UpdatedAt: now,
			}
			_, err = blockedRef.Set(ctx, blockedStatus)
			if err != nil {
				send500(c, fmt.Sprintf("Failed to record blocked quest status: %v", err))
				return
			}

			log.Printf("[INFO] Quest '%s' blocked for profile %s — already completed by profile %s", req.QuestID, req.ProfileID, existingProfileID)
			c.JSON(http.StatusConflict, blockedStatus)
			return
		}

		// Checkpoint-aware: resolve effective status before updating
		effectiveStatus := req.Status
		if req.Status == "completed" {
			es, cpErr := resolveEffectiveStatus(ctx, db, req.QuestID, req.UserID, req.ProfileID)
			if cpErr != nil {
				send500(c, fmt.Sprintf("Checkpoint processing failed: %v", cpErr))
				return
			}
			effectiveStatus = es
		}

		// Update existing status
		updates := map[string]interface{}{
			"status":     effectiveStatus,
			"profile_id": req.ProfileID,
			"updated_at": now,
		}
		_, err = docRef.Set(ctx, updates, mergeAllOption())
		if err != nil {
			send500(c, fmt.Sprintf("Failed to update quest status: %v", err))
			return
		}

		log.Printf("[INFO] Quest status updated: %s for user %s → %s (by %s)", req.QuestID, req.UserID, effectiveStatus, auth.UID)

		// Grant rewards on completion
		if effectiveStatus == "completed" {
			grantQuestRewards(ctx, db, questTemplate.Rewards, req.UserID)
		}

		c.JSON(http.StatusOK, QuestStatus{
			QuestID:   req.QuestID,
			UserID:    req.UserID,
			ProfileID: req.ProfileID,
			Status:    effectiveStatus,
			CreatedAt: timeFromMap(existingData, "created_at"),
			UpdatedAt: now,
		})
		return
	}

	// Checkpoint-aware: resolve effective status before creating
	effectiveStatus := req.Status
	if req.Status == "completed" {
		es, cpErr := resolveEffectiveStatus(ctx, db, req.QuestID, req.UserID, req.ProfileID)
		if cpErr != nil {
			send500(c, fmt.Sprintf("Checkpoint processing failed: %v", cpErr))
			return
		}
		effectiveStatus = es
	}

	// Create new quest status
	qs := QuestStatus{
		QuestID:   req.QuestID,
		UserID:    req.UserID,
		ProfileID: req.ProfileID,
		Status:    effectiveStatus,
		CreatedAt: now,
		UpdatedAt: now,
	}

	_, err = docRef.Set(ctx, qs)
	if err != nil {
		send500(c, fmt.Sprintf("Failed to create quest status: %v", err))
		return
	}

	log.Printf("[INFO] Quest status created: %s for user %s → %s (profile: %s, by %s)", req.QuestID, req.UserID, effectiveStatus, req.ProfileID, auth.UID)

	// Grant rewards on completion
	if effectiveStatus == "completed" {
		grantQuestRewards(ctx, db, questTemplate.Rewards, req.UserID)
	}

	c.JSON(http.StatusOK, qs)
}

// handleGetUserQuestStatuses godoc
// @Summary      Get quest statuses for a user
// @Description  List all quest statuses for a user. Users can only view their own.
// @Tags         quest-status
// @Produce      json
// @Param        user_id  path      string  true  "User ID"
// @Success      200      {array}   QuestStatus
// @Failure      403      {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /quests/status/{user_id} [get]
func handleGetUserQuestStatuses(c *gin.Context) {
	auth := GetAuth(c)
	userID := c.Param("user_id")

	// Users can only view their own quest statuses; admins and bots can view anyone's
	if !IsAdminOrBot(auth.Role) && auth.UID != userID {
		send403(c, "You can only view your own quest status")
		return
	}

	ctx := c.Request.Context()
	db, err := getDBFunc(ctx)
	if err != nil {
		send503(c, "Database unavailable")
		return
	}

	iter := db.Collection("quest_status").Where("user_id", "==", userID).Documents(ctx)
	docs, err := iter.GetAll()
	if err != nil {
		send500(c, fmt.Sprintf("Failed to get quest statuses: %v", err))
		return
	}

	statuses := make([]QuestStatus, 0, len(docs))
	for _, doc := range docs {
		data := doc.Data()
		qs := mapToQuestStatus(data)
		statuses = append(statuses, qs)
	}

	c.JSON(http.StatusOK, statuses)
}

// =============================================================================
// Quest Template + Status Helpers
// =============================================================================

func mapToQuestTemplate(data map[string]interface{}, id string) QuestTemplate {
	q := QuestTemplate{QuestID: id}
	if v, ok := data["title"].(string); ok {
		q.Title = v
	}
	if v, ok := data["description"].(string); ok {
		q.Description = v
	}
	if v, ok := data["quest_type"].(string); ok {
		q.QuestType = v
	}
	if v, ok := data["status"].(string); ok {
		q.Status = v
	}
	if v, ok := data["sort_order"].(int64); ok {
		q.SortOrder = int(v)
	}
	if v, ok := data["metadata"].(map[string]interface{}); ok {
		q.Metadata = v
	}
	// Parse rewards array
	if rawRewards, ok := data["rewards"].([]interface{}); ok {
		for _, r := range rawRewards {
			if rm, ok := r.(map[string]interface{}); ok {
				reward := QuestReward{}
				if id, ok := rm["item_id"].(string); ok {
					reward.ItemID = id
				}
				if qty, ok := rm["quantity"].(int64); ok {
					reward.Quantity = int(qty)
				}
				q.Rewards = append(q.Rewards, reward)
			}
		}
	}
	if v, ok := data["created_at"].(time.Time); ok {
		q.CreatedAt = v
	}
	if v, ok := data["updated_at"].(time.Time); ok {
		q.UpdatedAt = v
	}
	return q
}

func mapToQuestStatus(data map[string]interface{}) QuestStatus {
	qs := QuestStatus{}
	if v, ok := data["quest_id"].(string); ok {
		qs.QuestID = v
	}
	if v, ok := data["user_id"].(string); ok {
		qs.UserID = v
	}
	if v, ok := data["profile_id"].(string); ok {
		qs.ProfileID = v
	}
	if v, ok := data["status"].(string); ok {
		qs.Status = v
	}
	if v, ok := data["created_at"].(time.Time); ok {
		qs.CreatedAt = v
	}
	if v, ok := data["updated_at"].(time.Time); ok {
		qs.UpdatedAt = v
	}
	return qs
}

func timeFromMap(m map[string]interface{}, key string) time.Time {
	if v, ok := m[key].(time.Time); ok {
		return v
	}
	return time.Time{}
}

// =============================================================================
// Quest Status By-Profile Handlers
// =============================================================================

// handleUpdateQuestStatusByProfile godoc
// @Summary      Update quest status by profile ID
// @Description  Start, complete, or fail a quest using only a profile_id. The service resolves
//
//	the profile_id to a user_id internally by calling the profiles service.
//	Admin and bot only.
//
// @Tags         quest-status
// @Accept       json
// @Produce      json
// @Param        body  body      QuestStatusUpdateByProfile  true  "Quest status update (by profile)"
// @Success      200   {object}  QuestStatus
// @Failure      400   {object}  ErrorResponse
// @Failure      403   {object}  ErrorResponse
// @Failure      404   {object}  ErrorResponse
// @Failure      409   {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /quests/status/by-profile/ [post]
func handleUpdateQuestStatusByProfile(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdminOrBot(auth.Role) {
		send403(c, "Only admins and bots can update quest status")
		return
	}

	var req QuestStatusUpdateByProfile
	if err := c.ShouldBindJSON(&req); err != nil {
		send400(c, fmt.Sprintf("Invalid request body: %v", err))
		return
	}

	if !validProgressStatuses[req.Status] {
		send400(c, fmt.Sprintf("Invalid status '%s'. Valid: started, completed, failed", req.Status))
		return
	}

	// Resolve profile_id → user_id via the profiles service
	userID, err := resolveProfileFunc(auth.Token, req.ProfileID)
	if err != nil {
		log.Printf("[WARN] Failed to resolve user_id for profile %s: %v", req.ProfileID, err)
		send400(c, fmt.Sprintf("Could not resolve profile_id '%s' to a user: %v", req.ProfileID, err))
		return
	}

	// Delegate to the existing quest completion logic by constructing the
	// full QuestStatusUpdate and reusing the internal handler path.
	ctx := c.Request.Context()
	db, err := getDBFunc(ctx)
	if err != nil {
		send503(c, "Database unavailable")
		return
	}

	// Verify quest template exists and load rewards
	questSnap, err := db.Collection("quest_templates").Doc(req.QuestID).Get(ctx)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			send404(c, fmt.Sprintf("Quest '%s' not found", req.QuestID))
			return
		}
		send500(c, fmt.Sprintf("Failed to look up quest: %v", err))
		return
	}
	questTemplate := mapToQuestTemplate(questSnap.Data(), questSnap.ID())

	// Doc ID keyed by user_id to prevent duplicate completions across profiles
	docID := fmt.Sprintf("quest_%s_%s", req.QuestID, userID)
	docRef := db.Collection("quest_status").Doc(docID)
	now := time.Now()

	// Check if status already exists
	existingSnap, err := docRef.Get(ctx)
	if err == nil && existingSnap.Exists() {
		existingData := existingSnap.Data()
		existingStatus, _ := existingData["status"].(string)

		if existingStatus == "completed" {
			existingProfileID, _ := existingData["profile_id"].(string)

			if existingProfileID == req.ProfileID {
				send409(c, fmt.Sprintf("Quest '%s' is already completed by this profile", req.QuestID))
				return
			}

			// Different profile — create blocked record
			blockedDocID := fmt.Sprintf("quest_%s_%s_%s", req.QuestID, userID, req.ProfileID)
			blockedRef := db.Collection("quest_status").Doc(blockedDocID)

			blockedSnap, _ := blockedRef.Get(ctx)
			if blockedSnap != nil && blockedSnap.Exists() {
				send409(c, fmt.Sprintf("Quest '%s' is already completed by user %s (profile %s blocked)", req.QuestID, userID, req.ProfileID))
				return
			}

			blockedStatus := QuestStatus{
				QuestID:   req.QuestID,
				UserID:    userID,
				ProfileID: req.ProfileID,
				Status:    "blocked",
				CreatedAt: now,
				UpdatedAt: now,
			}
			_, err = blockedRef.Set(ctx, blockedStatus)
			if err != nil {
				send500(c, fmt.Sprintf("Failed to record blocked quest status: %v", err))
				return
			}

			log.Printf("[INFO] Quest '%s' blocked for profile %s — already completed by profile %s", req.QuestID, req.ProfileID, existingProfileID)
			c.JSON(http.StatusConflict, blockedStatus)
			return
		}

		// Checkpoint-aware: resolve effective status before updating
		effectiveStatus := req.Status
		if req.Status == "completed" {
			es, cpErr := resolveEffectiveStatus(ctx, db, req.QuestID, userID, req.ProfileID)
			if cpErr != nil {
				send500(c, fmt.Sprintf("Checkpoint processing failed: %v", cpErr))
				return
			}
			effectiveStatus = es
		}

		// Update existing status
		updates := map[string]interface{}{
			"status":     effectiveStatus,
			"profile_id": req.ProfileID,
			"updated_at": now,
		}
		_, err = docRef.Set(ctx, updates, mergeAllOption())
		if err != nil {
			send500(c, fmt.Sprintf("Failed to update quest status: %v", err))
			return
		}

		log.Printf("[INFO] Quest status updated (by-profile): %s for user %s → %s (by %s)", req.QuestID, userID, effectiveStatus, auth.UID)

		if effectiveStatus == "completed" {
			grantQuestRewards(ctx, db, questTemplate.Rewards, userID)
		}

		c.JSON(http.StatusOK, QuestStatus{
			QuestID:   req.QuestID,
			UserID:    userID,
			ProfileID: req.ProfileID,
			Status:    effectiveStatus,
			CreatedAt: timeFromMap(existingData, "created_at"),
			UpdatedAt: now,
		})
		return
	}

	// Checkpoint-aware: resolve effective status before creating
	effectiveStatus := req.Status
	if req.Status == "completed" {
		es, cpErr := resolveEffectiveStatus(ctx, db, req.QuestID, userID, req.ProfileID)
		if cpErr != nil {
			send500(c, fmt.Sprintf("Checkpoint processing failed: %v", cpErr))
			return
		}
		effectiveStatus = es
	}

	// Create new quest status
	qs := QuestStatus{
		QuestID:   req.QuestID,
		UserID:    userID,
		ProfileID: req.ProfileID,
		Status:    effectiveStatus,
		CreatedAt: now,
		UpdatedAt: now,
	}

	_, err = docRef.Set(ctx, qs)
	if err != nil {
		send500(c, fmt.Sprintf("Failed to create quest status: %v", err))
		return
	}

	log.Printf("[INFO] Quest status created (by-profile): %s for user %s → %s (profile: %s, by %s)", req.QuestID, userID, effectiveStatus, req.ProfileID, auth.UID)

	if effectiveStatus == "completed" {
		grantQuestRewards(ctx, db, questTemplate.Rewards, userID)
	}

	c.JSON(http.StatusOK, qs)
}

// handleGetUserQuestStatusesByProfile godoc
// @Summary      Get quest statuses by profile ID
// @Description  List all quest statuses for the user who owns the given profile.
//
//	Resolves profile_id → user_id internally via the profiles service.
//	Admin, bot, or the profile's own user can view.
//
// @Tags         quest-status
// @Produce      json
// @Param        profile_id  path      string  true  "Profile ID"
// @Success      200         {array}   QuestStatus
// @Failure      400         {object}  ErrorResponse
// @Failure      403         {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /quests/status/by-profile/{profile_id} [get]
func handleGetUserQuestStatusesByProfile(c *gin.Context) {
	auth := GetAuth(c)
	profileID := c.Param("profile_id")

	// Resolve profile_id → user_id
	userID, err := resolveProfileFunc(auth.Token, profileID)
	if err != nil {
		log.Printf("[WARN] Failed to resolve user_id for profile %s: %v", profileID, err)
		send400(c, fmt.Sprintf("Could not resolve profile_id '%s' to a user: %v", profileID, err))
		return
	}

	// Users can only view their own quest statuses; admins and bots can view anyone's
	if !IsAdminOrBot(auth.Role) && auth.UID != userID {
		send403(c, "You can only view your own quest status")
		return
	}

	ctx := c.Request.Context()
	db, err := getDBFunc(ctx)
	if err != nil {
		send503(c, "Database unavailable")
		return
	}

	iter := db.Collection("quest_status").Where("user_id", "==", userID).Documents(ctx)
	docs, err := iter.GetAll()
	if err != nil {
		send500(c, fmt.Sprintf("Failed to get quest statuses: %v", err))
		return
	}

	statuses := make([]QuestStatus, 0, len(docs))
	for _, doc := range docs {
		data := doc.Data()
		qs := mapToQuestStatus(data)
		statuses = append(statuses, qs)
	}

	c.JSON(http.StatusOK, statuses)
}

// =============================================================================
// Checkpoint Helpers (used by quest status handlers)
// =============================================================================

// resolveEffectiveStatus processes checkpoint logic when a quest completion is
// attempted. If the quest has checkpoints, it advances to the next uncompleted
// one and returns "completed" only when ALL checkpoints are done.
// If the quest has no checkpoints, returns the original status unchanged.
func resolveEffectiveStatus(ctx context.Context, db FirestoreClient, questID, userID, profileID string) (string, error) {
	checkpoints, err := loadCheckpointTemplates(ctx, db, questID)
	if err != nil {
		return "", fmt.Errorf("failed to load checkpoints: %w", err)
	}

	// No checkpoints → old behavior, quest is directly completable
	if len(checkpoints) == 0 {
		return "completed", nil
	}

	allDone, err := processQuestCompletion(ctx, db, questID, userID, profileID, checkpoints)
	if err != nil {
		return "", err
	}

	if allDone {
		return "completed", nil
	}
	return "started", nil
}

// loadCheckpointTemplates reads all checkpoint_templates for a quest from the
// top-level checkpoint_templates collection, sorted by sort_order ascending.
func loadCheckpointTemplates(ctx context.Context, db FirestoreClient, questID string) ([]CheckpointTemplate, error) {
	iter := db.Collection("checkpoint_templates").
		Where("quest_id", "==", questID).
		Documents(ctx)
	docs, err := iter.GetAll()
	if err != nil {
		return nil, fmt.Errorf("failed to read checkpoint templates: %w", err)
	}

	checkpoints := make([]CheckpointTemplate, 0, len(docs))
	for _, doc := range docs {
		cp := mapToCheckpointTemplate(doc.Data(), doc.ID(), questID)
		checkpoints = append(checkpoints, cp)
	}

	// Sort by sort_order
	sort.Slice(checkpoints, func(i, j int) bool {
		return checkpoints[i].SortOrder < checkpoints[j].SortOrder
	})

	return checkpoints, nil
}

// processQuestCompletion advances the next uncompleted checkpoint and returns
// whether all checkpoints are now done.
func processQuestCompletion(ctx context.Context, db FirestoreClient, questID, userID, profileID string, checkpoints []CheckpointTemplate) (bool, error) {
	// Get set of already-completed checkpoint IDs for this user
	completedSet, err := getCompletedCheckpointIDs(ctx, db, questID, userID)
	if err != nil {
		return false, err
	}

	// Find next uncompleted checkpoint
	var nextCheckpoint *CheckpointTemplate
	for i := range checkpoints {
		if !completedSet[checkpoints[i].CheckpointID] {
			nextCheckpoint = &checkpoints[i]
			break
		}
	}

	if nextCheckpoint == nil {
		// All checkpoints already completed — quest should already be done
		return true, nil
	}

	// Complete this checkpoint
	now := time.Now()
	cpDocID := fmt.Sprintf("cp_%s_%s_%s", questID, nextCheckpoint.CheckpointID, profileID)
	cpStatus := CheckpointStatus{
		QuestID:      questID,
		CheckpointID: nextCheckpoint.CheckpointID,
		ProfileID:    profileID,
		UserID:       userID,
		Status:       "completed",
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	_, err = db.Collection("checkpoint_status").Doc(cpDocID).Set(ctx, cpStatus)
	if err != nil {
		return false, fmt.Errorf("failed to save checkpoint status: %w", err)
	}

	log.Printf("[INFO] ✅ Checkpoint '%s' completed for quest '%s' (user: %s, profile: %s)",
		nextCheckpoint.CheckpointID, questID, userID, profileID)

	// Check if ALL checkpoints are now done
	completedSet[nextCheckpoint.CheckpointID] = true
	for _, cp := range checkpoints {
		if !completedSet[cp.CheckpointID] {
			log.Printf("[INFO] Quest '%s' has remaining checkpoints — not yet complete (next: '%s')", questID, cp.CheckpointID)
			return false, nil
		}
	}

	log.Printf("[INFO] 🏆 All checkpoints completed for quest '%s' (user: %s) — quest completing", questID, userID)
	return true, nil
}

// getCompletedCheckpointIDs returns a set of checkpoint IDs that the user has
// completed for a given quest (across all profiles).
func getCompletedCheckpointIDs(ctx context.Context, db FirestoreClient, questID, userID string) (map[string]bool, error) {
	iter := db.Collection("checkpoint_status").
		Where("quest_id", "==", questID).
		Where("user_id", "==", userID).
		Documents(ctx)
	docs, err := iter.GetAll()
	if err != nil {
		return nil, fmt.Errorf("failed to query checkpoint statuses: %w", err)
	}

	result := make(map[string]bool, len(docs))
	for _, doc := range docs {
		data := doc.Data()
		if cpID, ok := data["checkpoint_id"].(string); ok {
			if st, ok := data["status"].(string); ok && st == "completed" {
				result[cpID] = true
			}
		}
	}
	return result, nil
}

// mapToCheckpointTemplate maps Firestore data to a CheckpointTemplate struct.
func mapToCheckpointTemplate(data map[string]interface{}, id, questID string) CheckpointTemplate {
	cp := CheckpointTemplate{
		CheckpointID: id,
		QuestID:      questID,
	}
	if v, ok := data["bot_id"].(string); ok {
		cp.BotID = v
	}
	if v, ok := data["description"].(string); ok {
		cp.Description = v
	}
	if v, ok := data["detailed_description"].(string); ok {
		cp.DetailedDescription = v
	}
	if v, ok := data["success_criteria"].(string); ok {
		cp.SuccessCriteria = v
	}
	if v, ok := data["sort_order"].(int64); ok {
		cp.SortOrder = int(v)
	}
	if v, ok := data["metadata"].(map[string]interface{}); ok {
		cp.Metadata = v
	}
	if v, ok := data["created_at"].(time.Time); ok {
		cp.CreatedAt = v
	}
	if v, ok := data["updated_at"].(time.Time); ok {
		cp.UpdatedAt = v
	}
	return cp
}

// mapToCheckpointStatus maps Firestore data to a CheckpointStatus struct.
func mapToCheckpointStatus(data map[string]interface{}) CheckpointStatus {
	cs := CheckpointStatus{}
	if v, ok := data["quest_id"].(string); ok {
		cs.QuestID = v
	}
	if v, ok := data["checkpoint_id"].(string); ok {
		cs.CheckpointID = v
	}
	if v, ok := data["profile_id"].(string); ok {
		cs.ProfileID = v
	}
	if v, ok := data["user_id"].(string); ok {
		cs.UserID = v
	}
	if v, ok := data["status"].(string); ok {
		cs.Status = v
	}
	if v, ok := data["created_at"].(time.Time); ok {
		cs.CreatedAt = v
	}
	if v, ok := data["updated_at"].(time.Time); ok {
		cs.UpdatedAt = v
	}
	return cs
}

// =============================================================================
// Checkpoint Template CRUD (Admin Only)
// =============================================================================

// handleCreateCheckpointTemplate godoc
// @Summary      Create checkpoint template
// @Description  Create a new checkpoint within a quest. Admin only.
// @Tags         checkpoints
// @Accept       json
// @Produce      json
// @Param        body  body      CheckpointTemplateCreate  true  "Checkpoint template"
// @Success      201   {object}  CheckpointTemplate
// @Failure      400   {object}  ErrorResponse
// @Failure      403   {object}  ErrorResponse
// @Failure      404   {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /quests/checkpoints/ [post]
func handleCreateCheckpointTemplate(c *gin.Context) {
	auth := GetAuth(c)
	if !IsAdmin(auth.Role) {
		send403(c, "Only admins can create checkpoint templates")
		return
	}

	var req CheckpointTemplateCreate
	if err := c.ShouldBindJSON(&req); err != nil {
		send400(c, fmt.Sprintf("Invalid request body: %v", err))
		return
	}

	ctx := c.Request.Context()
	db, err := getDBFunc(ctx)
	if err != nil {
		send503(c, "Database unavailable")
		return
	}

	// Verify quest template exists
	_, err = db.Collection("quest_templates").Doc(req.QuestID).Get(ctx)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			send404(c, fmt.Sprintf("Quest '%s' not found", req.QuestID))
			return
		}
		send500(c, fmt.Sprintf("Failed to look up quest: %v", err))
		return
	}

	now := time.Now()
	cp := CheckpointTemplate{
		CheckpointID:        req.CheckpointID,
		QuestID:             req.QuestID,
		BotID:               req.BotID,
		Description:         req.Description,
		DetailedDescription: req.DetailedDescription,
		SuccessCriteria:     req.SuccessCriteria,
		SortOrder:           req.SortOrder,
		Metadata:            req.Metadata,
		CreatedAt:           now,
		UpdatedAt:           now,
	}

	// Store in top-level checkpoint_templates collection
	_, err = db.Collection("checkpoint_templates").Doc(req.CheckpointID).Set(ctx, cp)
	if err != nil {
		send500(c, fmt.Sprintf("Failed to create checkpoint template: %v", err))
		return
	}

	log.Printf("[INFO] Checkpoint template created: %s/%s by %s", req.QuestID, req.CheckpointID, auth.Email)
	c.JSON(http.StatusCreated, cp)
}

// handleListCheckpointTemplates godoc
// @Summary      List checkpoint templates for a quest
// @Description  List all checkpoints defined for a quest, ordered by sort_order.
// @Tags         checkpoints
// @Produce      json
// @Param        quest_id  path      string  true  "Quest ID"
// @Success      200       {array}   CheckpointTemplate
// @Failure      404       {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /quests/templates/{quest_id}/checkpoints [get]
func handleListCheckpointTemplates(c *gin.Context) {
	questID := c.Param("quest_id")

	ctx := c.Request.Context()
	db, err := getDBFunc(ctx)
	if err != nil {
		send503(c, "Database unavailable")
		return
	}

	// Verify quest exists
	_, err = db.Collection("quest_templates").Doc(questID).Get(ctx)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			send404(c, fmt.Sprintf("Quest '%s' not found", questID))
			return
		}
		send500(c, fmt.Sprintf("Failed to look up quest: %v", err))
		return
	}

	checkpoints, err := loadCheckpointTemplates(ctx, db, questID)
	if err != nil {
		send500(c, fmt.Sprintf("Failed to list checkpoints: %v", err))
		return
	}

	c.JSON(http.StatusOK, checkpoints)
}

// =============================================================================
// Checkpoint Status Endpoints
// =============================================================================

// handleGetCheckpointStatuses godoc
// @Summary      Get checkpoint progress for a quest
// @Description  List all checkpoint statuses for a user on a specific quest.
// @Tags         checkpoints
// @Produce      json
// @Param        user_id   path      string  true  "User ID"
// @Param        quest_id  path      string  true  "Quest ID"
// @Success      200       {array}   CheckpointStatus
// @Failure      403       {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /quests/checkpoints/status/{user_id}/{quest_id} [get]
func handleGetCheckpointStatuses(c *gin.Context) {
	auth := GetAuth(c)
	userID := c.Param("user_id")
	questID := c.Param("quest_id")

	if !IsAdminOrBot(auth.Role) && auth.UID != userID {
		send403(c, "You can only view your own checkpoint status")
		return
	}

	ctx := c.Request.Context()
	db, err := getDBFunc(ctx)
	if err != nil {
		send503(c, "Database unavailable")
		return
	}

	iter := db.Collection("checkpoint_status").
		Where("quest_id", "==", questID).
		Where("user_id", "==", userID).
		Documents(ctx)
	docs, err := iter.GetAll()
	if err != nil {
		send500(c, fmt.Sprintf("Failed to get checkpoint statuses: %v", err))
		return
	}

	statuses := make([]CheckpointStatus, 0, len(docs))
	for _, doc := range docs {
		cs := mapToCheckpointStatus(doc.Data())
		statuses = append(statuses, cs)
	}

	c.JSON(http.StatusOK, statuses)
}

// handleGetCheckpointStatusesByProfile godoc
// @Summary      Get checkpoint progress by profile ID
// @Description  List all checkpoint statuses for a quest, resolved by profile_id.
// @Tags         checkpoints
// @Produce      json
// @Param        profile_id  path      string  true  "Profile ID"
// @Param        quest_id    path      string  true  "Quest ID"
// @Success      200         {array}   CheckpointStatus
// @Failure      400         {object}  ErrorResponse
// @Failure      403         {object}  ErrorResponse
// @Security     BearerAuth
// @Router       /quests/checkpoints/status/by-profile/{profile_id}/{quest_id} [get]
func handleGetCheckpointStatusesByProfile(c *gin.Context) {
	auth := GetAuth(c)
	profileID := c.Param("profile_id")
	questID := c.Param("quest_id")

	userID, err := resolveProfileFunc(auth.Token, profileID)
	if err != nil {
		log.Printf("[WARN] Failed to resolve user_id for profile %s: %v", profileID, err)
		send400(c, fmt.Sprintf("Could not resolve profile_id '%s' to a user: %v", profileID, err))
		return
	}

	if !IsAdminOrBot(auth.Role) && auth.UID != userID {
		send403(c, "You can only view your own checkpoint status")
		return
	}

	ctx := c.Request.Context()
	db, err := getDBFunc(ctx)
	if err != nil {
		send503(c, "Database unavailable")
		return
	}

	iter := db.Collection("checkpoint_status").
		Where("quest_id", "==", questID).
		Where("user_id", "==", userID).
		Documents(ctx)
	docs, err := iter.GetAll()
	if err != nil {
		send500(c, fmt.Sprintf("Failed to get checkpoint statuses: %v", err))
		return
	}

	statuses := make([]CheckpointStatus, 0, len(docs))
	for _, doc := range docs {
		cs := mapToCheckpointStatus(doc.Data())
		statuses = append(statuses, cs)
	}

	c.JSON(http.StatusOK, statuses)
}
