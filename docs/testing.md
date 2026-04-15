# Tavern Swiper Testing Guide

This document outlines the testing strategies and procedures for the Tavern Swiper project.

## 1. Directory Context (CRITICAL)

The project consists of multiple independent environments (Python, Node.js). You **MUST** be in the correct directory for the test runner to find the relevant configuration and source code.

| Layer | Runner | Directory |
| :--- | :--- | :--- |
| **Backend Services** | `pytest` | `services/<service-name>/` |
| **Frontend** | `npm test` | `frontend/` |
| **Integration** | `pytest` | Root `/` |

## 2. Backend Unit Tests (Python)

Each service has its own `tests/` directory.

### Running Service Tests
To run tests for a specific service:
```bash
cd services/<service-name>
PYTHONPATH=. ../../.venv/bin/pytest tests
```

### Mocking Dependencies
Backend unit tests use `respx` to mock cross-service HTTP calls and `unittest.mock` to patch Firestore/GCS clients. This ensures tests run quickly and reliably without external connectivity.

## 3. Frontend Unit Tests (Jest)

The frontend uses Jest and React Native Testing Library.

### Running Frontend Tests
```bash
cd frontend
npm test
```
> [!NOTE]
> `npm` and `node` are expected to be available in the local environment. If they are not in your global path, ensure your local development environment (e.g., NVM) is initialized.

## 4. Integration Tests

Integration tests verify the end-to-end flow between multiple services.

### Running Integration Tests
```bash
# Locally (requires Docker/Emulators)
bash tests/run_integration_tests.sh --local

# Against Cloud (Dev environment)
bash tests/run_integration_tests.sh
```

> [!WARNING]
> **Resource Usage**: Running full integration tests locally can be resource-intensive and may cause Out-of-Memory (OOM) errors on systems with limited RAM. Using the Cloud Dev environment is recommended for large test suites.
