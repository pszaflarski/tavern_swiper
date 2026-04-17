# Rename Cloud Services: Consistent `-dev` / `-test` Suffix Convention

## Problem Statement

The current naming convention uses **no suffix** for the `dev` environment and `-test` for the `test` environment. This asymmetry causes:

1. **Fragile build logic** — `frontend/cloudbuild.yaml` has a `get_url()` fallback that tries with suffix, then without. Other scripts have similar `if env == "dev": name = service; elif env == "test": name = service + "-test"` branching.
2. **Easy-to-miss bugs** — Any new script or cloudbuild file must remember the special empty-suffix case.
3. **Unclear naming in GCP Console** — A service named `auth` doesn't visually indicate which environment it belongs to.
4. **Future environment friction** — Adding `-staging` or `-prod` requires no code changes if all environments are suffix-based.

### Current State

| Resource | Dev Name | Test Name |
|---|---|---|
| **Cloud Run: Auth** | `auth` | `auth-test` |
| **Cloud Run: Profiles** | `profiles` | `profiles-test` |
| **Cloud Run: Discovery** | `discovery` | `discovery-test` |
| **Cloud Run: Messages** | `messages` | `messages-test` |
| **Cloud Run: Users** | `users` | `users-test` |
| **Cloud Run: Frontend** | `app` | `app-test` |
| **Cloud Function: Subscriber** | `discovery_subscriber` | `discovery_subscriber-test` |
| **Firestore DBs** | `auth`, `profiles`, `discovery`, `messages`, `users` | `auth-test`, `profiles-test`, `discovery-test`, `messages-test`, `users-test` |
| **Pub/Sub Topics** | `dev-profiles-profile-events-v1` | `test-profiles-profile-events-v1` |
| **GCS Bucket** | `tavern-swiper-dev-media` (shared) | same bucket |
| **Cloud Build `_ENV_SUFFIX`** | `""` (empty string) | `"-test"` |
| **Cloud Build `_ENV_NAME`** | `"dev"` | `"test"` |

### Target State

| Resource | Dev Name | Test Name |
|---|---|---|
| **Cloud Run: Auth** | `auth-dev` | `auth-test` |
| **Cloud Run: Profiles** | `profiles-dev` | `profiles-test` |
| **Cloud Run: Discovery** | `discovery-dev` | `discovery-test` |
| **Cloud Run: Messages** | `messages-dev` | `messages-test` |
| **Cloud Run: Users** | `users-dev` | `users-test` |
| **Cloud Run: Frontend** | `app-dev` | `app-test` |
| **Cloud Function: Subscriber** | `discovery_subscriber-dev` | `discovery_subscriber-test` |
| **Firestore DBs** | `auth-dev`, `profiles-dev`, `discovery-dev`, `messages-dev`, `users-dev` | `auth-test`, `profiles-test`, etc. |
| **Pub/Sub Topics** | **unchanged** — `dev-profiles-profile-events-v1` | **unchanged** |
| **GCS Bucket** | **unchanged** — `tavern-swiper-dev-media` | **unchanged** |
| **Cloud Build `_ENV_SUFFIX`** | `"-dev"` | `"-test"` (unchanged) |
| **Cloud Build `_ENV_NAME`** | `"dev"` (unchanged) | `"test"` (unchanged) |

> [!IMPORTANT]
> **Pub/Sub topics and GCS buckets do NOT need renaming.** They already use consistent naming and are decoupled from Cloud Run service names. However, **Firestore databases in dev will be renamed** from `service` to `service-dev` to align with the environment naming convention.

---

## Phase 1: Update Cloud Build Trigger Substitution Variables (GCP Console)

This is the foundational change. Everything else flows from here.

### 1.1 Update `_ENV_SUFFIX` for Dev Triggers

