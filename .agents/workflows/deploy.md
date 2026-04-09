# Deployment Workflow

All deployments are automated via Google Cloud Build pipelines linked to GitHub. Follow this pre-push checklist to ensure stable, zero-trust deployments.

## Pre-Push Checklist

### 1. Test Backend (Local)
Ensure all services pass tests locally before pushing.
```bash
./services/run_tests.sh
```

### 2. Test Backend Integration
Run integration tests to verify cross-service communication.
```bash
./tests/run_integration_tests.sh
```

### 3. Test Frontend (Jest)
Run frontend unit and hook tests to validate UI logic.
```bash
cd frontend && npm test && cd ..
```

### 4. Push to GitHub
Push to `main` to trigger Cloud Build pipelines for both backend and frontend.
```bash
git push origin main
```

Cloud Build will automatically:
1. Run unit tests for each changed service.
2. Build and push Docker images to GCR.
3. Deploy to Cloud Run with the appropriate environment suffix.
