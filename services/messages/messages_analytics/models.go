package main

import (
	"encoding/json"
	"time"

	"github.com/googleapis/google-cloudevents-go/cloud/firestoredata"
)

// ChangelogRow defines the structure for BigQuery raw changelog records.
type ChangelogRow struct {
	Timestamp    time.Time `bigquery:"timestamp"`
	EventID      string    `bigquery:"event_id"`
	DocumentName string    `bigquery:"document_name"`
	DocumentID   string    `bigquery:"document_id"`
	Operation    string    `bigquery:"operation"`
	Data         string    `bigquery:"data"`     // JSON serialized fields
	OldData      string    `bigquery:"old_data"` // JSON serialized fields (optional)
}

// ConvertFieldsToJSON converts a map of firestoredata.Value to a JSON string.
func ConvertFieldsToJSON(fields map[string]*firestoredata.Value) (string, error) {
	if fields == nil {
		return "{}", nil
	}
	m := make(map[string]interface{})
	for k, v := range fields {
		m[k] = convertValue(v)
	}
	bytes, err := json.Marshal(m)
	if err != nil {
		return "", err
	}
	return string(bytes), nil
}

// convertValue converts a firestoredata.Value to its native Go representation.
func convertValue(v *firestoredata.Value) interface{} {
	if v == nil || v.ValueType == nil {
		return nil
	}

	switch x := v.ValueType.(type) {
	case *firestoredata.Value_NullValue:
		return nil
	case *firestoredata.Value_BooleanValue:
		return x.BooleanValue
	case *firestoredata.Value_IntegerValue:
		return x.IntegerValue
	case *firestoredata.Value_DoubleValue:
		return x.DoubleValue
	case *firestoredata.Value_TimestampValue:
		if x.TimestampValue != nil {
			return x.TimestampValue.AsTime().Format(time.RFC3339)
		}
		return nil
	case *firestoredata.Value_StringValue:
		return x.StringValue
	case *firestoredata.Value_BytesValue:
		return x.BytesValue
	case *firestoredata.Value_ReferenceValue:
		return x.ReferenceValue
	case *firestoredata.Value_GeoPointValue:
		if x.GeoPointValue != nil {
			return map[string]float64{
				"latitude":  x.GeoPointValue.Latitude,
				"longitude": x.GeoPointValue.Longitude,
			}
		}
		return nil
	case *firestoredata.Value_ArrayValue:
		if x.ArrayValue == nil {
			return []interface{}{}
		}
		arr := make([]interface{}, len(x.ArrayValue.Values))
		for i, av := range x.ArrayValue.Values {
			arr[i] = convertValue(av)
		}
		return arr
	case *firestoredata.Value_MapValue:
		if x.MapValue == nil {
			return map[string]interface{}{}
		}
		m := make(map[string]interface{})
		for mk, mv := range x.MapValue.Fields {
			m[mk] = convertValue(mv)
		}
		return m
	}

	return nil
}
