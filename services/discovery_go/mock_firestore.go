package main

import (
	"context"

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
	path      string
	docs      map[string]*mockDoc
	queryRes  []*mockSnap
}

func (c *mockCollection) Doc(path string) DocumentRef {
	if c.docs == nil {
		c.docs = make(map[string]*mockDoc)
	}
	if d, ok := c.docs[path]; ok {
		return d
	}
	d := &mockDoc{id: path, data: make(map[string]interface{})}
	c.docs[path] = d
	return d
}

func (c *mockCollection) Where(path, op string, value interface{}) Query {
	return &mockQuery{col: c}
}

func (c *mockCollection) Limit(n int) Query {
	return &mockQuery{col: c}
}

func (c *mockCollection) Documents(ctx context.Context) DocumentIterator {
	return &mockIter{snaps: c.queryRes}
}

type mockDoc struct {
	DocumentRef
	id     string
	data   map[string]interface{}
	exists bool
}

func (d *mockDoc) Get(ctx context.Context) (DocumentSnapshot, error) {
	return &mockSnap{id: d.id, data: d.data, exists: d.exists, ref: d}, nil
}

func (d *mockDoc) Set(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
	d.exists = true
	if m, ok := data.(map[string]interface{}); ok {
		for k, v := range m {
			if v == firestore.ServerTimestamp {
				d.data[k] = _now().UTC()
			} else {
				d.data[k] = v
			}
		}
	}
	return &firestore.WriteResult{}, nil
}

func (d *mockDoc) Delete(ctx context.Context, opts ...firestore.Precondition) (*firestore.WriteResult, error) {
	d.exists = false
	d.data = nil
	return &firestore.WriteResult{}, nil
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
	col *mockCollection
}

func (q *mockQuery) Limit(n int) Query { return q }
func (q *mockQuery) Where(path, op string, value interface{}) Query { return q }
func (q *mockQuery) Documents(ctx context.Context) DocumentIterator {
	return q.col.Documents(ctx)
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
