package main

import (
	"log"
	"net/http"
	"strings"
	"time"

	cloudevents "github.com/cloudevents/sdk-go/v2"
	"github.com/gin-gonic/gin"
	"github.com/googleapis/google-cloudevents-go/cloud/firestoredata"
	"google.golang.org/protobuf/proto"
)

type Handlers struct {
	bqClient BQClient
}

func NewHandlers(bqClient BQClient) *Handlers {
	return &Handlers{
		bqClient: bqClient,
	}
}

func (h *Handlers) HandleFirestoreEvent(c *gin.Context) {
	// 1. Parse CloudEvent from the HTTP request
	event, err := cloudevents.NewEventFromHTTPRequest(c.Request)
	if err != nil {
		log.Printf("⚠️ Failed to parse CloudEvent: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid CloudEvent format"})
		return
	}

	// 2. Unmarshal event data into Firestore DocumentEventData
	var firestoreData firestoredata.DocumentEventData
	if err := proto.Unmarshal(event.Data(), &firestoreData); err != nil {
		log.Printf("⚠️ Failed to unmarshal Firestore DocumentEventData: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to decode firestore event data"})
		return
	}

	// 3. Extract metadata
	docName := ""
	var fields map[string]*firestoredata.Value
	var oldFields map[string]*firestoredata.Value

	if firestoreData.Value != nil {
		docName = firestoreData.Value.Name
		fields = firestoreData.Value.Fields
	}
	if firestoreData.OldValue != nil {
		if docName == "" {
			docName = firestoreData.OldValue.Name
		}
		oldFields = firestoreData.OldValue.Fields
	}

	docID := ""
	if docName != "" {
		parts := strings.Split(docName, "/")
		docID = parts[len(parts)-1]
	}

	// Determine operation
	operation := "UPDATE"
	eventType := event.Type()
	if strings.HasSuffix(eventType, ".created") {
		operation = "INSERT"
	} else if strings.HasSuffix(eventType, ".deleted") {
		operation = "DELETE"
	} else if strings.HasSuffix(eventType, ".written") {
		if firestoreData.Value != nil && firestoreData.OldValue == nil {
			operation = "INSERT"
		} else if firestoreData.Value == nil && firestoreData.OldValue != nil {
			operation = "DELETE"
		}
	}

	// Convert Firestore document fields to JSON
	dataJSON, err := ConvertFieldsToJSON(fields)
	if err != nil {
		log.Printf("❌ Failed to convert new fields to JSON: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to process fields"})
		return
	}

	oldDataJSON, err := ConvertFieldsToJSON(oldFields)
	if err != nil {
		log.Printf("❌ Failed to convert old fields to JSON: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to process old fields"})
		return
	}

	timestamp := event.Time()
	if timestamp.IsZero() {
		timestamp = time.Now()
	}

	row := &ChangelogRow{
		Timestamp:    timestamp,
		EventID:      event.ID(),
		DocumentName: docName,
		DocumentID:   docID,
		Operation:    operation,
		Data:         dataJSON,
		OldData:      oldDataJSON,
	}

	tableName := "matches_cdc"
	if strings.Contains(docName, "/profiles_profiles_cache/") {
		tableName = "profiles_cache_cdc"
	}

	log.Printf("📥 Processing discovery CDC event: doc_id=%s, table=%s, op=%s", docID, tableName, operation)

	// 4. Write to BigQuery
	if err := h.bqClient.InsertRow(c.Request.Context(), tableName, row); err != nil {
		log.Printf("❌ BigQuery insertion error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to insert row into bigquery"})
		return
	}

	c.Status(http.StatusOK)
}
