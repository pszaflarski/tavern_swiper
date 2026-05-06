# Docker Build Optimization — Audit & Implementation Plan

## Current State Audit

### What You're Already Doing Right ✅

| Practice | Status | Details |
|:---|:---|:---|
| **Multi-stage builds** | ✅ All services | Builder → slim runtime, keeping images small |
| **Dependency-first COPY** | ✅ All services | `COPY go.mod go.sum` → `RUN go mod download` → `COPY . .` already present in all 7 Go Dockerfiles |
| **Minimal runtime images** | ✅ Most services | Using `alpine:latest` or `debian:bookworm-slim` |
| **Dedicated build triggers** | ✅ All services | Cloud Build triggers scoped to `services/<boundary>/<container>/**` via `includedFiles` |
| **Frontend dep isolation** | ✅ Frontend | `COPY package*.json` → `npm install` → `COPY . .` |

### What Needs Fixing ⚠️

| Issue | Severity | Affected |
|:---|:---|:---|
| **Missing `.dockerignore`** | Medium | 6 of 7 Go services (only `auth_go` has one) |
| **No BuildKit cache mounts** | High | All services — deps re-downloaded every CI build |
| **`:latest` tag only** | High | All services — no immutable tagging, cache poisoning risk |
| **No remote registry caching** | Medium | All services — ephemeral Cloud Build workers lose cache |
| **Inconsistent base images** | Low | `auth_go` uses `debian:bookworm-slim`, rest use `alpine:latest` |
| **No `CGO_ENABLED=0` on some** | Low | 4 services use bare `go build`, 3 use `CGO_ENABLED=0` |
| **Test files in build context** | Medium | `*_test.go`, `snapshots.json`, `mock_*.go` all copied into images |
| **Cloud Build runs tests then rebuilds deps** | High | Step 1 downloads Go modules, Step 2 Docker build downloads them again — double work |

---

## Implementation Plan

### Phase 1: Quick Wins (Low Risk, Immediate Impact)

#### 1.1 — Add `.dockerignore` to All Services

Create a standardized `.dockerignore` for every Go service directory that is missing one.

**Files to create** (6 services):
- `services/auth/users_go/.dockerignore`
- `services/discovery/discovery_go/.dockerignore`
- `services/discovery/discovery_subscriber/.dockerignore`
- `services/messages/messages_go/.dockerignore`
- `services/messages/messages_subscriber/.dockerignore`
- `services/profiles/profiles_go/.dockerignore`

**Standard content:**
```dockerignore
# Build artifacts & CI config
cloudbuild.yaml
Dockerfile
README.md

# Test files (not needed in production image)
*_test.go
mock_*.go
snapshots.json
testflags_test.go
test_helpers.go

# IDE and environment
.git
.vscode
.env
.env.*

# Python artifacts (if any)
__pycache__
*.pyc
*.pyo
*.pyd
.pytest_cache
```

> [!NOTE]
> Go's `COPY . .` in the builder stage copies test files into the build context.
> While `go build` ignores `_test.go` files, they still enlarge the context transfer
> and can cause unnecessary cache invalidation when only tests change.

**Risk:** Very low. Test files are never used by `go build`, only by `go test` (which runs in a separate Cloud Build step anyway).

---

#### 1.2 — Standardize Build Flags

Ensure all Go services use consistent, reproducible build flags.

**Current state:**
- `auth_go`, `discovery_subscriber`, `messages_subscriber`: `CGO_ENABLED=0`
- `profiles_go`, `discovery_go`, `messages_go`, `users_go`: bare `go build`

**Target — all services:**
```dockerfile
RUN CGO_ENABLED=0 GOOS=linux go build -o <binary-name> .
```

**Why:** `CGO_ENABLED=0` produces fully static binaries that are safe to run on `alpine` (which has no glibc). Without it, builds may silently link against glibc, which won't exist at runtime. This also enables the Go compiler to skip the CGO toolchain probe, speeding up the build slightly.

---

