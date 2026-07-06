# Health Endpoint Auth Pattern Fix

## Problem

All Go services register the `/health` endpoint **after** `r.Use(AuthMiddleware())`, then use a fragile hardcoded path check inside `auth.go` to bypass authentication:

```go
// In auth.go — every service has this:
if c.Request.URL.Path == "/<service>/health" {
    c.Next()
    return
}
```

This is fragile because:
- The bypass is coupled to a magic string inside the middleware
- If the route path changes, the bypass silently breaks
- Swagger is already correctly registered **before** the auth middleware

## Fix

Move the health endpoint registration **before** `r.Use(AuthMiddleware())` in `main.go`, then remove the path-bypass block from `auth.go`. This was already done for `characters_go` in commit `8e6e1c2`.

### Affected Services

- `services/auth/auth_go/`
- `services/auth/users_go/`
- `services/profiles/profiles_go/`
- `services/discovery/discovery_go/`
- `services/messages/messages_go/`
- `services/router/router_go/`
- `services/bots/bots_go/`
- `services/characters/characters_go/` ✅ (already fixed)
- `services/quests/quests_go/`

### Steps per service

1. In `main.go`: move `r.GET("/<service>/health", handleHealth)` above `r.Use(AuthMiddleware())`
2. In `auth.go`: remove the `if c.Request.URL.Path == "/<service>/health"` bypass block
3. Run `go test -v ./...`
