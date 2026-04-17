# Holistic Implementation Plan: Python to Go Microservice Migration

This document serves as a standard operating procedure (SOP) and template for migrating existing Python (FastAPI) services to Go (Gin) within the Tavern Swiper ecosystem.

## 🎯 Objective
To migrate services from Python to Go to improve cold-start performance and execution efficiency while maintaining **100% behavioral and structural parity**.

---

## 🏗 The 5-Phase Migration Strategy

### Phase 0: The "Oracle" Bolstering (Python)
Before writing any Go code, the existing Python service must be treated as the "Oracle" (Source of Truth).
1.  **Gap Analysis**: Identify all existing API endpoints and their edge cases (4xx, 5xx).
2.  **Contract Hardening**: Add unit tests to the Python service to cover every branch.
3.  **Snapshot Generation**: Use `syrupy` to capture JSON response bodies.
    - *Why:* Catch subtle differences like `null` vs `[]` that Go's type system handles differently.

### Phase 1: Go Scaffolding
Set up the service skeleton with a focus on testability.
1.  **Go Init**: `go mod init <module_path>`.
2.  **Mocking Layer**: Define interfaces for all external dependencies (Firebase, Firestore).
3.  **CI/CD Transition**: Create a `cloudbuild.yaml` that supports the new environment naming scheme (`{service}-{env}`).

### Phase 2: Red Test Porting (Go)
1.  **Table-Driven Tests**: Port the Python test cases to Go `handlers_test.go`.
2.  **Failure Mode**: Run tests and confirm they FAIL (reaching the Red state).

### Phase 3: Green Implementation (Go)
1.  **Gin Handlers**: Implement the logic to fulfill the handlers.
2.  **Error Parity**: Ensure error messages and status codes match the Python Oracle 1:1.
3.  **JWT Parity**: Replicate custom JWT claim logic (e.g., role-based access).

### Phase 4: Snapshot Parity Verification
1.  **JSON Match**: Compare the Go JSON output against the Python Snapshots generated in Phase 0.
2.  **Resilience Check**: Manually verify that the Go service handles network timeouts and external service outages identically to the Python version.

### Phase 5: Cutover & Cleanup
1.  **Local Dev**: Update `docker-compose.yml` to point to the new Go service directory.
2.  **Deployment**: Deploy to the `{service}-dev` Firestore/Cloud Run instance.
3.  **Decommission**: Remove the legacy Python directory after production stability is verified.

---

## ⚠️ Common Pitfalls & Lessons Learned

### JSON Discrepancies
- **Empty Slices**: In Go, an uninitialized slice `[]string` marshals to `null`.
- **Solution**: Always initialize slices with `make([]string, 0)` or use pointer types only when `null` is explicitly expected.

### Validation Errors (422)
- **Difference**: FastAPI (Pydantic) produces complex validation error arrays.
- **Decision**: For the Auth migration, we opted for a simplified Go-native 422 format for developer sanity, but other services may require stricter parity depending on frontend consumption.

### Database Naming
- **Standard**: All new Go services must look up the database name using the `{service}-{env}` pattern to ensure isolation.

---

## 📊 Auth Service Case Study
- **Python Complexity**: 8,600 lines of original logic.
- **Go Parity**: Reached 100% parity across 25 core test cases.
- **Verification**: Verified using root `.venv` snapshots and Go table-driven unit tests.
