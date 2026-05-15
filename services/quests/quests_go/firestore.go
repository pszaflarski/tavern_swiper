package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"cloud.google.com/go/firestore"
)

// FirestoreClient is an interface to allow mocking Firestore in unit tests.
type FirestoreClient interface {
	Collection(path string) FirestoreCollection
	Batch() FirestoreWriteBatch
	Close() error
}

type FirestoreCollection interface {
	Doc(id string) FirestoreDocument
	Documents(ctx context.Context) FirestoreDocumentIterator
	Where(path, op string, value interface{}) FirestoreQuery
}

type FirestoreDocument interface {
	Get(ctx context.Context) (FirestoreDocumentSnapshot, error)
	Set(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error)
	Update(ctx context.Context, updates []firestore.Update, preconds ...firestore.Precondition) (*firestore.WriteResult, error)
	Delete(ctx context.Context, preconds ...firestore.Precondition) (*firestore.WriteResult, error)
	Ref() *firestore.DocumentRef
}

type FirestoreDocumentSnapshot interface {
	Data() map[string]interface{}
	Exists() bool
	ID() string
	Ref() *firestore.DocumentRef
}

type FirestoreDocumentIterator interface {
	Next() (FirestoreDocumentSnapshot, error)
	GetAll() ([]FirestoreDocumentSnapshot, error)
}

type FirestoreQuery interface {
	Documents(ctx context.Context) FirestoreDocumentIterator
	Where(path, op string, value interface{}) FirestoreQuery
	Limit(n int) FirestoreQuery
}

type FirestoreWriteBatch interface {
	Set(doc FirestoreDocument, data interface{}, opts ...firestore.SetOption) FirestoreWriteBatch
	Update(doc FirestoreDocument, updates []firestore.Update) FirestoreWriteBatch
	Delete(doc FirestoreDocument, preconds ...firestore.Precondition) FirestoreWriteBatch
	Commit(ctx context.Context) ([]*firestore.WriteResult, error)
}

// -----------------------------------------------------------------------------
// Real Implementation
// -----------------------------------------------------------------------------

type RealFirestoreClient struct {
	client *firestore.Client
}

func (r *RealFirestoreClient) Collection(path string) FirestoreCollection {
	return &RealFirestoreCollection{coll: r.client.Collection(path)}
}

func (r *RealFirestoreClient) Batch() FirestoreWriteBatch {
	return &RealFirestoreWriteBatch{batch: r.client.Batch()}
}

func (r *RealFirestoreClient) Close() error {
	return r.client.Close()
}

type RealFirestoreCollection struct {
	coll *firestore.CollectionRef
}

func (c *RealFirestoreCollection) Doc(id string) FirestoreDocument {
	return &RealFirestoreDocument{doc: c.coll.Doc(id)}
}

func (c *RealFirestoreCollection) Documents(ctx context.Context) FirestoreDocumentIterator {
	return &RealFirestoreDocumentIterator{iter: c.coll.Documents(ctx)}
}

func (c *RealFirestoreCollection) Where(path, op string, value interface{}) FirestoreQuery {
	return &RealFirestoreQuery{q: c.coll.Where(path, op, value)}
}

type RealFirestoreDocument struct {
	doc *firestore.DocumentRef
}

func (d *RealFirestoreDocument) Get(ctx context.Context) (FirestoreDocumentSnapshot, error) {
	snap, err := d.doc.Get(ctx)
	if err != nil {
		return nil, err
	}
	return &RealFirestoreDocumentSnapshot{snap: snap}, nil
}

func (d *RealFirestoreDocument) Set(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
	return d.doc.Set(ctx, data, opts...)
}

func (d *RealFirestoreDocument) Update(ctx context.Context, updates []firestore.Update, preconds ...firestore.Precondition) (*firestore.WriteResult, error) {
	return d.doc.Update(ctx, updates, preconds...)
}

func (d *RealFirestoreDocument) Delete(ctx context.Context, preconds ...firestore.Precondition) (*firestore.WriteResult, error) {
	return d.doc.Delete(ctx, preconds...)
}

