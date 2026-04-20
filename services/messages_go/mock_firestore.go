package main

import (
	"context"
	"reflect"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
)

type mockClient struct {
	FirestoreClient
	collections map[string]*mockCollection
}

func (c *mockClient) Collection(path string) CollectionRef {
	if c.collections == nil {
		c.collections = make(map[string]*mockCollection)
	}
	if col, ok := c.collections[path]; ok {
		return col
	}
	col := &mockCollection{path: path}
	c.collections[path] = col
	return col
}

func (c *mockClient) Batch() WriteBatch {
	return &mockBatch{}
}

type mockCollection struct {
	CollectionRef
	path     string
	docs     map[string]*mockDoc
	queryRes []*mockSnap
}

func (c *mockCollection) Doc(path string) DocumentRef {
	if c.docs == nil {
		c.docs = make(map[string]*mockDoc)
	}
	if d, ok := c.docs[path]; ok {
		return d
	}
	d := &mockDoc{id: path, data: make(map[string]interface{}), parent: c}
	c.docs[path] = d
	return d
}

func (c *mockCollection) Where(path, op string, value interface{}) Query {
	return &mockQuery{col: c, filters: []filter{{path, op, value}}}
}

func (m *mockCollection) Limit(n int) Query {
	return &mockQuery{col: m, limit: n}
}

func (c *mockCollection) Documents(ctx context.Context) DocumentIterator {
	q := &mockQuery{col: c}
	return q.Documents(ctx)
}

type filter struct {
	path  string
	op    string
	value interface{}
}

type mockDoc struct {
	DocumentRef
	id             string
	data           map[string]interface{}
	exists         bool
	subCollections map[string]*mockCollection
	parent         *mockCollection
}

func (d *mockDoc) Get(ctx context.Context) (DocumentSnapshot, error) {
	return &mockSnap{id: d.id, data: d.data, exists: d.exists, ref: d}, nil
}

func (d *mockDoc) Set(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
	d.exists = true
	if m, ok := data.(map[string]interface{}); ok {
		for k, v := range m {
			if v == firestore.ServerTimestamp {
				d.data[k] = time.Now().UTC()
			} else {
				d.data[k] = v
			}
		}
	} else if doc, ok := data.(Conversation); ok {
		d.data = map[string]interface{}{
			"id":               doc.ID,
			"participants_key": doc.ParticipantsKey,
			"participant_ids":  doc.ParticipantIDs,
			"created_at":       doc.CreatedAt,
			"updated_at":       doc.UpdatedAt,
		}
	} else if msg, ok := data.(Message); ok {
		d.data = map[string]interface{}{
			"sent_by":    msg.SentBy,
			"content":    msg.Content,
			"created_at": msg.CreatedAt,
			"updated_at": msg.UpdatedAt,
		}
	} else if pc, ok := data.(ProfileConversation); ok {
		d.data = map[string]interface{}{
			"profile_id":      pc.ProfileID,
			"conversation_id": pc.ConversationID,
			"role":            pc.Role,
		}
	} else if doc, ok := data.(*Conversation); ok {
		d.data = map[string]interface{}{
			"id":               doc.ID,
			"participants_key": doc.ParticipantsKey,
			"participant_ids":  doc.ParticipantIDs,
			"created_at":       doc.CreatedAt,
			"updated_at":       doc.UpdatedAt,
		}
	}
	return &firestore.WriteResult{}, nil
}

func (d *mockDoc) Delete(ctx context.Context, opts ...firestore.Precondition) (*firestore.WriteResult, error) {
	d.exists = false
	d.data = nil
	return &firestore.WriteResult{}, nil
}

func (d *mockDoc) Collection(path string) CollectionRef {
	if d.subCollections == nil {
		d.subCollections = make(map[string]*mockCollection)
	}
	if col, ok := d.subCollections[path]; ok {
		return col
	}
	col := &mockCollection{path: path}
	d.subCollections[path] = col
	return col
}

type mockSnap struct {
	DocumentSnapshot
	id     string
	data   map[string]interface{}
	exists bool
	ref    DocumentRef
}

func (s *mockSnap) Exists() bool                 { return s.exists }
func (s *mockSnap) Data() map[string]interface{} { return s.data }
func (s *mockSnap) ID() string                   { return s.id }
func (s *mockSnap) Ref() DocumentRef             { return s.ref }

type mockIter struct {
	DocumentIterator
	snaps []*mockSnap
	index int
}

func (i *mockIter) Next() (DocumentSnapshot, error) {
	if i.index >= len(i.snaps) {
		return nil, iterator.Done
	}
	s := i.snaps[i.index]
	i.index++
	return s, nil
}

func (i *mockIter) GetAll() ([]DocumentSnapshot, error) {
	res := make([]DocumentSnapshot, len(i.snaps))
	for j, s := range i.snaps {
		res[j] = s
	}
	return res, nil
}

type mockQuery struct {
	Query
	col     *mockCollection
	filters []filter
	limit   int
}

func (q *mockQuery) Limit(n int) Query { q.limit = n; return q }
func (q *mockQuery) Where(path, op string, value interface{}) Query {
	q.filters = append(q.filters, filter{path, op, value})
	return q
}

func (q *mockQuery) Documents(ctx context.Context) DocumentIterator {
	var snaps []*mockSnap
	for _, d := range q.col.docs {
		if !d.exists {
			continue
		}
		match := true
		for _, f := range q.filters {
			val := d.data[f.path]
			switch f.op {
			case "==":
				if !reflect.DeepEqual(val, f.value) {
					match = false
				}
			case "array-contains":
				found := false
				if slice, ok := val.([]interface{}); ok {
					for _, v := range slice {
						if reflect.DeepEqual(v, f.value) {
							found = true
							break
						}
					}
				} else if slice, ok := val.([]string); ok {
					for _, v := range slice {
						if v == f.value {
							found = true
							break
						}
					}
				}
				if !found {
					match = false
				}
			}
			if !match {
				break
			}
		}
		if match {
			snaps = append(snaps, &mockSnap{id: d.id, data: d.data, exists: true, ref: d})
		}
	}
	if q.limit > 0 && len(snaps) > q.limit {
		snaps = snaps[:q.limit]
	}
	return &mockIter{snaps: snaps}
}

type mockBatch struct {
	WriteBatch
}

func (b *mockBatch) Set(dr DocumentRef, data interface{}, opts ...firestore.SetOption) WriteBatch {
	dr.Set(context.Background(), data, opts...)
	return b
}
func (b *mockBatch) Delete(dr DocumentRef) WriteBatch {
	dr.Delete(context.Background())
	return b
}
func (b *mockBatch) Commit(ctx context.Context) ([]*firestore.WriteResult, error) {
	return []*firestore.WriteResult{}, nil
}
