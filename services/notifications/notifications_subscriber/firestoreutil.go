package main

import (
	"context"

	"cloud.google.com/go/firestore"
)

// FirestoreClient defines the subset of firestore methods used for persistence
type FirestoreClient interface {
	Collection(path string) CollectionRef
	CollectionGroup(id string) Query
	Batch() WriteBatch
	GetAll(ctx context.Context, docRefs []DocumentRef) ([]DocumentSnapshot, error)
	Pipeline() Pipeline
	DeleteCollection(ctx context.Context, col CollectionRef, batchSize int) error
	Close() error
}

type CollectionRef interface {
	Query
	Doc(path string) DocumentRef
}

type DocumentRef interface {
	ID() string
	Get(ctx context.Context) (DocumentSnapshot, error)
	Set(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error)
	Update(ctx context.Context, updates []firestore.Update, opts ...firestore.Precondition) (*firestore.WriteResult, error)
	Delete(ctx context.Context, opts ...firestore.Precondition) (*firestore.WriteResult, error)
	Collection(path string) CollectionRef
}

type DocumentSnapshot interface {
	Exists() bool
	Data() map[string]interface{}
	ID() string
	Ref() DocumentRef
}

type DocumentIterator interface {
	Next() (DocumentSnapshot, error)
	GetAll() ([]DocumentSnapshot, error)
	Stop()
}

type Query interface {
	Limit(n int) Query
	Where(path, op string, value interface{}) Query
	OrderBy(path string, dir firestore.Direction) Query
	Documents(ctx context.Context) DocumentIterator
}

type WriteBatch interface {
	Set(dr DocumentRef, data interface{}, opts ...firestore.SetOption) WriteBatch
	Update(dr DocumentRef, updates []firestore.Update, opts ...firestore.Precondition) WriteBatch
	Delete(dr DocumentRef) WriteBatch
	Commit(ctx context.Context) ([]*firestore.WriteResult, error)
}

// Pipeline and related types for Enterprise Edition
type Pipeline interface {
	Collection(path string) Pipeline
	CollectionGroup(id string) Pipeline
	Select(fields []any) Pipeline
	Where(filter any) Pipeline
	Limit(n int) Pipeline
	Execute(ctx context.Context) PipelineSnapshot
}

type PipelineSnapshot interface {
	Results() PipelineIterator
}

type PipelineIterator interface {
	Next() (PipelineResult, error)
	Stop()
}

type PipelineResult interface {
	Data() map[string]interface{}
	Ref() DocumentRef
}

// realClient wraps *firestore.Client
type realClient struct {
	*firestore.Client
}

func newFirestoreClient(ctx context.Context, projectID, databaseID string) (FirestoreClient, error) {
	client, err := firestore.NewClientWithDatabase(ctx, projectID, databaseID)
	if err != nil {
		return nil, err
	}
	return &realClient{client}, nil
}

func (c *realClient) Collection(path string) CollectionRef {
	return &realCollection{c.Client.Collection(path)}
}

func (c *realClient) CollectionGroup(id string) Query {
	return &realQuery{c.Client.CollectionGroup(id).Query}
}

func (c *realClient) Batch() WriteBatch {
	return &realBatch{c.Client.Batch()}
}

func (c *realClient) GetAll(ctx context.Context, docRefs []DocumentRef) ([]DocumentSnapshot, error) {
	refs := make([]*firestore.DocumentRef, len(docRefs))
	for i, dr := range docRefs {
		refs[i] = dr.(*realDoc).DocumentRef
	}
	snaps, err := c.Client.GetAll(ctx, refs)
	if err != nil {
		return nil, err
	}
	res := make([]DocumentSnapshot, len(snaps))
	for i, s := range snaps {
		res[i] = &realSnap{s}
	}
	return res, nil
}

func (c *realClient) Pipeline() Pipeline {
	return &realPipelineSource{c.Client.Pipeline()}
}

func (c *realClient) DeleteCollection(ctx context.Context, col CollectionRef, batchSize int) error {
	for {
		iter := col.Limit(batchSize).Documents(ctx)
		docs, err := iter.GetAll()
		if err != nil {
			return err
		}
		if len(docs) == 0 {
			break
		}

		batch := c.Batch()
		for _, d := range docs {
			batch.Delete(d.Ref())
		}
		if _, err := batch.Commit(ctx); err != nil {
			return err
		}
	}
	return nil
}

func (c *realClient) Close() error {
	return c.Client.Close()
}

type realCollection struct {
	*firestore.CollectionRef
}

func (c *realCollection) Doc(path string) DocumentRef {
	return &realDoc{c.CollectionRef.Doc(path)}
}

func (c *realCollection) Where(path, op string, value interface{}) Query {
	return &realQuery{c.CollectionRef.Where(path, op, value)}
}

func (c *realCollection) Limit(n int) Query {
	return &realQuery{c.CollectionRef.Limit(n)}
}

func (c *realCollection) OrderBy(path string, dir firestore.Direction) Query {
	return &realQuery{c.CollectionRef.OrderBy(path, dir)}
}

func (c *realCollection) Documents(ctx context.Context) DocumentIterator {
	return &realIter{c.CollectionRef.Documents(ctx)}
}

type realDoc struct {
	*firestore.DocumentRef
}

func (d *realDoc) ID() string {
	return d.DocumentRef.ID
}

func (d *realDoc) Get(ctx context.Context) (DocumentSnapshot, error) {
	s, err := d.DocumentRef.Get(ctx)
	if err != nil {
		return nil, err
	}
	return &realSnap{s}, nil
}

