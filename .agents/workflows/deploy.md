# Deployment Workflow

Follow this procedure to ensure stable, zero-trust deployments. Always perform these steps sequentially per environment, starting with `test`, and then repeating the process for `dev`.

## Deployment Cycle (Repeat per Environment: test -> dev)

### 1. Test Backend (Local)
Ensure all services pass tests locally before cloud deployment.
```bash
./services/run_tests.sh
```

### 2. Deploy Backend
Deploy latest backend changes.
```bash
# Deploys both test- and dev- prefixed services
./scripts/deploy_to_cloud_run.sh 
```

### 3. Test Backend Integration
Run tests designed to verify cross-service communication in the cloud environment.
```bash
# Note: ensure internal test runners are configured for the target environment
./tests/run_integration_tests.sh
```

### 4. Test Frontend (Jest)
Run frontend unit and hook tests to validate UI logic.
```bash
cd frontend && npm test && cd ..
```

### 5. Deploy Frontend
Deploy the latest frontend build.
```bash
./scripts/deploy_frontend.sh
```