In the [GCP Cloud Build Triggers page](https://console.cloud.google.com/cloud-build/triggers?project=tavern-swiper-dev), find every trigger that targets the `main` branch (dev environment) and update:

```
_ENV_SUFFIX: ""  →  _ENV_SUFFIX: "-dev"
```

The following triggers need updating (any trigger mapped to `main` branch):

| Trigger Name (approx) | Branch | Change |
|---|---|---|
| auth (main) | `main` | `_ENV_SUFFIX: "" → "-dev"` |
| profiles (main) | `main` | `_ENV_SUFFIX: "" → "-dev"` |
| discovery (main) | `main` | `_ENV_SUFFIX: "" → "-dev"` |
| messages (main) | `main` | `_ENV_SUFFIX: "" → "-dev"` |
| users (main) | `main` | `_ENV_SUFFIX: "" → "-dev"` |
| frontend/app (main) | `main` | `_ENV_SUFFIX: "" → "-dev"` |
| discovery_subscriber (main) | `main` | `_ENV_SUFFIX: "" → "-dev"` |

> [!WARNING]
> **Do NOT change `_ENV_NAME`, `_DB_ID`, or `_SERVICE_NAME`**. Those are correct as-is. Only `_ENV_SUFFIX` changes.

### 1.2 Verify Test Triggers Are Unchanged

Confirm that all `test` branch triggers already have `_ENV_SUFFIX: "-test"`. No changes needed here — just verify.

---

## Phase 2: Simplify CloudBuild YAML Files

With `_ENV_SUFFIX` always being a real value (`-dev` or `-test`), all fallback logic can be removed.

### 2.1 `frontend/cloudbuild.yaml` — Simplify `get_url()`

**Current (lines 19-37)** — Has fallback logic: tries with suffix, then without:
```bash
get_url() {
  local service_name="$1"
  local suffix="$_ENV_SUFFIX"
  local url=""
  
  # Try with suffix first
  url=$(gcloud run services describe "${service_name}${suffix}" ...)
  
  # If not found and suffix is not empty, try without suffix
  if [[ -z "$url" && -n "$suffix" ]]; then
    url=$(gcloud run services describe "${service_name}" ...)
  fi
  ...
}
```

**Target** — Direct lookup, no fallback:
```bash
get_url() {
  local service_name="$1"
  local url=""
  
  url=$(gcloud run services describe "${service_name}$_ENV_SUFFIX" \
    --platform managed --region us-central1 \
    --format 'value(status.url)' 2>/dev/null || echo "")
  
  if [[ -z "$url" ]]; then
    echo "❌ ERROR: Could not find URL for service: ${service_name}$_ENV_SUFFIX" >&2
    return 1
  fi
  echo "$url"
}
```

### 2.2 `services/cloudbuild.yaml` — Remove `ENV_NAME` derivation hack

**Current (line 41-42)**:
```bash
ENV_NAME="dev"
if [ "$${_ENV_SUFFIX}" == "-test" ]; then ENV_NAME="test"; fi
```

**Target** — Use `$_ENV_NAME` directly (it's already a substitution variable):
```bash
# $_ENV_NAME is already passed via Cloud Build trigger substitution variables.
# No derivation needed.
```

> [!NOTE]
> The `$_ENV_NAME` variable is already set as a substitution variable on the triggers. The `if` block was a workaround for when `_ENV_SUFFIX` was empty. With `-dev` suffix, this derivation is no longer needed — but `_ENV_NAME` is still the correct variable to use for Pub/Sub topic names and Firestore DB selection.

### 2.3 Per-Service CloudBuild Files — No Code Changes Needed

The files `services/{auth,profiles,discovery,messages,users}/cloudbuild.yaml` all use:
```bash
gcloud run deploy $_SERVICE_NAME$_ENV_SUFFIX \
```
This pattern already works correctly with `_ENV_SUFFIX="-dev"`. **No changes needed** in these files.

### 2.4 `services/discovery_subscriber/cloudbuild.yaml` — No Changes Needed

Already uses:
```bash
gcloud functions deploy $_SERVICE_NAME$_ENV_SUFFIX \
```
Works correctly with `-dev`.

---

## Phase 3: Update Python Scripts

All admin/utility scripts have the same `if env == "dev": name = service else: name = service-test` pattern. This needs unification.

### 3.1 `scripts/create_root_admin.py` (lines 27-33)

**Current**:
```python
if env == "dev":
    deploy_name = service_name
elif env == "test":
    deploy_name = f"{service_name}-test"
```

**Target**:
```python
deploy_name = f"{service_name}-{env}"
```

### 3.2 `scripts/seed_profiles.py` (lines 32-36)

**Current**:
```python
deploy_name = f"{service_name}-test" if env == "test" else service_name
if env == "dev":
    deploy_name = service_name
elif env == "test":
    deploy_name = f"{service_name}-test"
```

**Target**:
```python
deploy_name = f"{service_name}-{env}"
```

### 3.3 `scripts/check_profiles.py` (lines 5-9)

**Current** — Hardcoded to `-test`:
```python
def get_url(service):
    return subprocess.check_output([
        "gcloud", "run", "services", "describe", f"{service}-test", 
        ...
    ]).decode("utf-8").strip()
```

**Target** — Accept env parameter:
```python
def get_url(service, env="dev"):
    return subprocess.check_output([
        "gcloud", "run", "services", "describe", f"{service}-{env}", 
        "--format=value(status.url)", "--region=us-central1"
    ]).decode("utf-8").strip()
```

### 3.4 `scripts/switch_env.sh` (lines 42-46)

**Current**:
```bash
if [[ "$ENV" == "dev" ]]; then
    DEPLOY_NAME="${SERVICE}"
else
    DEPLOY_NAME="${SERVICE}-test"
fi
```

**Target**:
```bash
DEPLOY_NAME="${SERVICE}-${ENV}"
```

### 3.5 `scripts/clear_system.py` (line 41)

**Current**:
```python
suffix = "-test" if env == "test" else ""
```

**Target**:
```python
suffix = f"-{env}" if env != "local" else ""
```

> [!NOTE]
> The `clear_system.py` uses the suffix for **Firestore database IDs**, not Cloud Run service names. Firestore DB IDs are NOT being renamed (e.g., `auth` stays `auth`, `auth-test` stays `auth-test`). So this change means that when running `clear_system.py dev`, it will look for database `auth-dev` — **but the actual DB is just `auth`**. 
>
> **Decision needed**: Either (a) also rename Firestore databases to `auth-dev`, `profiles-dev`, etc. for full consistency, or (b) keep Firestore DB names as-is and preserve the existing logic. **Recommendation: Keep Firestore unchanged** — renaming databases is destructive (requires recreating them) and provides minimal benefit. Keep the `clear_system.py` logic as:
> ```python
> suffix = "-test" if env == "test" else ""
> ```
> This is one of the few places where the asymmetry must remain because Firestore DB IDs are an immutable infrastructure decision.

### 3.6 `clear_cloud_firestore.py` (root level, line 6)

**Current** — Hardcoded to `-test`:
```python
DATABASES = ["users-test", "profiles-test", "auth-test", "swipes-test", "messages-test", "discovery-test"]
```

**No change needed** — This script is hardcoded for the test environment. No dev DBs are renamed.

### 3.7 `purge_cloud_test.sh` (lines 10-15)

**Current** — Already uses `-test` suffix:
```bash
export AUTH_URL=$(get_url "auth-test")
export USERS_URL=$(get_url "users-test")
```

**No change needed** — This is test-specific and already correct.

### 3.8 `scripts/populate-valerius.py` (lines 7-8)

**Current** — Hardcoded test URLs:
```python
AUTH_URL = "https://auth-test-hhqol7siba-uc.a.run.app"
PROFILES_URL = "https://profiles-test-hhqol7siba-uc.a.run.app"
```

**No change needed** — Hardcoded to test and already uses `-test` suffix.

---

## Phase 4: Update Frontend `.env` for Local Dev

### 4.1 `frontend/.env`

**Current** — Points to unsuffixed dev services:
```
EXPO_PUBLIC_AUTH_URL=https://auth-hhqol7siba-uc.a.run.app
EXPO_PUBLIC_PROFILES_URL=https://profiles-hhqol7siba-uc.a.run.app
...
```

**Target** — After the new `-dev` services are deployed, run:
```bash
./scripts/switch_env.sh dev
```
This will automatically fetch the new `auth-dev`, `profiles-dev`, etc. URLs and update `.env`.

> [!IMPORTANT]
> The `.env` values will naturally change because Cloud Run generates new URLs when you deploy services with new names. The old URLs will stop working once the old services are deleted.

---

## Phase 5: Deploy to Create the New `-dev` Services

This is the critical moment. The new Cloud Run services with `-dev` suffix need to be created.

### 5.1 Trigger All Dev Builds

After Phase 1 (trigger updates) and Phase 2-3 (code changes), commit everything to `main` and push:

```bash
git add -A
git commit -m "refactor: standardize service naming with -dev suffix for all environments"
git push origin main
```

This will trigger all Cloud Build triggers for `main`, which will deploy:
- `auth-dev` (new)
- `profiles-dev` (new)
- `discovery-dev` (new)
- `messages-dev` (new)
- `users-dev` (new)
- `app-dev` (new)
- `discovery_subscriber-dev` (new)

### 5.2 Verify All New Services Are Up

```bash
SERVICES=("auth-dev" "profiles-dev" "discovery-dev" "messages-dev" "users-dev" "app-dev")
for s in "${SERVICES[@]}"; do
  URL=$(gcloud run services describe "$s" --platform managed --region us-central1 --format 'value(status.url)' 2>/dev/null)
  echo "$s → $URL"
done
```

### 5.3 Run Smoke Tests

```bash
# Update local frontend env to point to new dev services
./scripts/switch_env.sh dev

# Verify seed/admin scripts work
python scripts/create_root_admin.py dev
python scripts/seed_profiles.py dev
```

---

## Phase 6: Push to Test Branch & Verify

```bash
git push origin main:test --force
```

Wait for builds. Verify test services are still functioning (no change expected since test triggers are unchanged).

---

## Phase 7: Update Documentation

### 8.1 `.cursorrules` — Update port assignment table comment

Add note that Cloud Run services are always `{service}-{env}`:
```
- **Cloud Run Naming**: Services are always deployed as `{service_name}-{env}` (e.g., `auth-dev`, `profiles-test`). Never use unsuffixed service names.
```

### 8.2 `architecture.md` — Update Service Overview

Note the naming convention in the architecture doc.

### 8.3 Workflow Files

Update `reset-and-seed-test-env.md` if any commands change (unlikely — the scripts accept `test` as an argument and the naming fix is internal).

---

## Rollback Plan

If anything goes wrong:
1. **Revert the Cloud Build trigger** `_ENV_SUFFIX` back to `""` for all `main` branch triggers.
2. **Revert the code** on `main` — `git revert HEAD && git push origin main`.
3. The old unsuffixed services will still be running (until Phase 7 cleanup), so traffic continues to flow.

---

## Complete File Change Checklist

| File | Change Type | Details |
|---|---|---|
| `frontend/cloudbuild.yaml` | **Simplify** | Remove fallback logic in `get_url()` |
| `services/cloudbuild.yaml` | **Simplify** | Remove `ENV_NAME` derivation from `_ENV_SUFFIX` |
| `scripts/create_root_admin.py` | **Simplify** | `deploy_name = f"{service_name}-{env}"` |
| `scripts/seed_profiles.py` | **Simplify** | `deploy_name = f"{service_name}-{env}"` |
| `scripts/check_profiles.py` | **Simplify** | Accept env param, use `f"{service}-{env}"` |
| `scripts/switch_env.sh` | **Simplify** | `DEPLOY_NAME="${SERVICE}-${ENV}"` |
| `frontend/.env` | **Auto-update** | Run `switch_env.sh dev` after deploy |
| `.cursorrules` | **Document** | Add naming convention note |
| `architecture.md` | **Document** | Add naming convention note |

### Files NOT Changed

| File | Reason |
|---|---|
| `services/{auth,profiles,discovery,messages,users}/cloudbuild.yaml` | Already use `$_SERVICE_NAME$_ENV_SUFFIX` — works with `-dev` |
| `services/discovery_subscriber/cloudbuild.yaml` | Same pattern, already correct |
| `docker-compose.yml` | Local dev, uses localhost — no Cloud Run names |
| `docker-compose-test.yml` | Local test, Firestore DB refs unchanged |
| `services/*/.env` | Local dev config, no Cloud Run names |
| `scripts/clear_system.py` | Uses Firestore DB IDs, not Cloud Run names — **keep existing logic** |
| `clear_cloud_firestore.py` | Hardcoded to test DBs, no change |
| `purge_cloud_test.sh` | Already uses `-test` suffix, no change |
| `scripts/populate-valerius.py` | Hardcoded to test, no change |

### GCP Console Changes (Manual)

| Resource | Change |
|---|---|
| Cloud Build Triggers (all `main` branch) | `_ENV_SUFFIX: "" → "-dev"` |
| Cloud Build Triggers (all `test` branch) | **No change** — already `"-test"` |
| Firestore Databases | **No change** |
| Pub/Sub Topics | **No change** |
| GCS Buckets | **No change** |

---

## Estimated Effort

| Phase | Time | Notes |
|---|---|---|
| Phase 1: Update triggers | 5 min | GCP Console, ~7 triggers |
| Phase 2: Simplify cloudbuild YAMLs | 5 min | 2 files |
| Phase 3: Update Python/Bash scripts | 10 min | 4 files, ~1 line each |
| Phase 4: Frontend .env | 1 min | Automated via script |
| Phase 5: Deploy & verify | 10 min | Wait for builds |
| Phase 6: Push to test | 5 min | Verify no regression |
| Phase 7: Update docs | 5 min | 2 files |
| **Total** | **~40 min** | |
