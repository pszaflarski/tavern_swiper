package main

import (
	"context"

	"cloud.google.com/go/firestore"
)

type mockClient struct {
	FirestoreClient
	collections          map[string]*mockCollection
	deleteCollectionCalled bool
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

func (c *mockClient) Pipeline() Pipeline {
	return &mockPipeline{client: c}
}

func (c *mockClient) Batch() WriteBatch {
	return &mockBatch{}
}

func (c *mockClient) GetAll(ctx context.Context, refs []DocumentRef) ([]DocumentSnapshot, error) {
	return nil, nil
}

func (c *mockClient) DeleteCollection(ctx context.Context, col CollectionRef, batchSize int) error {
	c.deleteCollectionCalled = true
	// Actually clear the docs in the mock collection if it's a mockCollection
	if mc, ok := col.(*mockCollection); ok {
		mc.docs = make(map[string]*mockDoc)
	}
	return nil
}

func (c *mockClient) Close() error {
	return nil
}

func (c *mockClient) CollectionGroup(id string) Query {
	return &mockQuery{}
}

type mockBatch struct {
	WriteBatch
}

func (b *mockBatch) Set(dr DocumentRef, data interface{}, opts ...firestore.SetOption) WriteBatch { return b }
func (b *mockBatch) Update(dr DocumentRef, updates []firestore.Update, opts ...firestore.Precondition) WriteBatch { return b }
func (b *mockBatch) Delete(dr DocumentRef) WriteBatch { return b }
func (b *mockBatch) Commit(ctx context.Context) ([]*firestore.WriteResult, error) {
	return []*firestore.WriteResult{}, nil
}

type mockQuery struct {
	Query
}

func (q *mockQuery) Limit(n int) Query { return q }
func (q *mockQuery) Where(path, op string, value interface{}) Query { return q }
func (q *mockQuery) OrderBy(path string, dir firestore.Direction) Query { return q }
func (q *mockQuery) Documents(ctx context.Context) DocumentIterator {
	return &mockIter{}
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
	d := &mockDoc{id: path, data: make(map[string]interface{})}
	c.docs[path] = d
	return d
}

func (c *mockCollection) Where(path, op string, value interface{}) Query { return &mockQuery{} }
func (c *mockCollection) Limit(n int) Query { return &mockQuery{} }
func (c *mockCollection) OrderBy(path string, dir firestore.Direction) Query { return &mockQuery{} }
func (c *mockCollection) Documents(ctx context.Context) DocumentIterator { return &mockIter{} }

type mockIter struct {
	DocumentIterator
}

func (i *mockIter) Next() (DocumentSnapshot, error)         { return nil, nil }
func (i *mockIter) GetAll() ([]DocumentSnapshot, error)     { return nil, nil }
func (i *mockIter) Stop()                                   {}

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

func (s *mockSnap) Exists() bool                          { return s.exists }
func (s *mockSnap) Data() map[string]interface{}          { return s.data }
func (s *mockSnap) ID() string                            { return s.id }
func (s *mockSnap) Ref() DocumentRef        { return s.ref }

type mockPipeline struct {
	Pipeline
	client *mockClient
	col    *mockCollection
}

func (p *mockPipeline) Collection(path string) Pipeline {
	p.col = p.client.Collection(path).(*mockCollection)
	return p
}
func (p *mockPipeline) Execute(ctx context.Context) PipelineSnapshot {
	return &mockPipelineSnapshot{col: p.col}
}

type mockPipelineSnapshot struct {
	PipelineSnapshot
	col *mockCollection
}

func (s *mockPipelineSnapshot) Results() PipelineIterator {
	return &mockPipelineIter{}
}

type mockPipelineIter struct {
	PipelineIterator
}

func (i *mockPipelineIter) Next() (PipelineResult, error) {
	return nil, nil // Return nil for now to satisfy interface
}
