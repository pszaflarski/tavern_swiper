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

## 3. Frontend Unit Tests (Jest)

The frontend uses Jest and React Native Testing Library.

### Running Frontend Tests
```bash
cd frontend
npm test
```

> [!NOTE]
> `npm` and `node` are expected to be available in the local environment. If they are not in your global path, ensure your local development environment (e.g., NVM) is initialized.

### Test Coverage
Frontend tests cover:
- Login and authentication flows
- Profile creation, editing, and portfolio navigation
- Swiping and discovery (including infinite scroll)
- Messaging and conversations
- Optimistic UI updates
- Backoff/resilience behavior
- Data freshness integration
- UI snapshots

### Key Testing Patterns
- **Provider Mocking**: Components relying on global state (e.g., `useQueryClient` or `ActiveProfileContext`) must be rendered with a custom wrapper providing fresh instances of those contexts to avoid cross-test cache pollution.
- **UI Anchors**: The Discovery screen (`index.tsx`) provides `swipe-left-button` and `swipe-right-button` `testIDs` for reliable interaction testing.

## 4. Integration Tests

Integration tests verify end-to-end flows between multiple services.

### Running Integration Tests
```bash
# Locally (requires Docker)
bash tests/run_go_integration_tests.sh --local

# Against Cloud (Dev environment)
bash tests/run_go_integration_tests.sh

# Cloud integration tests
bash tests/run_cloud_integration_tests.sh
```

> [!WARNING]
> **Resource Usage**: Running full integration tests locally can be resource-intensive and may cause Out-of-Memory (OOM) errors on systems with limited RAM. Using the Cloud Dev environment is recommended for large test suites.

## 5. Mobile UI Tests (Maestro) — *Planned*

Native mobile automation for React Native.
- **What it will do**: Simulate real touch interactions on an Android/iOS emulator and verify UI elements.
- **Scripts**: `tests/run_maestro_tests.sh` and `tests/run_cloud_maestro_tests.sh` exist but full test suites are still being developed.
