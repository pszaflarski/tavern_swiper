# Go Microservice Coding Standards

> **All Go services in Tavern Swiper MUST follow these standards.**
> Use `profiles_go` as the canonical reference implementation.

---

## 📁 Required File Structure

Every Go service container MUST include:

| File | Purpose |
|---|---|
| `main.go` | Entry point: CORS, Swagger UI route, auth middleware, route groups, server start |
| `handlers.go` | HTTP handlers with Swagger godoc annotations |
| `models.go` | Request/response structs with `json:"..."` and `firestore:"..."` tags |
| `auth.go` | JWT auth middleware (duplicated per service — no shared libs) |
| `errors.go` | Standardized error response helpers (`send400`, `send403`, `send404`, `send500`, `send503`) |
| `firestore.go` | Firestore client initialization with `getDBFunc` pattern |
| `firestoreutil.go` | Firestore interface abstractions for testability |
| `mock_firestore.go` | Mock implementations for unit tests |
| `handlers_test.go` | Unit tests using `httptest` and `gin.TestMode` |
| `docs/` | Generated Swagger docs (via `swag init`) |
| `Dockerfile` | Multi-stage Alpine build |
| `cloudbuild.yaml` | Cloud Build pipeline (test → build → push → deploy) |
| `.env` | Local development environment variables |
| `.dockerignore` | Excludes test files and non-essential artifacts from Docker builds |
| `go.mod` / `go.sum` | Module dependencies |

---

## 📝 Swagger Documentation

### main.go Header Annotations
```go
// @title           Service Name API
// @version         1.0
// @description     Brief description of what this service does.
// @BasePath        /service-prefix
// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
package main
```

### main.go Imports & Route Registration
```go
import (
    _ "module_name/docs"              // Generated swagger docs
    swaggerFiles "github.com/swaggo/files"
    ginSwagger "github.com/swaggo/gin-swagger"
)

// Swagger UI route MUST be registered BEFORE AuthMiddleware
r.GET("/service-prefix/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))
r.Use(AuthMiddleware())
```

### Handler Annotations
Every handler MUST have godoc annotations:
```go
// handlerName godoc
// @Summary      Brief summary
// @Description  Detailed description
// @Tags         tag-group
// @Accept       json        // if accepting body
// @Produce      json
// @Param        id   path   string  true  "Parameter description"
// @Param        body body   Model   true  "Body description"
// @Success      200  {object}  ResponseModel
// @Failure      400  {object}  map[string]string
// @Security     BearerAuth  // if auth required
// @Router       /path [method]
```

### Generating Docs
```bash
cd services/<boundary>/<container>
go install github.com/swaggo/swag/cmd/swag@latest
swag init
```

---

## 🛡️ Auth Middleware Pattern

- Each service has its own `auth.go` — **never share across services**.
- Public routes (health, swagger, service-specific public endpoints) bypass auth.
- Auth extracts JWT claims into an `AuthData` struct stored in Gin context.
- Helper functions: `GetAuth(c)` to retrieve, `IsAdmin(role)` to check.

```go
func AuthMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        path := c.Request.URL.Path
        method := c.Request.Method

        isPublic := path == "/service/health" || 
            strings.HasPrefix(path, "/service/swagger")

        if isPublic {
            c.Next()
            return
        }
        // ... JWT validation ...
    }
}
```

---

## ❌ Error Response Helpers

All services MUST use standardized helpers from `errors.go`:

```go
func send400(c *gin.Context, msg string) {
    log.Printf("[ERROR] HTTP 400: %s", msg)
    c.JSON(http.StatusBadRequest, ErrorResponse{Detail: msg})
}

func send403(c *gin.Context, msg string) { /* ... */ }
func send404(c *gin.Context, msg string) { /* ... */ }
func send500(c *gin.Context, msg string) { /* ... */ }
func send503(c *gin.Context, msg string) { /* ... */ }
```

**DO NOT** use raw `c.JSON(http.StatusForbidden, gin.H{"detail": "..."})` in handlers.

---

## 🧪 Testing Patterns

### Unit Test Setup
```go
func setupTest() (*gin.Engine, *mockClient) {
    gin.SetMode(gin.TestMode)
    r := gin.Default()
    mockDB := &mockClient{collections: make(map[string]*mockCollection)}
    getDBFunc = func(ctx context.Context) (FirestoreClient, error) {
        return mockDB, nil
    }
    r.Use(AuthMiddleware())
    // ... register routes ...
    return r, mockDB
}
```

### JWT Signing for Tests
```go
func signToken(uid, role string) string {
    claims := jwt.MapClaims{
        "sub":  uid,
        "role": role,
        "iat":  time.Now().Unix(),
        "exp":  time.Now().Add(time.Hour).Unix(),
    }
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    s, _ := token.SignedString(jwtSecret)
    return s
}
```

### Cloud Build Test Step
Tests run in `cloudbuild.yaml` step 1 before container build:
```yaml
- name: 'golang:1.25'
  entrypoint: 'bash'
  args:
    - '-c'
    - |
      go mod download
      go test -v ./...
  dir: 'services/<boundary>/$_DIR_NAME'
```

---

## 📦 Required Dependencies

All Go services MUST include:
```
github.com/gin-gonic/gin
github.com/gin-contrib/cors
github.com/golang-jwt/jwt/v5
github.com/stretchr/testify
github.com/swaggo/files
github.com/swaggo/gin-swagger
github.com/swaggo/swag
cloud.google.com/go/firestore
```

---

## 🔌 Port Assignments

| Service | Port |
|---|---|
| Auth | 8001 |
| Profiles | 8002 |
| Discovery | 8003 |
| Messages | 8005 |
| Users | 8006 |
| Router | 8010 |

---

## ⚠️ Anti-Patterns (NEVER DO)

- **Never** create shared Go packages between services
- **Never** use `replace` directives pointing to sibling directories in `go.mod`
- **Never** use `gin.H{}` for error responses in handlers — use `errors.go` helpers
- **Never** skip Swagger annotations on new handlers
- **Never** register Swagger routes after `AuthMiddleware()` (they'll require auth)