### Phase 2: BuildKit Cache Mounts (High Impact)

#### 2.1 — Add Go Module Cache Mounts to Dockerfiles

Modify the `go mod download` and `go build` steps to mount the Go module cache.

**Before (all services):**
```dockerfile
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN go build -o main .
```

**After:**
```dockerfile
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -o main .
```

**What this does:**
- `/go/pkg/mod` — caches downloaded module source files between builds
- `/root/.cache/go-build` — caches compiled object files between builds

> [!IMPORTANT]
> BuildKit cache mounts require `DOCKER_BUILDKIT=1`. Cloud Build supports this natively,
> but the `cloudbuild.yaml` docker build step must be updated to use `docker buildx build`
> or set the `DOCKER_BUILDKIT=1` environment variable.

**Mitigation — Cache Bust:**
```bash
# If cache becomes corrupted, add this build-arg to force a clean build:
docker build --build-arg CACHE_BUST=$(date +%s) ...
```

---

#### 2.2 — Update `cloudbuild.yaml` to Enable BuildKit

**Before:**
```yaml
- name: 'gcr.io/cloud-builders/docker'
  args: ['build', '-t', 'gcr.io/$PROJECT_ID/$_SERVICE_NAME', '.']
  dir: 'services/<boundary>/$_DIR_NAME'
```

**After:**
```yaml
- name: 'gcr.io/cloud-builders/docker'
  args: ['build', '-t', 'gcr.io/$PROJECT_ID/$_SERVICE_NAME:$SHORT_SHA', '-t', 'gcr.io/$PROJECT_ID/$_SERVICE_NAME:latest', '.']
  dir: 'services/<boundary>/$_DIR_NAME'
  env:
    - 'DOCKER_BUILDKIT=1'
```

**This also adds commit SHA tagging** (see Phase 3).

---

### Phase 3: Immutable Image Tagging (Medium Impact, High Safety)

#### 3.1 — Tag Images with `$SHORT_SHA`

**Current state:** All services push only `:latest`, which means:
- You can't tell which commit is deployed
- A broken build overwrites the known-good image
- `--cache-from` has no stable reference point

**Update all `cloudbuild.yaml` files:**

```yaml
# Build with both tags
- name: 'gcr.io/cloud-builders/docker'
  args:
    - 'build'
    - '-t'
    - 'gcr.io/$PROJECT_ID/$_SERVICE_NAME:$SHORT_SHA'
    - '-t'
    - 'gcr.io/$PROJECT_ID/$_SERVICE_NAME:latest'
    - '.'
  dir: 'services/<boundary>/$_DIR_NAME'
  env:
    - 'DOCKER_BUILDKIT=1'

# Push both tags
- name: 'gcr.io/cloud-builders/docker'
  args: ['push', '--all-tags', 'gcr.io/$PROJECT_ID/$_SERVICE_NAME']

# Deploy specific SHA
- name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
  # ... deploy with --image=gcr.io/$PROJECT_ID/$_SERVICE_NAME:$SHORT_SHA
```

> [!TIP]
> `$SHORT_SHA` is automatically available in Cloud Build triggered by GitHub pushes.
> This gives you instant rollback capability: just redeploy the previous SHA.

---

### Phase 4: Remote Registry Caching (Future — Medium Impact)

#### 4.1 — Use `--cache-from` / `--cache-to` with Artifact Registry

Once SHA tagging is in place, enable cross-build caching:

```yaml
- name: 'gcr.io/cloud-builders/docker'
  entrypoint: 'bash'
  args:
    - '-c'
    - |
      docker buildx build \
        --cache-from=type=registry,ref=gcr.io/$PROJECT_ID/$_SERVICE_NAME:cache \
        --cache-to=type=registry,ref=gcr.io/$PROJECT_ID/$_SERVICE_NAME:cache,mode=max \
        -t gcr.io/$PROJECT_ID/$_SERVICE_NAME:$SHORT_SHA \
        -t gcr.io/$PROJECT_ID/$_SERVICE_NAME:latest \
        --push .
  dir: 'services/<boundary>/$_DIR_NAME'
  env:
    - 'DOCKER_BUILDKIT=1'
```

