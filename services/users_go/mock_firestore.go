package main

import (
	"context"
	"cloud.google.com/go/firestore"
)

// Mock Types
type mockClient struct {
	collectionFunc func(path string) CollectionRef
	batchFunc      func() WriteBatch
}
func (m *mockClient) Collection(path string) CollectionRef { return m.collectionFunc(path) }
func (m *mockClient) Batch() WriteBatch                    { return m.batchFunc() }

type mockCollection struct {
	docFunc       func(path string) DocumentRef
	whereFunc     func(path, op string, value interface{}) Query
	documentsFunc func(ctx context.Context) DocumentIterator
}
func (m mockCollection) Doc(path string) DocumentRef { return m.docFunc(path) }
func (m mockCollection) Where(path, op string, value interface{}) Query {
	return m.whereFunc(path, op, value)
}
func (m mockCollection) Limit(n int) Query {
	return m.whereFunc("", "limit", n) // Reuse whereFunc for simplicity in these mocks
}
func (m mockCollection) Documents(ctx context.Context) DocumentIterator {
	return m.documentsFunc(ctx)
}

type mockDoc struct {
	getFunc    func(ctx context.Context) (DocumentSnapshot, error)
	setFunc    func(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error)
	updateFunc func(ctx context.Context, updates []firestore.Update, opts ...firestore.Precondition) (*firestore.WriteResult, error)
	deleteFunc func(ctx context.Context, opts ...firestore.Precondition) (*firestore.WriteResult, error)
}
func (m mockDoc) Get(ctx context.Context) (DocumentSnapshot, error) { return m.getFunc(ctx) }
func (m mockDoc) Set(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
	return m.setFunc(ctx, data, opts...)
}
func (m mockDoc) Update(ctx context.Context, updates []firestore.Update, opts ...firestore.Precondition) (*firestore.WriteResult, error) {
	return m.updateFunc(ctx, updates, opts...)
}
func (m mockDoc) Delete(ctx context.Context, opts ...firestore.Precondition) (*firestore.WriteResult, error) {
	return m.deleteFunc(ctx, opts...)
}

type mockSnapshot struct {
	exists bool
	data   map[string]interface{}
	id     string
	ref    DocumentRef
}
func (m mockSnapshot) Exists() bool               { return m.exists }
func (m mockSnapshot) Data() map[string]interface{} { return m.data }
func (m mockSnapshot) ID() string                 { return m.id }
func (m mockSnapshot) Ref() DocumentRef           { return m.ref }

type mockIterator struct {
	nextFunc    func() (DocumentSnapshot, error)
	getAllFunc  func() ([]DocumentSnapshot, error)
}
func (m mockIterator) Next() (DocumentSnapshot, error) { return m.nextFunc() }
func (m mockIterator) GetAll() ([]DocumentSnapshot, error) { return m.getAllFunc() }

type mockQuery struct {
	limitFunc     func(n int) Query
	whereFunc     func(path, op string, value interface{}) Query
	documentsFunc func(ctx context.Context) DocumentIterator
}
func (q *mockQuery) Limit(n int) Query { return q.limitFunc(n) }
func (q *mockQuery) Where(path, op string, value interface{}) Query {
	return q.whereFunc(path, op, value)
}
func (q *mockQuery) Documents(ctx context.Context) DocumentIterator {
	return q.documentsFunc(ctx)
}

type mockBatch struct {
	deleteFunc func(dr DocumentRef) WriteBatch
	commitFunc func(ctx context.Context) ([]*firestore.WriteResult, error)
}
func (m mockBatch) Delete(dr DocumentRef) WriteBatch { return m.deleteFunc(dr) }
func (m mockBatch) Commit(ctx context.Context) ([]*firestore.WriteResult, error) {
	return m.commitFunc(ctx)
}
