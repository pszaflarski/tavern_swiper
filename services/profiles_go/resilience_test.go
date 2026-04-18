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

	"github.com/golang-jwt/jwt/v5"
)

func localSignToken(uid, role string, now time.Time) string {
	claims := jwt.MapClaims{
		"sub":  uid,
		"role": role,
		"iat":  now.Unix(),
		"exp":  now.Add(30 * time.Minute).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := token.SignedString(jwtSecret)
	return s
}

func TestDocToProfileSafety(t *testing.T) {
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

	token := localSignToken("u1", "user", fixedNow)
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

	adminToken := localSignToken("admin1", "admin", fixedNow)
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
	jwtSecret = []byte("super-secret-tavern-key-123")
	fixedNow := time.Date(2026, 4, 17, 10, 5, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	mockPub := &mockPublisher{}
	r := setupTest(mockPub)
	token := localSignToken("u1", "user", fixedNow)

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
	jwtSecret = []byte("super-secret-tavern-key-123")
	fixedNow := time.Date(2026, 4, 17, 10, 5, 0, 0, time.UTC)
	oldNow := _now
	_now = func() time.Time { return fixedNow }
	defer func() { _now = oldNow }()

	mockPub := &mockPublisher{}
	r := setupTest(mockPub)
	token := localSignToken("u1", "user", fixedNow)

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

type manualMockClient struct {
	FirestoreClient
	mockP1 *mockSnap
}

func (m *manualMockClient) Collection(path string) CollectionRef {
	return &manualMockCol{mockP1: m.mockP1}
}

type manualMockCol struct {
	CollectionRef
	mockP1 *mockSnap
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