> [!WARNING]
> **Defer this to Phase 4.** It requires `docker buildx` and a remote builder setup
> in Cloud Build. Get Phases 1–3 working first — they cover 80–90% of the gains.

---

### Phase 5: Eliminate Double Module Download

#### 5.1 — Deduplicate Test + Build Module Downloads

**Current problem:** Every `cloudbuild.yaml` has:
1. Step 1: `golang:1.25` → `go mod download` + `go test` (downloads all modules)
2. Step 2: `docker build` → `go mod download` again inside the Dockerfile (downloads all modules *again*)

**Option A — Volume mount (recommended):**
Share the module cache from the test step to the build step via Cloud Build volumes:

```yaml
steps:
  # 1. Run Unit Tests (and cache modules)
  - name: 'golang:1.25'
    entrypoint: 'bash'
    args:
      - '-c'
      - |
        go mod download
        go test -v ./... -skip TestSnapshotsParity
    dir: 'services/<boundary>/$_DIR_NAME'
    volumes:
      - name: 'go-modules'
        path: '/go/pkg/mod'

  # 2. Build — reuses downloaded modules via BuildKit cache mount
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'gcr.io/$PROJECT_ID/$_SERVICE_NAME:$SHORT_SHA', '-t', 'gcr.io/$PROJECT_ID/$_SERVICE_NAME:latest', '.']
    dir: 'services/<boundary>/$_DIR_NAME'
    env:
      - 'DOCKER_BUILDKIT=1'
```

> [!NOTE]
> The Cloud Build volume only helps between *steps* in the same build.
> The Docker build step still runs `go mod download` inside its own container.
> BuildKit cache mounts (Phase 2) are what eliminate the redundancy *inside* Docker.
> Both techniques complement each other.

---

## Execution Checklist

| # | Task | Impact | Risk | Est. Time |
|:---|:---|:---|:---|:---|
| 1.1 | Add `.dockerignore` to 6 services | Low-Med | Very Low | 10 min |
| 1.2 | Standardize `CGO_ENABLED=0` in all Dockerfiles | Low | Very Low | 10 min |
| 2.1 | Add BuildKit cache mounts to all 7 Dockerfiles | **High** | Low | 20 min |
| 2.2 | Enable BuildKit in all 8 `cloudbuild.yaml` files | **High** | Low | 15 min |
| 3.1 | Add `$SHORT_SHA` tagging to all builds + deploys | **Medium** | Low | 20 min |
| 5.1 | Add Cloud Build volumes for test→build module sharing | Medium | Low | 15 min |
| 4.1 | Remote registry caching with `--cache-from/to` | Medium | Medium | 30 min (later) |

**Total estimated time for Phases 1–3:** ~75 minutes
**Total estimated time for all phases:** ~2 hours

---

## Risk Management Summary

| Strategy | Primary Risk | Mitigation |
|:---|:---|:---|
| `.dockerignore` | Accidentally excluding needed files | Only exclude test/IDE files; `go build` never reads `_test.go` |
| BuildKit cache mounts | Stale/corrupted cache | Add `CACHE_BUST` build-arg for emergency invalidation |
| SHA tagging | Tag proliferation in registry | Set up GCR lifecycle policies to auto-delete images older than 30 days |
| Remote caching (future) | Cache poisoning | Isolated `:cache` tag, never overwrite production SHA tags |
| General | "Works on my machine" | Add a weekly scheduled Cloud Build with `--no-cache` flag |

---

## Recommendation

Start with **Phase 1** (`.dockerignore` + build flags) — zero risk, immediate context-size reduction.
Then do **Phase 2 + 3** together (BuildKit mounts + SHA tagging) — this is where the big wins are.
**Phase 4** (remote caching) can wait until you notice cross-build cache misses in Cloud Build logs.
