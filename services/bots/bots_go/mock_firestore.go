package main

import (
	"context"

	"cloud.google.com/go/firestore"
)

// Mock Types
type mockClient struct {
	FirestoreClient
	collectionFunc func(path string) FirestoreCollection
	batchFunc      func() FirestoreWriteBatch
	deleteFunc     func(ctx context.Context, col FirestoreCollection, batchSize int) error
}

func (m *mockClient) Collection(path string) FirestoreCollection {
	return m.collectionFunc(path)
}
func (m *mockClient) Batch() FirestoreWriteBatch { return m.batchFunc() }
func (m *mockClient) DeleteCollection(ctx context.Context, col FirestoreCollection, batchSize int) error {
	if m.deleteFunc != nil {
		return m.deleteFunc(ctx, col, batchSize)
	}
	return nil
}
func (m *mockClient) Close() error { return nil }

type mockCollection struct {
	FirestoreCollection
	docFunc       func(path string) FirestoreDocument
	whereFunc     func(path, op string, value interface{}) FirestoreQuery
	documentsFunc func(ctx context.Context) FirestoreDocumentIterator
}

func (m mockCollection) Doc(path string) FirestoreDocument { return m.docFunc(path) }
func (m mockCollection) Where(path, op string, value interface{}) FirestoreQuery {
	if m.whereFunc != nil {
		return m.whereFunc(path, op, value)
	}
	return &mockQuery{documentsFunc: m.documentsFunc}
}
func (m mockCollection) Documents(ctx context.Context) FirestoreDocumentIterator {
	if m.documentsFunc != nil {
		return m.documentsFunc(ctx)
	}
	return &mockIterator{}
}

type mockDoc struct {
	FirestoreDocument
	id         string
	getFunc    func(ctx context.Context) (FirestoreDocumentSnapshot, error)
	setFunc    func(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error)
	updateFunc func(ctx context.Context, updates []firestore.Update, preconds ...firestore.Precondition) (*firestore.WriteResult, error)
	deleteFunc func(ctx context.Context, preconds ...firestore.Precondition) (*firestore.WriteResult, error)
}

func (m mockDoc) Get(ctx context.Context) (FirestoreDocumentSnapshot, error) { return m.getFunc(ctx) }
func (m mockDoc) Set(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
	return m.setFunc(ctx, data, opts...)
}
func (m mockDoc) Update(ctx context.Context, updates []firestore.Update, preconds ...firestore.Precondition) (*firestore.WriteResult, error) {
	return m.updateFunc(ctx, updates, preconds...)
}
func (m mockDoc) Delete(ctx context.Context, preconds ...firestore.Precondition) (*firestore.WriteResult, error) {
	return m.deleteFunc(ctx, preconds...)
}
func (m mockDoc) Ref() *firestore.DocumentRef { return &firestore.DocumentRef{ID: m.id} }

type mockSnapshot struct {
	FirestoreDocumentSnapshot
	exists bool
	data   map[string]interface{}
	id     string
}

func (m mockSnapshot) Exists() bool                          { return m.exists }
func (m mockSnapshot) Data() map[string]interface{}          { return m.data }
func (m mockSnapshot) ID() string                            { return m.id }
func (m mockSnapshot) Ref() *firestore.DocumentRef           { return &firestore.DocumentRef{ID: m.id} }

type mockIterator struct {
	FirestoreDocumentIterator
	nextFunc   func() (FirestoreDocumentSnapshot, error)
	getAllFunc func() ([]FirestoreDocumentSnapshot, error)
}

func (m mockIterator) Next() (FirestoreDocumentSnapshot, error) {
	if m.nextFunc != nil {
		return m.nextFunc()
	}
	return nil, nil
}
func (m mockIterator) GetAll() ([]FirestoreDocumentSnapshot, error) {
	if m.getAllFunc != nil {
		return m.getAllFunc()
	}
	return []FirestoreDocumentSnapshot{}, nil
}

type mockQuery struct {
	FirestoreQuery
	limitFunc     func(n int) FirestoreQuery
	whereFunc     func(path, op string, value interface{}) FirestoreQuery
	documentsFunc func(ctx context.Context) FirestoreDocumentIterator
}

func (q *mockQuery) Limit(n int) FirestoreQuery {
	if q.limitFunc != nil {
		return q.limitFunc(n)
	}
	return q
}
func (q *mockQuery) Where(path, op string, value interface{}) FirestoreQuery {
	if q.whereFunc != nil {
		return q.whereFunc(path, op, value)
	}
	return q
}
func (q *mockQuery) Documents(ctx context.Context) FirestoreDocumentIterator {
	if q.documentsFunc != nil {
		return q.documentsFunc(ctx)
	}
	return &mockIterator{}
}

type mockBatch struct {
	FirestoreWriteBatch
	setFunc    func(doc FirestoreDocument, data interface{}, opts ...firestore.SetOption) FirestoreWriteBatch
	updateFunc func(doc FirestoreDocument, updates []firestore.Update) FirestoreWriteBatch
	deleteFunc func(doc FirestoreDocument, preconds ...firestore.Precondition) FirestoreWriteBatch
	commitFunc func(ctx context.Context) ([]*firestore.WriteResult, error)
}

func (m mockBatch) Set(doc FirestoreDocument, data interface{}, opts ...firestore.SetOption) FirestoreWriteBatch {
	if m.setFunc != nil {
		return m.setFunc(doc, data, opts...)
	}
	return m
}
func (m mockBatch) Update(doc FirestoreDocument, updates []firestore.Update) FirestoreWriteBatch {
	if m.updateFunc != nil {
		return m.updateFunc(doc, updates)
	}
	return m
}
func (m mockBatch) Delete(doc FirestoreDocument, preconds ...firestore.Precondition) FirestoreWriteBatch {
	if m.deleteFunc != nil {
		return m.deleteFunc(doc, preconds...)
	}
	return m
}
func (m mockBatch) Commit(ctx context.Context) ([]*firestore.WriteResult, error) {
	if m.commitFunc != nil {
		return m.commitFunc(ctx)
	}
	return nil, nil
}
