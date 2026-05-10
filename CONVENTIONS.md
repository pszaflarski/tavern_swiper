# CONVENTIONS.md — Codebase Patterns for AI Assistants

> These are the **actual patterns** used throughout the codebase. When generating or modifying code, follow these conventions exactly.

## Naming Conventions

### Go Backend

| Element | Pattern | Example |
|---------|---------|---------|
| Handler functions | `verbNounHandler` | `getMatchesHandler`, `createProfileHandler` |
| Test functions | `TestHandlerName_Scenario` | `TestGetFeed_EmptyCache`, `TestSwipe_DuplicateBlocked` |
| Error helpers | `send{StatusCode}(c, msg)` | `send404(c, "profile not found")` |
| Collection constants | `UPPER_SNAKE_CASE` | `SWIPES_COLLECTION`, `PROFILES_CACHE` |
| Auth helper | `GetAuth(c)` | Returns `*AuthData` or `nil` |
| Admin check | `IsAdmin(role)` | Returns `bool` for `admin` or `root_admin` |
| DB factory | `getDBFunc` | Swappable function for test injection |

### Firestore

| Element | Pattern | Example |
|---------|---------|---------|
| Database IDs | `{boundary}-{env}` | `discovery-dev`, `messages-test` |
| Collection names | `snake_case` | `profiles_profiles_cache`, `profile_conversations` |
| Cache collections | `{source}_{source_collection}_cache` | `profiles_profiles_cache`, `discovery_matches_cache` |
| Document IDs (deterministic) | `{type}_{sorted_ids}` | `match_abc123_def456` |
| Timestamps | `firestore.ServerTimestamp` | Never use `time.Now()` |

### Frontend (TypeScript)

| Element | Pattern | Example |
|---------|---------|---------|
| API hooks | `use{Verb}{Noun}` | `useGetProfile`, `useCreateProfile` |
| Query keys | `["{resource}", id?]` | `["profiles", profileId]` |
| Screen files | `app/(tabs)/{name}.tsx` | `app/(tabs)/profiles.tsx` |
| Test IDs | `kebab-case` | `swipe-left-button`, `forge-identity-btn` |
| Env vars | `EXPO_PUBLIC_{NAME}` | `EXPO_PUBLIC_AUTH_URL` |

## Code Patterns

### Standard Handler Structure (Go)

```go
func getThingHandler(c *gin.Context) {
    // 1. Extract and validate auth
    auth := GetAuth(c)
    if auth == nil {
        send401(c, "unauthorized")
        return
    }

    // 2. Validate input parameters
    id := c.Param("id")
    if id == "" {
        send400(c, "id is required")
        return
    }

    // 3. Get database client
    client, err := getDBFunc(c.Request.Context())
    if err != nil {
        send503(c, "database unavailable")
        return
    }

    // 4. Execute query
    doc, err := client.Collection(COLLECTION).Doc(id).Get(c.Request.Context())
    if err != nil {
        send404(c, "not found")
        return
    }

    // 5. Return response
    c.JSON(http.StatusOK, doc.Data())
}
```

### Unit Test Structure (Go)

```go
func TestGetThing_Success(t *testing.T) {
    router, mockDB := setupTest()

    // Arrange: seed mock data
    mockDB.SetDoc("things", "abc123", map[string]interface{}{
        "name": "Test Thing",
    })

    // Act: make request
    w := httptest.NewRecorder()
    req, _ := http.NewRequest("GET", "/things/abc123", nil)
    req.Header.Set("Authorization", "Bearer "+signToken("user1", "user"))
    router.ServeHTTP(w, req)

    // Assert
    assert.Equal(t, http.StatusOK, w.Code)
}
```

### Firestore Timestamps

```go
// ✅ CORRECT — server-side timestamps
data := map[string]interface{}{
    "created_at": firestore.ServerTimestamp,
    "updated_at": firestore.ServerTimestamp,
}

// ❌ WRONG — application-level timestamps
data := map[string]interface{}{
    "created_at": time.Now(),
}
```

### Error Responses

```go
// ✅ CORRECT — use error helpers from errors.go
send400(c, "invalid profile ID")
send403(c, "admin access required")
send404(c, "profile not found")
send500(c, "failed to save")

// ❌ WRONG — raw gin.H
c.JSON(http.StatusBadRequest, gin.H{"error": "invalid"})
c.JSON(http.StatusForbidden, gin.H{"detail": "no access"})
```

### Frontend API Calls

```go
// ✅ CORRECT — use the token-injected Axios client
import { api } from '@/lib/api';
const { data } = await api.get('/profiles/user/me');

// ❌ WRONG — direct fetch or new Axios instance
fetch('http://localhost:8002/profiles/user/me')
axios.get('http://localhost:8002/profiles/user/me')
```

### Frontend Env Var Access

```typescript
// ✅ CORRECT — static literal access
const url = process.env.EXPO_PUBLIC_AUTH_URL;

// ❌ WRONG — dynamic access (silently returns undefined in web builds)
const key = 'AUTH_URL';
const url = process.env[`EXPO_PUBLIC_${key}`];
```

## Anti-Patterns (NEVER DO)

| Anti-Pattern | Why | Instead |
|-------------|-----|---------|
| Import from sibling service | Violates shared-nothing | Duplicate the code |
| `go.mod replace` to sibling dir | Cross-service coupling | Self-contained modules |
| `gin.H{}` for error responses | Inconsistent error format | `errors.go` helpers |
| `time.Now()` for timestamps | Clock skew, inconsistent | `firestore.ServerTimestamp` |
| Dynamic `process.env[key]` | Silent failure in Expo web | Static `process.env.EXPO_PUBLIC_X` |
| System python | Dependency conflicts | `.venv/bin/python3` |
| `service-account.json` | Security risk | ADC + impersonation |
| Swagger after auth middleware | 401 on docs endpoint | Register before `r.Use(AuthMiddleware())` |
| Direct Firestore from frontend | Bypasses security layer | Use microservice APIs via `api.ts` |
