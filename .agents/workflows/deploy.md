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

### 4. Test Frontend E2E (Baseline)
Run frontend E2E tests against current configuration.
```bash
./scripts/switch_env.sh <test|dev>
cd frontend && npx playwright test && cd ..
```

### 5. Deploy Frontend
Deploy the latest frontend build.
```bash
./scripts/deploy_frontend.sh
```

### 6. Final Validation (E2E vs Cloud)
Perform final E2E verification against deployed cloud assets in the current environment.
```bash
./scripts/switch_env.sh <test|dev>
cd frontend && npx playwright test && cd ..
```

---

## ⚡ Speed Tip: Rapid Iteration & Debugging
To minimize cycle time when debugging:
1.  **Point local frontend to cloud backend**: Run `./scripts/switch_env.sh <test|dev>` to point your **local** app to the cloud environment.
2.  **Use Playwright UI**: Instead of running silent tests, run:
    ```bash
    cd frontend && npx playwright test --ui
    ```
3.  **Debug**: Watch the test run in the UI, identify failures, fix your **local** code, and click "Rerun" in the UI for instant feedback without waiting for a full cloud redeploy.
