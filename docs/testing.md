# Tavern Swiper Testing Guide

This document outlines the testing strategies and procedures for the Tavern Swiper project.

## 1. Directory Context (CRITICAL)

The project consists of multiple independent environments (Go, Node.js, Python). You **MUST** be in the correct directory for the test runner to find the relevant configuration and source code.

| Layer | Runner | Directory |
| :--- | :--- | :--- |
| **Backend Services** | `go test` | `services/<service-name>_go/` |
| **Frontend** | `npm test` | `frontend/` |
| **Integration** | `pytest` / `bash` | Root `/` |

## 2. Backend Unit Tests (Go)

Each service has its own unit tests within the service directory. Tests use interfaces to mock Firestore, GCS, and Pub/Sub clients, ensuring fast execution without external connectivity.

### Running Service Tests
To run tests for a specific service:
```bash
cd services/<service-name>_go
go test -v ./...
```

### Test Categories
Backend tests include:
- **Logic tests** (`logic_test.go`): Core business logic verification.
- **Handler tests** (`handlers_test.go`): HTTP endpoint behavior.
- **Snapshot tests** (`snapshot_test.go`): Response format parity.
- **Resilience tests** (`resilience_test.go`): Error handling and edge cases.

### Dual-Mode Testing (Mock vs. Real Firestore)

We support running backend tests against either the standard in-memory mocks or a live Firestore database.

#### 1. Default (Mocks)
This is the standard mode used for fast development and CI.
```bash
go test ./...
```

#### 2. Real Database Mode
This mode runs specialized integration tests against the real Firestore project. It automatically skips tests that rely on mock-specific internals (like manual error injection).

```bash
# Run real DB tests for a service
# (Defaults to tavern-swiper-dev project)
go test -v -run TestIntegration -args -real-db

# Override the project or database ID
go test -v -run TestIntegration -args -real-db -project=my-project -db-id=my-db
```

> [!IMPORTANT]
> To run real DB tests, you must have active Application Default Credentials:
> ```bash
> gcloud auth application-default login
> ```

## 3. Frontend Unit Tests (Jest)

The frontend uses Jest and React Native Testing Library for unit and component-level testing.

### Running Frontend Tests
```bash
cd frontend
# Run all tests
npm test

# Run specifically the Jest suite (logic and component tests)
npm run test:jest

# Run specific tests by pattern
npm run test:logic
npm run test:snapshots
```

> [!NOTE]
> `npm` and `node` are expected to be available in the local environment.

### Test Coverage
- Login and authentication flows
- Profile creation, editing, and portfolio navigation
- Swiping and discovery (including infinite scroll)
- Messaging and conversations
- Optimistic UI updates
- Backoff/resilience behavior
- UI snapshots

---

## 4. Integration Tests

Integration tests verify end-to-end flows between multiple Go services using `pytest`.

### Running Integration Tests
```bash
# Locally (requires Docker)
bash tests/run_integration_tests.sh --local

# Against Cloud (Dev environment)
bash tests/run_integration_tests.sh
```

---

## 5. Mobile E2E Tests (Maestro)

Native mobile automation using **Maestro**. These tests run against a real app on an Android emulator, mirroring the user journeys covered by Jest but in a true E2E environment.

### Prerequisites
1. **Docker**: Required for the default memory-isolated execution mode.
2. **Maestro CLI**: Installed at `~/.maestro/bin/maestro` (used for `--no-docker` fallback).
3. **Android Emulator**: An AVD named `MaestroTest` is configured and ready.
4. **App Built**: The app must be installed on the emulator before running tests.

### Running Maestro Tests

The test runner script (`scripts/run_maestro_tests.sh`) handles everything automatically:

```bash
cd frontend

# Run all flows (Docker mode — recommended)
npm run test:maestro

# Run a single flow
bash ../scripts/run_maestro_tests.sh auth_login

# Run without Docker (direct Maestro CLI, JVM memory-limited)
npm run test:maestro:direct
```

The script automatically:
1. Cleans stale Maestro artifacts from `/tmp`
2. Reduces `vm.swappiness` to 10 (if sudo available)
3. Starts the `MaestroTest` emulator if not already running
4. Builds the Maestro Docker image (cached after first run)
5. Runs flows inside a **2GB memory-limited container**
6. Cleans up `/tmp` again after completion

### Memory Optimization

Maestro (a JVM application) can accumulate temp files and consume significant memory on low-RAM systems. The runner implements these safeguards:

| Optimization | Mechanism |
| :--- | :--- |
| **Temp file cleanup** | Removes `maestro-app*.apk` and `maestro-server*.apk` from `/tmp` before/after runs |
| **Swappiness reduction** | Sets `vm.swappiness=10` to reduce aggressive swapping |
| **Docker memory limit** | Container capped at 2GB RAM + 2GB swap via `--memory` / `--memory-swap` |
| **JVM heap cap** | Direct mode uses `-Xmx1g -Xms256m` via `JAVA_OPTS` |

> [!WARNING]
> **Avoid `maestro studio`** during long test runs. The GUI mode consumes significantly more memory than the CLI. Always use `maestro test` (which the script does automatically).

### Maestro Flows

| Flow | Analogous Jest Test | What It Verifies |
| :--- | :--- | :--- |
| `auth_login.yaml` | `Login.test.tsx` | Sign In/Up, email/password, Google button, error states |
| `navigation_tabs.yaml` | `Navigation.test.tsx` | All 4 tab buttons present and navigable |
| `swiping_discovery.yaml` | `Swiping.test.tsx` | Swipe buttons, empty state |
| `profiles_list.yaml` | `Profiles.test.tsx` | Profile list, "Forge New Identity" button |
| `profile_creation.yaml` | `ProfileCreation.test.tsx` | Form inputs, gender selection, image slots |
| `messages_inbox.yaml` | `Messages.test.tsx` | Screen title, loading/content |
| `account_logout.yaml` | `Account.test.tsx` | Logout button, sign-out → auth redirect |

### Helper Flows
- `helpers/auth_login_helper.yaml`: Reusable sub-flow that logs in with `root@tavernswiper.com` / `Password123!`. Other flows import it via `runFlow`.
