package discovery_worker

import (
	"context"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
)

type MockClient struct {
	FirestoreClient
	Collections map[string]*MockCollection
	Batches     []*MockBatch
}

func (c *MockClient) Collection(path string) CollectionRef {
	if c.Collections == nil {
		c.Collections = make(map[string]*MockCollection)
	}
	if col, ok := c.Collections[path]; ok {
		return col
	}
	col := &MockCollection{Path: path, Docs: make(map[string]*MockDoc)}
	c.Collections[path] = col
	return col
}

func (c *MockClient) Batch() WriteBatch {
	b := &MockBatch{}
	c.Batches = append(c.Batches, b)
	return b
}

func (c *MockClient) Close() error {
	return nil
}

type MockBatch struct {
	WriteBatch
	Deletes []DocumentRef
	Commits int
}

func (b *MockBatch) Delete(dr DocumentRef) WriteBatch {
	b.Deletes = append(b.Deletes, dr)
	return b
}

func (b *MockBatch) Commit(ctx context.Context) ([]*firestore.WriteResult, error) {
	b.Commits++
	for _, dr := range b.Deletes {
		if md, ok := dr.(*MockDoc); ok {
			md.ExistsVal = false
			delete(md.Col.Docs, md.Id)
		}
	}
	return []*firestore.WriteResult{}, nil
}

type MockCollection struct {
	CollectionRef
	Path  string
	Docs  map[string]*MockDoc
	QueryVal *MockQuery
}

func (c *MockCollection) Doc(path string) DocumentRef {
	if c.Docs == nil {
		c.Docs = make(map[string]*MockDoc)
	}
	if d, ok := c.Docs[path]; ok {
		return d
	}
	d := &MockDoc{Id: path, DataVal: make(map[string]interface{}), ExistsVal: true, Col: c}
	c.Docs[path] = d
	return d
}

func (c *MockCollection) Where(path, op string, value interface{}) Query {
	if c.QueryVal == nil {
		c.QueryVal = &MockQuery{Col: c, Docs: make([]DocumentSnapshot, 0)}
	}
	return c.QueryVal.Where(path, op, value)
}

func (c *MockCollection) Limit(n int) Query {
	if c.QueryVal == nil {
		c.QueryVal = &MockQuery{Col: c, Docs: make([]DocumentSnapshot, 0)}
	}
	return c.QueryVal.Limit(n)
}

type MockQuery struct {
	Query
	Col    *MockCollection
	LimitVal  int
	Wheres []MockWhere
	Docs   []DocumentSnapshot // Explicitly injected docs for query results
}

type MockWhere struct {
	Path  string
	Op    string
	Value interface{}
}

func (q *MockQuery) Limit(n int) Query {
	q.LimitVal = n
	return q
}

func (q *MockQuery) Where(path, op string, value interface{}) Query {
	q.Wheres = append(q.Wheres, MockWhere{Path: path, Op: op, Value: value})
	return q
}

func (q *MockQuery) Documents(ctx context.Context) DocumentIterator {
	var matchedDocs []DocumentSnapshot
	
	// If custom query docs have been injected, use those
	if len(q.Docs) > 0 {
		matchedDocs = q.Docs
	} else {
		// Otherwise query current collection docs
		for _, doc := range q.Col.Docs {
			if !doc.ExistsVal {
				continue
			}
			matchedDocs = append(matchedDocs, &MockSnap{IdVal: doc.Id, DataValue: doc.DataVal, ExistsFlag: doc.ExistsVal, RefVal: doc})
		}
	}

	if q.LimitVal > 0 && len(matchedDocs) > q.LimitVal {
		matchedDocs = matchedDocs[:q.LimitVal]
	}
	return &MockIter{Docs: matchedDocs, Index: 0}
}

type MockIter struct {
	DocumentIterator
	Docs  []DocumentSnapshot
	Index int
}

func (i *MockIter) Next() (DocumentSnapshot, error) {
	if i.Index >= len(i.Docs) {
		return nil, iterator.Done
	}
	d := i.Docs[i.Index]
	i.Index++
	return d, nil
}

func (i *MockIter) GetAll() ([]DocumentSnapshot, error) {
	res := i.Docs[i.Index:]
	i.Index = len(i.Docs)
	return res, nil
}

func (i *MockIter) Stop() {}

type MockDoc struct {
	DocumentRef
	Id         string
	DataVal       map[string]interface{}
	ExistsVal     bool
	Col        *MockCollection
}

func (d *MockDoc) ID() string { return d.Id }

func (d *MockDoc) Get(ctx context.Context) (DocumentSnapshot, error) {
	return &MockSnap{IdVal: d.Id, DataValue: d.DataVal, ExistsFlag: d.ExistsVal, RefVal: d}, nil
}

func (d *MockDoc) Set(ctx context.Context, data interface{}, opts ...firestore.SetOption) (*firestore.WriteResult, error) {
	d.ExistsVal = true
	if m, ok := data.(map[string]interface{}); ok {
		d.DataVal = m
	}
	d.Col.Docs[d.Id] = d
	return &firestore.WriteResult{}, nil
}

func (d *MockDoc) Delete(ctx context.Context, opts ...firestore.Precondition) (*firestore.WriteResult, error) {
	d.ExistsVal = false
	delete(d.Col.Docs, d.Id)
	return &firestore.WriteResult{}, nil
}

type MockSnap struct {
	DocumentSnapshot
	IdVal     string
	DataValue   map[string]interface{}
	ExistsFlag bool
	RefVal    DocumentRef
}

func (s *MockSnap) Exists() bool                 { return s.ExistsFlag }
func (s *MockSnap) Data() map[string]interface{} { return s.DataValue }
func (s *MockSnap) ID() string                   { return s.IdVal }
func (s *MockSnap) Ref() DocumentRef             { return s.RefVal }
