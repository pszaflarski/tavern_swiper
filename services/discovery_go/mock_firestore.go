package main

import (
	"context"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
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

func (c *mockClient) Batch() firestoreutil.WriteBatch {
	return &mockBatch{}
}

func (c *mockClient) Pipeline() firestoreutil.Pipeline {
	return &mockPipeline{client: c}
}

func (c *mockClient) DeleteCollection(ctx context.Context, col firestoreutil.CollectionRef, batchSize int) error {
	return nil
}

type mockCollection struct {
	firestoreutil.CollectionRef
	path      string
	docs      map[string]*mockDoc
	queryRes  []*mockSnap
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

func (c *mockCollection) Where(path, op string, value interface{}) firestoreutil.Query {
	return &mockQuery{col: c}
}

func (c *mockCollection) Limit(n int) firestoreutil.Query {
	return &mockQuery{col: c}
}

func (c *mockCollection) OrderBy(path string, dir firestore.Direction) firestoreutil.Query {
	return &mockQuery{col: c}
}

func (c *mockCollection) Documents(ctx context.Context) firestoreutil.DocumentIterator {
	return &mockIter{snaps: c.queryRes}
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

func (d *mockDoc) Collection(path string) firestoreutil.CollectionRef {
	return &mockCollection{path: path}
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

type mockIter struct {
	firestoreutil.DocumentIterator
	snaps []*mockSnap
	index int
}

func (i *mockIter) Next() (firestoreutil.DocumentSnapshot, error) {
	if i.index >= len(i.snaps) {
		return nil, iterator.Done
	}
	s := i.snaps[i.index]
	i.index++
	return s, nil
}

func (i *mockIter) GetAll() ([]firestoreutil.DocumentSnapshot, error) {
	res := make([]firestoreutil.DocumentSnapshot, len(i.snaps))
	for j, s := range i.snaps {
		res[j] = s
	}
	return res, nil
}

func (i *mockIter) Stop() {}

type mockQuery struct {
	firestoreutil.Query
	col *mockCollection
}

func (q *mockQuery) Limit(n int) firestoreutil.Query { return q }
func (q *mockQuery) Where(path, op string, value interface{}) firestoreutil.Query { return q }
func (q *mockQuery) OrderBy(path string, dir firestore.Direction) firestoreutil.Query { return q }
func (q *mockQuery) Documents(ctx context.Context) firestoreutil.DocumentIterator {
	return q.col.Documents(ctx)
}

type mockBatch struct {
	firestoreutil.WriteBatch
}

func (b *mockBatch) Set(dr firestoreutil.DocumentRef, data interface{}, opts ...firestore.SetOption) firestoreutil.WriteBatch {
	dr.Set(context.Background(), data, opts...)
	return b
}
func (b *mockBatch) Delete(dr firestoreutil.DocumentRef) firestoreutil.WriteBatch {
	dr.Delete(context.Background())
	return b
}
func (b *mockBatch) Commit(ctx context.Context) ([]*firestore.WriteResult, error) {
	return []*firestore.WriteResult{}, nil
}

type mockPipeline struct {
	firestoreutil.Pipeline
	client *mockClient
	col    *mockCollection
}

func (p *mockPipeline) Collection(path string) firestoreutil.Pipeline {
	p.col = p.client.Collection(path).(*mockCollection)
	return p
}
func (p *mockPipeline) CollectionGroup(id string) firestoreutil.Pipeline { return p }
func (p *mockPipeline) Select(fields []any) firestoreutil.Pipeline       { return p }
func (p *mockPipeline) Where(filter any) firestoreutil.Pipeline          { return p }
func (p *mockPipeline) Limit(n int) firestoreutil.Pipeline               { return p }
func (p *mockPipeline) Execute(ctx context.Context) firestoreutil.PipelineSnapshot {
	return &mockPipelineSnapshot{col: p.col}
}

type mockPipelineSnapshot struct {
	firestoreutil.PipelineSnapshot
	col *mockCollection
}

func (s *mockPipelineSnapshot) Results() firestoreutil.PipelineIterator {
	if s.col == nil {
		return &mockPipelineIter{}
	}
	return &mockPipelineIter{snaps: s.col.queryRes}
}

type mockPipelineIter struct {
	firestoreutil.PipelineIterator
	snaps []*mockSnap
	index int
}

func (i *mockPipelineIter) Next() (firestoreutil.PipelineResult, error) {
	if i.index >= len(i.snaps) {
		return nil, iterator.Done
	}
	s := i.snaps[i.index]
	i.index++
	return &mockPipelineResult{data: s.data, ref: s.ref}, nil
}
func (i *mockPipelineIter) Stop() {}

type mockPipelineResult struct {
	firestoreutil.PipelineResult
	data map[string]interface{}
	ref  firestoreutil.DocumentRef
}

func (r *mockPipelineResult) Data() map[string]interface{} {
	return r.data
}

func (r *mockPipelineResult) Ref() firestoreutil.DocumentRef {
	return r.ref
}

// mockGetFeedCandidates creates a getFeedCandidatesFunc mock from a slice of mockSnaps.
// It applies the same exclusion logic the real pipeline does, so tests behave identically.
func mockGetFeedCandidates(candidateSnaps []*mockSnap) func(ctx context.Context, collection string, excludeIDs []string, limit int) ([]FeedCandidate, error) {
	return func(ctx context.Context, collection string, excludeIDs []string, limit int) ([]FeedCandidate, error) {
		excludeSet := make(map[string]bool)
		for _, id := range excludeIDs {
			excludeSet[id] = true
		}

		var result []FeedCandidate
		for _, snap := range candidateSnaps {
			if pID, ok := snap.data["profile_id"].(string); ok && excludeSet[pID] {
				continue
			}
			result = append(result, FeedCandidate{Data: snap.data})
			if len(result) >= limit {
				break
			}
		}
		return result, nil
	}
}