func (d *realDoc) Set(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
	return d.DocumentRef.Set(ctx, data, opts...)
}

func (d *realDoc) Update(ctx context.Context, updates []firestore.Update, opts ...firestore.Precondition) (*firestore.WriteResult, error) {
	return d.DocumentRef.Update(ctx, updates, opts...)
}

func (d *realDoc) Delete(ctx context.Context, opts ...firestore.Precondition) (*firestore.WriteResult, error) {
	return d.DocumentRef.Delete(ctx, opts...)
}

func (d *realDoc) Collection(path string) CollectionRef {
	return &realCollection{d.DocumentRef.Collection(path)}
}

type realSnap struct {
	*firestore.DocumentSnapshot
}

func (s *realSnap) Exists() bool {
	return s.DocumentSnapshot.Exists()
}

func (s *realSnap) Data() map[string]interface{} {
	return s.DocumentSnapshot.Data()
}

func (s *realSnap) ID() string {
	return s.DocumentSnapshot.Ref.ID
}

func (s *realSnap) Ref() DocumentRef {
	return &realDoc{s.DocumentSnapshot.Ref}
}

type realIter struct {
	*firestore.DocumentIterator
}

func (i *realIter) Next() (DocumentSnapshot, error) {
	s, err := i.DocumentIterator.Next()
	if err != nil {
		return nil, err
	}
	return &realSnap{s}, nil
}

func (i *realIter) GetAll() ([]DocumentSnapshot, error) {
	snaps, err := i.DocumentIterator.GetAll()
	if err != nil {
		return nil, err
	}
	res := make([]DocumentSnapshot, len(snaps))
	for j, s := range snaps {
		res[j] = &realSnap{s}
	}
	return res, nil
}

func (i *realIter) Stop() {
	i.DocumentIterator.Stop()
}

type realQuery struct {
	firestore.Query
}

func (q *realQuery) Limit(n int) Query {
	return &realQuery{q.Query.Limit(n)}
}

func (q *realQuery) Where(path, op string, value interface{}) Query {
	return &realQuery{q.Query.Where(path, op, value)}
}

func (q *realQuery) OrderBy(path string, dir firestore.Direction) Query {
	return &realQuery{q.Query.OrderBy(path, dir)}
}

func (q *realQuery) Documents(ctx context.Context) DocumentIterator {
	return &realIter{q.Query.Documents(ctx)}
}

type realBatch struct {
	*firestore.WriteBatch
}

func (b *realBatch) Set(dr DocumentRef, data interface{}, opts ...firestore.SetOption) WriteBatch {
	b.WriteBatch.Set(dr.(*realDoc).DocumentRef, data, opts...)
	return b
}

func (b *realBatch) Update(dr DocumentRef, updates []firestore.Update, opts ...firestore.Precondition) WriteBatch {
	b.WriteBatch.Update(dr.(*realDoc).DocumentRef, updates, opts...)
	return b
}

func (b *realBatch) Delete(dr DocumentRef) WriteBatch {
	b.WriteBatch.Delete(dr.(*realDoc).DocumentRef)
	return b
}

func (b *realBatch) Commit(ctx context.Context) ([]*firestore.WriteResult, error) {
	return b.WriteBatch.Commit(ctx)
}

type realPipelineSource struct {
	*firestore.PipelineSource
}

func (ps *realPipelineSource) Collection(path string) Pipeline {
	return &realPipeline{ps.PipelineSource.Collection(path)}
}

func (ps *realPipelineSource) CollectionGroup(id string) Pipeline {
	return &realPipeline{ps.PipelineSource.CollectionGroup(id)}
}

func (ps *realPipelineSource) Select(fields []any) Pipeline { return nil }
func (ps *realPipelineSource) Where(filter any) Pipeline    { return nil }
func (ps *realPipelineSource) Limit(n int) Pipeline         { return nil }
func (ps *realPipelineSource) Execute(ctx context.Context) PipelineSnapshot { return nil }

type realPipeline struct {
	*firestore.Pipeline
}

func (p *realPipeline) Collection(path string) Pipeline    { return nil }
func (p *realPipeline) CollectionGroup(id string) Pipeline { return nil }

func (p *realPipeline) Select(fields []any) Pipeline {
	return &realPipeline{p.Pipeline.Select(fields)}
}

func (p *realPipeline) Where(filter any) Pipeline {
	return &realPipeline{p.Pipeline.Where(filter.(firestore.BooleanExpression))}
}

func (p *realPipeline) Limit(n int) Pipeline {
	return &realPipeline{p.Pipeline.Limit(n)}
}

func (p *realPipeline) Execute(ctx context.Context) PipelineSnapshot {
	return &realPipelineSnapshot{p.Pipeline.Execute(ctx)}
}

type realPipelineSnapshot struct {
	*firestore.PipelineSnapshot
}

func (s *realPipelineSnapshot) Results() PipelineIterator {
	return &realPipelineIter{s.PipelineSnapshot.Results()}
}

type realPipelineIter struct {
	*firestore.PipelineResultIterator
}

func (i *realPipelineIter) Next() (PipelineResult, error) {
	res, err := i.PipelineResultIterator.Next()
	if err != nil {
		return nil, err
	}
	return &realPipelineResult{res}, nil
}

func (i *realPipelineIter) Stop() {
	i.PipelineResultIterator.Stop()
}

type realPipelineResult struct {
	*firestore.PipelineResult
}

func (r *realPipelineResult) Data() map[string]interface{} {
	return r.PipelineResult.Data()
}

func (r *realPipelineResult) Ref() DocumentRef {
	return &realDoc{r.PipelineResult.Ref()}
}
