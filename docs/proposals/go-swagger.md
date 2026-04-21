# Go Services Swagger Implementation Plan (COMPLETED)

This document outlines the successful integration of Swagger/OpenAPI documentation into the five core Go microservices.

## 0. Implementation Status (2026-04-21)
- **Implemented**: All 5 targeted services (`auth_go`, `profiles_go`, `discovery_go`, `messages_go`, `users_go`).
- **Tooling**: `swaggo/swag` v1.16.6.
- **Total Endpoints**: 39 annotated.
- **Coverage**: 100% of core REST APIs.

---

## 1. Overview
Currently, the REST APIs are fully documented and interactive via Swagger UI. Implementing Swagger provides a living, interactive documentation portal for each service without impacting business logic.

**Target Services:**
*   `auth_go`
*   `profiles_go`
*   `discovery_go`
*   `messages_go`
*   `users_go`

---

## 2. Recommended Tooling: Swaggo

We will use [swaggo/swag](https://github.com/swaggo/swag), the industry standard for Go/Gin.

### Why Swaggo?
*   **Declarative**: It uses special comments (`// @Summary ...`) above handlers.
*   **Zero Logic Impact**: You don't have to change how functions are called or how data is validated.
*   **Static Generation**: It generates a `docs` folder containing standard JSON/YAML and a Go file with the schema.

---

## 3. Implementation Steps

For each service (e.g., `discovery_go`):

### Step 1: Install Dependencies
Add the Swagger UI wrapper for Gin.
```bash
go get github.com/swaggo/gin-swagger
go get github.com/swaggo/files
```

### Step 2: Global Metadata
Add the API "Header" in `main.go` inside the `main()` function or as global comments.
```go
// @title Discovery Service API
// @version 1.0
// @description Logic for hero feeds and matching.
// @host localhost:8003
// @BasePath /discovery
```

### Step 3: Handler Annotations
Add metadata to handlers in `handlers.go`.
```go
// handleGetFeed
// @Summary Get hero feed
// @Description Fetches a curated list of profiles the user hasn't swiped on yet.
// @Tags feed
// @Param profile_id path string true "Profile ID"
// @Success 200 {object} FeedResponse
// @Failure 403 {object} map[string]string "Not authorized"
// @Router /feed/{profile_id} [get]
```

### Step 4: Generation
Run the `swag` CLI inside the service directory.
```bash
swag init
```
This generates a `docs/` folder in that directory.

### Step 5: Hosting the UI
In `main.go`, add the route to serve the docs.
```go
import (
    _ "tavern-swiper.app/discovery_go/docs" // Import generated docs
    swaggerFiles "github.com/swaggo/files"
    ginSwagger "github.com/swaggo/gin-swagger"
)

// ... inside main() ...
r.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))
```

---

## 4. Dry Run Example: Discovery Service

If we apply this to `discovery_go`, the "touch" to the code is minimal:

### `main.go` Changes
```diff
+ import _ "tavern-swiper.app/discovery_go/docs"
+ import swaggerFiles "github.com/swaggo/files"
+ import ginSwagger "github.com/swaggo/gin-swagger"

  func main() {
      r := gin.Default()
+     r.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))
      // ...
  }
```

### `handlers.go` Changes
Only comments are added above `func handleGetFeed` and other handlers.

---

## 5. Effort & Risk Analysis

| Metric | Estimate |
| :--- | :--- |
| **Total Endpoints** | ~81 |
| **Estimated Work** | 12–16 hours (Developer) / 4–6 hours (AI) |
| **Risk level** | **Very Low (<1%)** |
| **Runtime Impact** | Negligible (Static file serving only) |

### Key Risks
*   **Model Complexity**: Some models using `interface{}` might need explicit struct definitions to show up correctly in Swagger.
*   **Environment URLs**: The `@host` annotation needs careful management if you want it to work across Local, Dev, and Test environments dynamically.

---

## 6. Next Steps
1.  Verify the `swag` CLI is installed in the development environment.
2.  Start with `discovery_go` as a "Pilot" service.
3.  Deploy to `dev` and verify access at `https://discovery-dev.a.run.app/swagger/index.html`.
4.  Roll out to remaining services.
