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

func (c *mockClient) Close() error {
	return nil
}

type mockCollection struct {
	CollectionRef
	path string
	docs map[string]*mockDoc
}

func (c *mockCollection) Doc(path string) DocumentRef {
	if c.docs == nil {
		c.docs = make(map[string]*mockDoc)
	}
	if d, ok := c.docs[path]; ok {
		return d
	}
	d := &mockDoc{id: path, data: make(map[string]interface{}), exists: false}
	c.docs[path] = d
	return d
}

func (c *mockCollection) Where(path, op string, value interface{}) Query {
	return &mockCollectionQuery{
		col:        c,
		wherePath:  path,
		whereOp:    op,
		whereValue: value,
	}
}

func (c *mockCollection) OrderBy(path string, dir firestore.Direction) Query {
	return &mockCollectionQuery{col: c}
}

func (c *mockCollection) Documents(ctx context.Context) DocumentIterator {
	var snaps []DocumentSnapshot
	for _, doc := range c.docs {
		if doc.exists {
			snaps = append(snaps, &mockSnap{id: doc.id, data: doc.data, exists: doc.exists, ref: doc})
		}
	}
	return &mockIter{snaps: snaps, index: 0}
}

type mockCollectionQuery struct {
	Query
	col        *mockCollection
	wherePath  string
	whereOp    string
	whereValue interface{}
}

func (q *mockCollectionQuery) OrderBy(path string, dir firestore.Direction) Query { return q }
func (q *mockCollectionQuery) Limit(n int) Query                                 { return q }

func (q *mockCollectionQuery) Documents(ctx context.Context) DocumentIterator {
	var snaps []DocumentSnapshot
	for _, doc := range q.col.docs {
		if !doc.exists {
			continue
		}
		if q.wherePath == "" {
			snaps = append(snaps, &mockSnap{id: doc.id, data: doc.data, exists: doc.exists, ref: doc})
			continue
		}
		// Match simple where filter
		val, ok := doc.data[q.wherePath]
		if ok && val == q.whereValue {
			snaps = append(snaps, &mockSnap{id: doc.id, data: doc.data, exists: doc.exists, ref: doc})
		}
	}
	return &mockIter{snaps: snaps, index: 0}
}

type mockIter struct {
	DocumentIterator
	snaps []DocumentSnapshot
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
	return i.snaps, nil
}

func (i *mockIter) Stop() {}

type mockDoc struct {
	DocumentRef
	id     string
	data   map[string]interface{}
	exists bool
}

func (d *mockDoc) ID() string { return d.id }

func (d *mockDoc) Get(ctx context.Context) (DocumentSnapshot, error) {
	return &mockSnap{id: d.id, data: d.data, exists: d.exists, ref: d}, nil
}

func (d *mockDoc) Set(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
	d.exists = true
	if m, ok := data.(map[string]interface{}); ok {
		d.data = m
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
func (s *mockSnap) Ref() DocumentRef            { return s.ref }
