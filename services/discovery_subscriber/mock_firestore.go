package main

import (
	"context"

	"cloud.google.com/go/firestore"
	"tavern-swiper.app/firestoreutil"
)

type mockClient struct {
	firestoreutil.FirestoreClient
	collections map[string]*mockCollection
}

func (c *mockClient) Collection(path string) firestoreutil.CollectionRef {
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

func (c *mockClient) Pipeline() firestoreutil.Pipeline {
	return &mockPipeline{client: c}
}

type mockCollection struct {
	firestoreutil.CollectionRef
	path string
	docs map[string]*mockDoc
}

func (c *mockCollection) Doc(path string) firestoreutil.DocumentRef {
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

type mockDoc struct {
	firestoreutil.DocumentRef
	id     string
	data   map[string]interface{}
	exists bool
}

func (d *mockDoc) ID() string { return d.id }

func (d *mockDoc) Get(ctx context.Context) (firestoreutil.DocumentSnapshot, error) {
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
	firestoreutil.DocumentSnapshot
	id     string
	data   map[string]interface{}
	exists bool
	ref    firestoreutil.DocumentRef
}

func (s *mockSnap) Exists() bool                          { return s.exists }
func (s *mockSnap) Data() map[string]interface{}          { return s.data }
func (s *mockSnap) ID() string                            { return s.id }
func (s *mockSnap) Ref() firestoreutil.DocumentRef        { return s.ref }

type mockPipeline struct {
	firestoreutil.Pipeline
	client *mockClient
	col    *mockCollection
}

func (p *mockPipeline) Collection(path string) firestoreutil.Pipeline {
	p.col = p.client.Collection(path).(*mockCollection)
	return p
}
func (p *mockPipeline) Execute(ctx context.Context) firestoreutil.PipelineSnapshot {
	return &mockPipelineSnapshot{col: p.col}
}

type mockPipelineSnapshot struct {
	firestoreutil.PipelineSnapshot
	col *mockCollection
}

func (s *mockPipelineSnapshot) Results() firestoreutil.PipelineIterator {
	return &mockPipelineIter{}
}

type mockPipelineIter struct {
	firestoreutil.PipelineIterator
}

func (i *mockPipelineIter) Next() (firestoreutil.PipelineResult, error) {
	return nil, nil // Return nil for now to satisfy interface
}
