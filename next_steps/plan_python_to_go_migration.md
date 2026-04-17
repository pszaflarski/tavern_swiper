# Holistic Implementation Plan: Python to Go Microservice Migration

This document serves as a standard operating procedure (SOP) and template for migrating existing Python (FastAPI) services to Go (Gin) within the Tavern Swiper ecosystem.

## 🎯 Objective
To migrate services from Python to Go to improve cold-start performance and execution efficiency while maintaining **100% behavioral and structural parity** using **Snapshot-Driven Verification**.

---

## 🏗 The 6-Phase Migration Strategy

### Phase 0: The "Oracle" & Snapshot Generation (Python)
Before writing any Go code, the existing Python service must be treated as the "Oracle" (Source of Truth).
1.  **Gap Analysis**: Identify all existing API endpoints and their edge cases (400, 401, 422, 500, 503).
2.  **Contract Hardening**: Add unit tests to the Python service to cover every branch.
3.  **Snapshot Generation (Syrupy)**: Use `syrupy` to capture JSON response bodies for every state.
    - **Execution:** `.venv/bin/python3 -m pytest --snapshot-update`
4.  **Snapshot Transcoding**: Convert Python `.ambr` files into a portable `snapshots.json`. 
    - **Why:** Go cannot natively parse Python's pickling format. Use a utility script (e.g., `scripts/convert_snapshots.py`) to output clean JSON.

### Phase 1: Go Scaffolding
Set up the service skeleton with a focus on testability.
1.  **Go Init**: `go mod init <module_path>`.
2.  **Interface Wrapper Pattern**: Define interfaces for all external dependencies (Firestore, Firebase).
    - **Firestore Rule:** Wrap `Client`, `Collection`, `Document`, and `Iterator` in interfaces to allow deep mocking of complex `Next()`, `GetAll()`, and `Batch()` operations.
3.  **Time Mocking Hooks**: Use a package-level `_now` function pointer (defaulting to `time.Now().UTC`) for all timestamps to allow deterministic freezing in tests.
3.  **CI/CD Transition**: Create a `cloudbuild.yaml` that supports the new environment naming scheme (`{service}-{env}`).

### Phase 2: Red Test Porting (Go)
1.  **Table-Driven Tests**: Port the Python test cases to Go `handlers_test.go`.
2.  **Failure Mode**: Run tests and confirm they FAIL (reaching the Red state).

### Phase 3: Green Implementation (Go)
1.  **Gin Handlers**: Implement the logic to fulfill the handlers.
2.  **Error Parity**: Ensure error messages and status codes match the Python Oracle 1:1.
3.  **JWT Parity**: Replicate custom JWT claim logic (e.g., role-based access).

### Phase 4: Behavioral & Structural Snapshot Verification
1.  **JSON Parity (Ground Truth)**: Compare the Go JSON output against the Python Snapshots generated in Phase 0.
2.  **Exclusion Logic**: Use comparison libraries (like `go-cmp`) to exclude dynamic fields (JWT tokens, timestamps) while enforcing exact matches on structures and nullability.
3.  **Resilience Check**: Verify that the Go service handles network timeouts and external service outages identically to the Python version.

### Phase 5: Cutover & Cleanup
1.  **Local Dev**: Update `docker-compose.yml` to point to the new Go service directory.
2.  **Deployment**: Deploy to the `{service}-dev` Firestore/Cloud Run instance.
3.  **Decommission**: Remove the legacy Python directory after production stability is verified.

---

## ⚠️ Common Pitfalls & Lessons Learned

### JSON Discrepancies
- **Empty Slices**: In Go, an uninitialized slice `[]string` marshals to `null`.
- **Solution**: Always initialize slices with `make([]string, 0)` or use pointer types only when `null` is explicitly expected (e.g., `*string`).

- **Difference**: FastAPI (Pydantic) produces complex validation error arrays with `loc`, `msg`, and `type`.
- **Requirement**: Use a custom `validationError` helper to produce 1:1 parity for the `detail` array.
- **Example**: Ensure `loc: ["body", "field_name"]` and exact error strings (e.g., `"Input should be a valid boolean"`) are matched.

### Database Naming
- **Standard**: All new Go services must look up the database name using the `{service}-{env}` pattern to ensure isolation and environment parity.

---

## 📊 Case Studies & Results

### Auth Service
- **Go Parity**: Reached 100% parity across 25 core test cases.
- **Performance**: 40% reduction in cold-start latency.

### Users Service
- **Complexity**: Ported complex self-healing Logic and Admin/Root RBAC.
- **Go Parity**: 100% parity across 21 snapshots using advanced Firestore mocks.
- **Lessons**: Highlighting the importance of `created_at` stabilization via time-mocks.
