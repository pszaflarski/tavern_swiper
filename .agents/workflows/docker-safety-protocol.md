# Docker Safety Protocol

This workflow ensures that the agent NEVER runs Docker-based commands or resource-intensive local tests without explicit, per-task permission from the user.

## Pre-Check Ritual

Before running any command involving `docker`, `docker-compose`, or `bash tests/run_integration_tests.sh --local`:

1.  **Stop and Reflect**: Does this command involve Docker?
2.  **Check Permission**: Did the user explicitly say "Yes, run Docker" or "Yes, run local integration tests" in the CURRENT task?
3.  **Evaluate OOM Risk**: Am I on a resource-constrained system (like a remote agent environment)?
4.  **Confirm Alternatives**: Can this be run against the cloud environment instead? (e.g., `bash tests/run_integration_tests.sh` without `--local`).

## Execution Rules

1.  **MANDATORY CLARIFICATION**: If the user says "run integration tests" without a flag, ALWAYS assume cloud-based tests (default) and NEVER add `--local` unless asked.
2.  **EXPLICIT CONSENT**: If you think a local run is necessary, you MUST warn the user:
    > [!CAUTION]
    > Running integration tests locally via Docker risks Out-Of-Memory (OOM) errors and system instability. Should I proceed or run against the cloud environment?
3.  **CLEANUP**: If you do run Docker, always run `docker compose -f <file> down` immediately if a failure occurs or when finished.
