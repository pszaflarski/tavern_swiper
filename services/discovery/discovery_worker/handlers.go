package discovery_worker

import (
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	SwipesCollection = "swipes"
	BatchSize        = 500
)

func HandleCleanup(c *gin.Context) {
	ctx := c.Request.Context()
	
	// 1. Resolve TTL Config
	ttlHoursStr := os.Getenv("CLEANUP_TTL_HOURS")
	ttlHours := 24
	if ttlHoursStr != "" {
		if val, err := strconv.Atoi(ttlHoursStr); err == nil && val > 0 {
			ttlHours = val
		} else {
			log.Printf("[WARN] Invalid CLEANUP_TTL_HOURS '%s', defaulting to 24", ttlHoursStr)
		}
	}

	// 2. Calculate Cutoff Time (explicitly in UTC timezone)
	cutoff := time.Now().UTC().Add(-time.Duration(ttlHours) * time.Hour)
	log.Printf("[INFO] Starting swipes cleanup. Deleting left swipes created before: %s (TTL: %d hours)", cutoff.Format(time.RFC3339), ttlHours)

	client, err := GetDBFunc(ctx)
	if err != nil {
		log.Printf("[ERROR] Failed to get Firestore client: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "Database connection error"})
		return
	}

	// 3. Batched Deletion Loop
	deletedCount := 0
	for {
		// Query left swipes older than cutoff
		iter := client.Collection(SwipesCollection).
			Where("direction", "==", "left").
			Where("created_at", "<", cutoff).
			Limit(BatchSize).
			Documents(ctx)

		docs, err := iter.GetAll()
		iter.Stop()
		if err != nil {
			log.Printf("[ERROR] Failed to query swipes: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"detail": "Failed to query swipes from database"})
			return
		}

		if len(docs) == 0 {
			break
		}

		batch := client.Batch()
		for _, doc := range docs {
			batch.Delete(doc.Ref())
		}

		if _, err := batch.Commit(ctx); err != nil {
			log.Printf("[ERROR] Failed to commit deletion batch: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"detail": "Failed to delete swipes batch"})
			return
		}

		deletedCount += len(docs)
		log.Printf("[INFO] Successfully deleted batch of %d expired left swipes. Total deleted: %d", len(docs), deletedCount)

		if len(docs) < BatchSize {
			break
		}
	}

	log.Printf("[INFO] Swipes cleanup completed successfully. Deleted a total of %d swipes.", deletedCount)
	c.JSON(http.StatusOK, gin.H{
		"status":        "success",
		"deleted_count": deletedCount,
		"cutoff_time":   cutoff.Format(time.RFC3339),
	})
}
