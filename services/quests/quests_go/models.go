package main

import "time"

// -----------------------------------------------------------------------------
// Item Definitions (the catalog)
// -----------------------------------------------------------------------------

// ItemDefinition represents an item in the game catalog.
type ItemDefinition struct {
	ItemID      string         `json:"item_id"      firestore:"item_id"`
	Name        string         `json:"name"         firestore:"name"`
	Description string         `json:"description"  firestore:"description"`
	ImageURL    string         `json:"image_url"    firestore:"image_url"`
	Category    string         `json:"category"     firestore:"category"`    // currency, weapon, armor, consumable, cosmetic, key_item, badge
	Rarity      string         `json:"rarity"       firestore:"rarity"`      // common, uncommon, rare, epic, legendary
	MaxStack    int            `json:"max_stack"    firestore:"max_stack"`   // 0 = unlimited, 1 = unique
	Tradeable   bool           `json:"tradeable"    firestore:"tradeable"`
	Actions     []string       `json:"actions"      firestore:"actions"`     // use, trade, gift, equip
	Metadata    map[string]any `json:"metadata"     firestore:"metadata"`
	CreatedAt   time.Time      `json:"created_at"   firestore:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"   firestore:"updated_at"`
}

// ItemDefinitionCreate is the request body for creating an item.
type ItemDefinitionCreate struct {
	Name        string         `json:"name"        binding:"required"`
	Description string         `json:"description"`
	ImageURL    string         `json:"image_url"`
	Category    string         `json:"category"    binding:"required"`
	Rarity      string         `json:"rarity"`
	MaxStack    int            `json:"max_stack"`
	Tradeable   bool           `json:"tradeable"`
	Actions     []string       `json:"actions"`
	Metadata    map[string]any `json:"metadata"`
}

// ItemDefinitionUpdate is the request body for updating an item.
type ItemDefinitionUpdate struct {
	Name        *string         `json:"name"`
	Description *string         `json:"description"`
	ImageURL    *string         `json:"image_url"`
	Category    *string         `json:"category"`
	Rarity      *string         `json:"rarity"`
	MaxStack    *int            `json:"max_stack"`
	Tradeable   *bool           `json:"tradeable"`
	Actions     *[]string       `json:"actions"`
	Metadata    *map[string]any `json:"metadata"`
}

// Valid categories for items
var validCategories = map[string]bool{
	"currency":  true,
	"weapon":    true,
	"armor":     true,
	"consumable": true,
	"cosmetic":  true,
	"key_item":  true,
	"badge":     true,
}

// Valid rarities for items
var validRarities = map[string]bool{
	"common":    true,
	"uncommon":  true,
	"rare":      true,
	"epic":      true,
	"legendary": true,
}

// Valid actions for items
var validActions = map[string]bool{
	"use":   true,
	"trade": true,
	"gift":  true,
	"equip": true,
}

// -----------------------------------------------------------------------------
// User Inventory
// -----------------------------------------------------------------------------

// UserInventoryEntry represents a single item stack in a user's inventory.
type UserInventoryEntry struct {
	UserID     string    `json:"user_id"      firestore:"user_id"`
	ItemID     string    `json:"item_id"      firestore:"item_id"`
	Quantity   int       `json:"quantity"     firestore:"quantity"`
	AcquiredAt time.Time `json:"acquired_at"  firestore:"acquired_at"`
	UpdatedAt  time.Time `json:"updated_at"   firestore:"updated_at"`
}

// InventoryGrantRequest is the request body for granting items to a user.
type InventoryGrantRequest struct {
	UserID   string `json:"user_id"   binding:"required"`
	ItemID   string `json:"item_id"   binding:"required"`
	Quantity int    `json:"quantity"  binding:"required"`
}

// InventoryDeductRequest is the request body for deducting items from a user.
type InventoryDeductRequest struct {
	UserID   string `json:"user_id"   binding:"required"`
	ItemID   string `json:"item_id"   binding:"required"`
	Quantity int    `json:"quantity"  binding:"required"`
}

// InventoryEntryOut is the response format for an inventory entry.
type InventoryEntryOut struct {
	ItemID     string    `json:"item_id"`
	Quantity   int       `json:"quantity"`
	AcquiredAt time.Time `json:"acquired_at"`
	UpdatedAt  time.Time `json:"updated_at"`
	// Joined item definition fields
	Name        string   `json:"name"`
	Description string   `json:"description"`
	ImageURL    string   `json:"image_url"`
	Category    string   `json:"category"`
	Rarity      string   `json:"rarity"`
	Actions     []string `json:"actions"`
}

// ErrorResponse matches the generic error response format.
type ErrorResponse struct {
	Detail string `json:"detail"`
}

// -----------------------------------------------------------------------------
// Quest Templates
// -----------------------------------------------------------------------------

// QuestReward represents a single reward granted upon quest completion.
type QuestReward struct {
	ItemID   string `json:"item_id"   firestore:"item_id"`
	Quantity int    `json:"quantity"  firestore:"quantity"`
}

// QuestTemplate defines a quest in the game.
type QuestTemplate struct {
	QuestID     string               `json:"quest_id"     firestore:"quest_id"`
	Title       string               `json:"title"        firestore:"title"`
	Description string               `json:"description"  firestore:"description"`
	QuestType   string               `json:"quest_type"   firestore:"quest_type"`   // story, daily, weekly, achievement
	Status      string               `json:"status"       firestore:"status"`       // draft, active, retired
	SortOrder   int                  `json:"sort_order"   firestore:"sort_order"`
	Rewards     []QuestReward        `json:"rewards"      firestore:"rewards"`
	Metadata    map[string]any       `json:"metadata"     firestore:"metadata"`
	Checkpoints []CheckpointTemplate `json:"checkpoints,omitempty" firestore:"-"` // populated from subcollection
	CreatedAt   time.Time            `json:"created_at"   firestore:"created_at"`
	UpdatedAt   time.Time            `json:"updated_at"   firestore:"updated_at"`
}

