# Clear and Test Development Environment

This workflow resets the `dev` environment (including Firebase Auth) and runs the integration tests against the cloud `dev` environment.

## Steps

1.  **Clear System Data (Dev)**: Purge all Firestore collections, GCS buckets, and Firebase Auth users in the `dev` environment.
    ```bash
    .venv/bin/python3 scripts/clear_system.py dev --clear-firebase
    ```

2.  **Run Integration Tests (Cloud Dev)**: Execute the integration test suite against the live cloud services.
    ```bash
    bash tests/run_integration_tests.sh
    ```

## Verification

-   Ensure the clear script finishes with `🏁 Direct system purge complete!`.
-   Ensure the test script finishes with `🏁 Tests passed successfully in cloud-dev mode!`.