func (d *RealFirestoreDocument) Ref() *firestore.DocumentRef {
	return d.doc
}

type RealFirestoreDocumentSnapshot struct {
	snap *firestore.DocumentSnapshot
}

func (s *RealFirestoreDocumentSnapshot) Data() map[string]interface{} {
	return s.snap.Data()
}

func (s *RealFirestoreDocumentSnapshot) Exists() bool {
	return s.snap.Exists()
}

func (s *RealFirestoreDocumentSnapshot) ID() string {
	return s.snap.Ref.ID
}

func (s *RealFirestoreDocumentSnapshot) Ref() *firestore.DocumentRef {
	return s.snap.Ref
}

type RealFirestoreDocumentIterator struct {
	iter *firestore.DocumentIterator
}

func (i *RealFirestoreDocumentIterator) Next() (FirestoreDocumentSnapshot, error) {
	snap, err := i.iter.Next()
	if err != nil {
		return nil, err
	}
	return &RealFirestoreDocumentSnapshot{snap: snap}, nil
}

func (i *RealFirestoreDocumentIterator) GetAll() ([]FirestoreDocumentSnapshot, error) {
	snaps, err := i.iter.GetAll()
	if err != nil {
		return nil, err
	}
	var res []FirestoreDocumentSnapshot
	for _, snap := range snaps {
		res = append(res, &RealFirestoreDocumentSnapshot{snap: snap})
	}
	return res, nil
}

type RealFirestoreQuery struct {
	q firestore.Query
}

func (q *RealFirestoreQuery) Documents(ctx context.Context) FirestoreDocumentIterator {
	return &RealFirestoreDocumentIterator{iter: q.q.Documents(ctx)}
}

func (q *RealFirestoreQuery) Where(path, op string, value interface{}) FirestoreQuery {
	return &RealFirestoreQuery{q: q.q.Where(path, op, value)}
}

func (q *RealFirestoreQuery) Limit(n int) FirestoreQuery {
	return &RealFirestoreQuery{q: q.q.Limit(n)}
}

type RealFirestoreWriteBatch struct {
	batch *firestore.WriteBatch
}

func (b *RealFirestoreWriteBatch) Set(doc FirestoreDocument, data interface{}, opts ...firestore.SetOption) FirestoreWriteBatch {
	b.batch.Set(doc.(*RealFirestoreDocument).doc, data, opts...)
	return b
}

func (b *RealFirestoreWriteBatch) Update(doc FirestoreDocument, updates []firestore.Update) FirestoreWriteBatch {
	b.batch.Update(doc.(*RealFirestoreDocument).doc, updates)
	return b
}

func (b *RealFirestoreWriteBatch) Delete(doc FirestoreDocument, preconds ...firestore.Precondition) FirestoreWriteBatch {
	b.batch.Delete(doc.(*RealFirestoreDocument).doc, preconds...)
	return b
}

func (b *RealFirestoreWriteBatch) Commit(ctx context.Context) ([]*firestore.WriteResult, error) {
	return b.batch.Commit(ctx)
}

// -----------------------------------------------------------------------------
// Initialization
// -----------------------------------------------------------------------------

var _realDB FirestoreClient

var getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
	if _realDB != nil {
		return _realDB, nil
	}

	projectID := getEnv("GOOGLE_CLOUD_PROJECT", "tavern-swiper-dev")
	dbID := getEnv("FIRESTORE_DATABASE_ID", "quests-dev")
	if os.Getenv("FIRESTORE_EMULATOR_HOST") != "" {
		log.Printf("[INFO] Connecting to Firestore Emulator at %s for DB: %s", os.Getenv("FIRESTORE_EMULATOR_HOST"), dbID)
	}

	client, err := firestore.NewClientWithDatabase(ctx, projectID, dbID)
	if err != nil {
		return nil, fmt.Errorf("failed to create client: %v", err)
	}

	_realDB = &RealFirestoreClient{client: client}
	return _realDB, nil
}
