package main

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestDocToProfileSafety(t *testing.T) {
	skipIfRealDB(t)
	fixedNow := time.Date(2026, 4, 17, 10, 5, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	doc := &mockSnap{
		id:     "p-missing",
		exists: true,
		data: map[string]interface{}{
			"user_id": "u1",
		},
	}

	p, err := docToProfile(doc)
	if err != nil {
		t.Errorf("docToProfile should not return error on missing fields, got %v", err)
	}

	if p.ProfileID != "p-missing" {
		t.Errorf("Expected ProfileID p-missing, got %s", p.ProfileID)
	}
}

func TestProfilesResilience_UploadImage(t *testing.T) {
	skipIfRealDB(t)
	jwtSecret = []byte("super-secret-tavern-key-123")
	fixedNow := time.Date(2026, 4, 17, 10, 5, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	mockPub := &mockPublisher{}
	r := setupTest(mockPub)

	uploadToGCS = func(ctx context.Context, profileID string, filename string, contentType string, data io.Reader) (string, error) {
		return "http://gcs.com/test.jpg", nil
	}

	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		mockP1 := &mockSnap{
			id:     "p1",
			exists: true,
			data:   map[string]interface{}{"user_id": "u1", "display_name": "Hero", "image_urls": []interface{}{}},
			ref:    &mockDoc{id: "p1", exists: true, data: map[string]interface{}{"user_id": "u1", "display_name": "Hero", "image_urls": []interface{}{}}},
		}
		return &mockClient{
			collections: map[string]*mockCollection{
				COLLECTION: {
					docs: map[string]*mockDoc{"p1": mockP1.ref.(*mockDoc)},
				},
			},
		}, nil
	}

	token := signGoTestTokenWithTimes("u1", "user", fixedNow, fixedNow.Add(30*time.Minute))
	imgData := createTestJPEG(1080, 1350)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, _ := writer.CreateFormFile("file", "test.jpg")
	part.Write(imgData)
	writer.Close()

	req, _ := http.NewRequest("POST", "/profiles/p1/image", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	// Admin auto-correction
	imgDataSmall := createTestJPEG(100, 100)
	body3 := &bytes.Buffer{}
	writer3 := multipart.NewWriter(body3)
	part3, _ := writer3.CreateFormFile("file", "small.jpg")
	part3.Write(imgDataSmall)
	writer3.Close()

	adminToken := signGoTestTokenWithTimes("admin1", "admin", fixedNow, fixedNow.Add(30*time.Minute))
	req3, _ := http.NewRequest("POST", "/profiles/p1/image", body3)
	req3.Header.Set("Content-Type", writer3.FormDataContentType())
	req3.Header.Set("Authorization", "Bearer "+adminToken)
	w3 := httptest.NewRecorder()
	r.ServeHTTP(w3, req3)

	if w3.Code != http.StatusOK {
		t.Errorf("Expected 200 for admin, got %d. Body: %s", w3.Code, w3.Body.String())
	}
}

func TestProfilesResilience_CreateProfileValidation(t *testing.T) {
	skipIfRealDB(t)
	jwtSecret = []byte("super-secret-tavern-key-123")
	fixedNow := time.Date(2026, 4, 17, 10, 5, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	mockPub := &mockPublisher{}
	r := setupTest(mockPub)
	token := signGoTestTokenWithTimes("u1", "user", fixedNow, fixedNow.Add(30*time.Minute))

	longBio := ""
	for i := 0; i < 16000; i++ {
		longBio += "A"
	}
	payload := map[string]interface{}{
		"display_name": "Test",
		"bio":          longBio,
	}
	jsonBody, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "/profiles/", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 for long bio, got %d", w.Code)
	}
}

func TestProfilesResilience_ActiveProfileFlow(t *testing.T) {
	skipIfRealDB(t)
	jwtSecret = []byte("super-secret-tavern-key-123")
	fixedNow := time.Date(2026, 4, 17, 10, 5, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	mockPub := &mockPublisher{}
	r := setupTest(mockPub)
	token := signGoTestTokenWithTimes("u1", "user", fixedNow, fixedNow.Add(30*time.Minute))

	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		mockP1 := &mockSnap{
			id:     "p1",
			exists: true,
			data:   map[string]interface{}{"user_id": "u1", "is_active": false, "display_name": "Hero"},
			ref:    &mockDoc{id: "p1", exists: true, data: map[string]interface{}{"user_id": "u1", "is_active": false, "display_name": "Hero"}},
		}

		return &manualMockClient{
			mockP1: mockP1,
		}, nil
	}

	req, _ := http.NewRequest("GET", "/profiles/user/me/active", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var res ProfileOut
	json.Unmarshal(w.Body.Bytes(), &res)
	if !res.IsActive {
		t.Errorf("Expected profile to be auto-activated")
	}
}

func TestListMyProfiles(t *testing.T) {
	skipIfRealDB(t)
	jwtSecret = []byte("super-secret-tavern-key-123")
	fixedNow := time.Date(2026, 4, 17, 10, 5, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	mockPub := &mockPublisher{}
	r := setupTest(mockPub)
	token := signGoTestTokenWithTimes("u1", "user", fixedNow, fixedNow.Add(30*time.Minute))

	p1 := &mockSnap{
		id:     "p1",
		exists: true,
		data:   map[string]interface{}{"user_id": "u1", "display_name": "Hero One", "is_active": true, "image_urls": []interface{}{}},
		ref:    &mockDoc{id: "p1", exists: true, data: map[string]interface{}{"user_id": "u1", "display_name": "Hero One", "is_active": true}},
	}
	p2 := &mockSnap{
		id:     "p2",
		exists: true,
		data:   map[string]interface{}{"user_id": "u1", "display_name": "Hero Two", "is_active": false, "image_urls": []interface{}{}},
		ref:    &mockDoc{id: "p2", exists: true, data: map[string]interface{}{"user_id": "u1", "display_name": "Hero Two", "is_active": false}},
	}

	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &mockClient{
			collections: map[string]*mockCollection{
				COLLECTION: {
					queryRes: []*mockSnap{p1, p2},
				},
			},
		}, nil
	}

	req, _ := http.NewRequest("GET", "/profiles/user/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var profiles []ProfileOut
	json.Unmarshal(w.Body.Bytes(), &profiles)

	if len(profiles) != 2 {
		t.Fatalf("Expected 2 profiles, got %d", len(profiles))
	}

	if profiles[0].DisplayName != "Hero One" {
		t.Errorf("Expected first profile 'Hero One', got '%s'", profiles[0].DisplayName)
	}
	if profiles[1].DisplayName != "Hero Two" {
		t.Errorf("Expected second profile 'Hero Two', got '%s'", profiles[1].DisplayName)
	}
}

type manualMockClient struct {
	FirestoreClient
	mockP1 *mockSnap
}

func (m *manualMockClient) Collection(path string) CollectionRef {
	return &manualMockCol{mockP1: m.mockP1}
}

type manualMockCol struct {
	CollectionRef
	mockP1        *mockSnap
	isActiveQuery bool
}

func (m *manualMockCol) Where(path, op string, value interface{}) Query {
	if path == "is_active" && value == true {
		return &manualMockCol{mockP1: m.mockP1, isActiveQuery: true}
	}
	return &manualMockCol{mockP1: m.mockP1, isActiveQuery: false}
}

func (m *manualMockCol) Limit(n int) Query { return m }

func (m *manualMockCol) Documents(ctx context.Context) DocumentIterator {
	if m.isActiveQuery {
		return &mockIter{snaps: []*mockSnap{}}
	}
	return &mockIter{snaps: []*mockSnap{m.mockP1}}
}

func createTestJPEG(w, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{uint8(x % 256), uint8(y % 256), 0, 255})
		}
	}
	var buf bytes.Buffer
	jpeg.Encode(&buf, img, nil)
	return buf.Bytes()
}

func TestListProfilesForUser_Authorization(t *testing.T) {
	skipIfRealDB(t)
	jwtSecret = []byte("super-secret-tavern-key-123")
	fixedNow := time.Date(2026, 4, 17, 10, 5, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	mockPub := &mockPublisher{}
	r := setupTest(mockPub)

	// Mock DB
	getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
		return &mockClient{
			collections: map[string]*mockCollection{
				COLLECTION: {
					queryRes: []*mockSnap{
						{
							id:     "p1",
							exists: true,
							data:   map[string]interface{}{"user_id": "u1", "display_name": "User One"},
							ref:    &mockDoc{id: "p1"},
						},
					},
				},
			},
		}, nil
	}

	// 1. Success: User accessing own profiles
	tokenOwner := signGoTestTokenWithTimes("u1", "user", fixedNow, fixedNow.Add(30*time.Minute))
	req1, _ := http.NewRequest("GET", "/profiles/user/u1", nil)
	req1.Header.Set("Authorization", "Bearer "+tokenOwner)
	w1 := httptest.NewRecorder()
	r.ServeHTTP(w1, req1)
	if w1.Code != http.StatusOK {
		t.Errorf("Expected 200 for owner, got %d", w1.Code)
	}

	// 2. Failure: User accessing others' profiles
	tokenOther := signGoTestTokenWithTimes("u2", "user", fixedNow, fixedNow.Add(30*time.Minute))
	req2, _ := http.NewRequest("GET", "/profiles/user/u1", nil)
	req2.Header.Set("Authorization", "Bearer "+tokenOther)
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusForbidden {
		t.Errorf("Expected 403 for unauthorized access, got %d", w2.Code)
	}

	// 3. Success: Admin accessing others' profiles
	tokenAdmin := signGoTestTokenWithTimes("admin1", "admin", fixedNow, fixedNow.Add(30*time.Minute))
	req3, _ := http.NewRequest("GET", "/profiles/user/u1", nil)
	req3.Header.Set("Authorization", "Bearer "+tokenAdmin)
	w3 := httptest.NewRecorder()
	r.ServeHTTP(w3, req3)
	if w3.Code != http.StatusOK {
		t.Errorf("Expected 200 for admin, got %d", w3.Code)
	}
}