// QuestTemplateCreate is the request body for creating a quest template.
type QuestTemplateCreate struct {
	QuestID     string         `json:"quest_id"     binding:"required"` // deterministic ID for seeding
	Title       string         `json:"title"        binding:"required"`
	Description string         `json:"description"`
	QuestType   string         `json:"quest_type"   binding:"required"`
	Status      string         `json:"status"`
	SortOrder   int            `json:"sort_order"`
	Rewards     []QuestReward  `json:"rewards"`
	Metadata    map[string]any `json:"metadata"`
}

// Valid quest types
var validQuestTypes = map[string]bool{
	"story":       true,
	"daily":       true,
	"weekly":      true,
	"achievement": true,
}

// Valid quest statuses
var validQuestStatuses = map[string]bool{
	"draft":   true,
	"active":  true,
	"retired": true,
}

// -----------------------------------------------------------------------------
// Quest Status (per-user progress tracking)
// -----------------------------------------------------------------------------

// QuestStatus tracks a user's progress on a specific quest.
// Keyed by user_id to prevent the same user completing a quest multiple times.
// Also stores profile_id because the profile is the one doing the questing.
type QuestStatus struct {
	QuestID   string     `json:"quest_id"    firestore:"quest_id"`
	UserID    string     `json:"user_id"     firestore:"user_id"`
	ProfileID string     `json:"profile_id"  firestore:"profile_id"`
	Status    string     `json:"status"      firestore:"status"` // started, completed, failed
	CreatedAt time.Time  `json:"created_at"  firestore:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"  firestore:"updated_at"`
}

// QuestStatusUpdate is the request body for updating quest status (bot-callable).
type QuestStatusUpdate struct {
	QuestID   string `json:"quest_id"   binding:"required"`
	UserID    string `json:"user_id"    binding:"required"`
	ProfileID string `json:"profile_id" binding:"required"`
	Status    string `json:"status"     binding:"required"` // started, completed, failed
}

// QuestStatusUpdateByProfile is the request body for updating quest status
// using only a profile_id. The quests service resolves profile_id → user_id
// by calling the profiles service internally.
type QuestStatusUpdateByProfile struct {
	QuestID   string `json:"quest_id"   binding:"required"`
	ProfileID string `json:"profile_id" binding:"required"`
	Status    string `json:"status"     binding:"required"` // started, completed, failed
}

// Valid quest progress statuses
var validProgressStatuses = map[string]bool{
	"started":   true,
	"completed": true,
	"failed":    true,
}

// -----------------------------------------------------------------------------
// Checkpoint Templates (ordered steps within a quest)
// -----------------------------------------------------------------------------

// CheckpointTemplate defines a single ordered step within a quest.
// The description is designed to be read by a bot/LLM to decide if the
// checkpoint condition has been met.
// Stored in top-level collection: checkpoint_templates/{checkpoint_id}
type CheckpointTemplate struct {
	CheckpointID        string         `json:"checkpoint_id"        firestore:"checkpoint_id"`
	QuestID             string         `json:"quest_id"             firestore:"quest_id"`
	BotID               string         `json:"bot_id"               firestore:"bot_id"`
	Description         string         `json:"description"          firestore:"description"`
	DetailedDescription string         `json:"detailed_description" firestore:"detailed_description"`
	SuccessCriteria     string         `json:"success_criteria"     firestore:"success_criteria"`
	SortOrder           int            `json:"sort_order"           firestore:"sort_order"`
	Metadata            map[string]any `json:"metadata"             firestore:"metadata"`
	CreatedAt           time.Time      `json:"created_at"           firestore:"created_at"`
	UpdatedAt           time.Time      `json:"updated_at"           firestore:"updated_at"`
}

// CheckpointTemplateCreate is the request body for creating a checkpoint template.
type CheckpointTemplateCreate struct {
	CheckpointID        string         `json:"checkpoint_id"        binding:"required"`
	QuestID             string         `json:"quest_id"             binding:"required"`
	BotID               string         `json:"bot_id"`
	Description         string         `json:"description"          binding:"required"`
	DetailedDescription string         `json:"detailed_description"`
	SuccessCriteria     string         `json:"success_criteria"`
	SortOrder           int            `json:"sort_order"`
	Metadata            map[string]any `json:"metadata"`
}

// -----------------------------------------------------------------------------
// Checkpoint Status (per-profile completion tracking)
// -----------------------------------------------------------------------------

// CheckpointStatus tracks a profile's completion of a specific checkpoint.
// Keyed per-profile so different profiles can independently hit checkpoints.
// Quest completion rolls up to the user level.
type CheckpointStatus struct {
	QuestID      string    `json:"quest_id"       firestore:"quest_id"`
	CheckpointID string    `json:"checkpoint_id"  firestore:"checkpoint_id"`
	ProfileID    string    `json:"profile_id"     firestore:"profile_id"`
	UserID       string    `json:"user_id"        firestore:"user_id"`
	Status       string    `json:"status"         firestore:"status"` // completed
	CreatedAt    time.Time `json:"created_at"     firestore:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"     firestore:"updated_at"`
}
