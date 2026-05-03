package main

import (
	"context"

	"cloud.google.com/go/firestore"
	"tavern-swiper.app/firestoreutil"
)

// Mock Types
type mockClient struct {
	firestoreutil.FirestoreClient
	collectionFunc func(path string) firestoreutil.CollectionRef
	batchFunc      func() firestoreutil.WriteBatch
}

func (m *mockClient) Collection(path string) firestoreutil.CollectionRef {
	return m.collectionFunc(path)
}
func (m *mockClient) Batch() firestoreutil.WriteBatch { return m.batchFunc() }
func (m *mockClient) Pipeline() firestoreutil.Pipeline { return nil }
func (m *mockClient) DeleteCollection(ctx context.Context, col firestoreutil.CollectionRef, batchSize int) error {
	return nil
}

type mockCollection struct {
	firestoreutil.CollectionRef
	docFunc       func(path string) firestoreutil.DocumentRef
	whereFunc     func(path, op string, value interface{}) firestoreutil.Query
	documentsFunc func(ctx context.Context) firestoreutil.DocumentIterator
}

func (m mockCollection) Doc(path string) firestoreutil.DocumentRef { return m.docFunc(path) }
func (m mockCollection) Where(path, op string, value interface{}) firestoreutil.Query {
	if m.whereFunc != nil {
		return m.whereFunc(path, op, value)
	}
	return &mockQuery{documentsFunc: m.documentsFunc} // Pass through documentsFunc
}
func (m mockCollection) Limit(n int) firestoreutil.Query {
	if m.whereFunc != nil {
		return m.whereFunc("", "limit", n)
	}
	return &mockQuery{documentsFunc: m.documentsFunc}
}
func (m mockCollection) OrderBy(path string, dir firestore.Direction) firestoreutil.Query {
	return &mockQuery{documentsFunc: m.documentsFunc}
}
func (m mockCollection) Documents(ctx context.Context) firestoreutil.DocumentIterator {
	if m.documentsFunc != nil {
		return m.documentsFunc(ctx)
	}
	return &mockIterator{}
}

type mockDoc struct {
	firestoreutil.DocumentRef
	id         string
	getFunc    func(ctx context.Context) (firestoreutil.DocumentSnapshot, error)
	setFunc    func(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error)
	updateFunc func(ctx context.Context, updates []firestore.Update, opts ...firestore.Precondition) (*firestore.WriteResult, error)
	deleteFunc func(ctx context.Context, opts ...firestore.Precondition) (*firestore.WriteResult, error)
}

func (d *mockDoc) ID() string { return d.id }

func (m mockDoc) Get(ctx context.Context) (firestoreutil.DocumentSnapshot, error) { return m.getFunc(ctx) }
func (m mockDoc) Set(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
	return m.setFunc(ctx, data, opts...)
}
func (m mockDoc) Update(ctx context.Context, updates []firestore.Update, opts ...firestore.Precondition) (*firestore.WriteResult, error) {
	return m.updateFunc(ctx, updates, opts...)
}
func (m mockDoc) Delete(ctx context.Context, opts ...firestore.Precondition) (*firestore.WriteResult, error) {
	return m.deleteFunc(ctx, opts...)
}
func (m mockDoc) Collection(path string) firestoreutil.CollectionRef { return nil }

type mockSnapshot struct {
	firestoreutil.DocumentSnapshot
	exists bool
	data   map[string]interface{}
	id     string
	ref    firestoreutil.DocumentRef
}

func (m mockSnapshot) Exists() bool                          { return m.exists }
func (m mockSnapshot) Data() map[string]interface{}          { return m.data }
func (m mockSnapshot) ID() string                            { return m.id }
func (m mockSnapshot) Ref() firestoreutil.DocumentRef        { return m.ref }

type mockIterator struct {
	firestoreutil.DocumentIterator
	nextFunc   func() (firestoreutil.DocumentSnapshot, error)
	getAllFunc func() ([]firestoreutil.DocumentSnapshot, error)
}

func (m mockIterator) Next() (firestoreutil.DocumentSnapshot, error) {
	if m.nextFunc != nil {
		return m.nextFunc()
	}
	return nil, nil
}
func (m mockIterator) GetAll() ([]firestoreutil.DocumentSnapshot, error) {
	if m.getAllFunc != nil {
		return m.getAllFunc()
	}
	return []firestoreutil.DocumentSnapshot{}, nil
}
func (m mockIterator) Stop() {}

type mockQuery struct {
	firestoreutil.Query
	limitFunc     func(n int) firestoreutil.Query
	whereFunc     func(path, op string, value interface{}) firestoreutil.Query
	documentsFunc func(ctx context.Context) firestoreutil.DocumentIterator
}

func (q *mockQuery) Limit(n int) firestoreutil.Query {
	if q.limitFunc != nil {
		return q.limitFunc(n)
	}
	return q
}
func (q *mockQuery) Where(path, op string, value interface{}) firestoreutil.Query {
	if q.whereFunc != nil {
		return q.whereFunc(path, op, value)
	}
	return q
}
func (q *mockQuery) OrderBy(path string, dir firestore.Direction) firestoreutil.Query { return q }
func (q *mockQuery) Documents(ctx context.Context) firestoreutil.DocumentIterator {
	if q.documentsFunc != nil {
		return q.documentsFunc(ctx)
	}
	return &mockIterator{}
}

type mockBatch struct {
	firestoreutil.WriteBatch
	deleteFunc func(dr firestoreutil.DocumentRef) firestoreutil.WriteBatch
	commitFunc func(ctx context.Context) ([]*firestore.WriteResult, error)
}

func (m mockBatch) Delete(dr firestoreutil.DocumentRef) firestoreutil.WriteBatch { return m.deleteFunc(dr) }
func (m mockBatch) Commit(ctx context.Context) ([]*firestore.WriteResult, error) {
	return m.commitFunc(ctx)
}
