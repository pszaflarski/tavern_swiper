# Production Environment Safety Rules

To prevent accidental data loss or configuration errors in the production environment, the following rules MUST be followed by the AI assistant.

## 1. Environment Isolation
- **No Batching**: Never combine production changes with `dev` or `test` changes in a single command or task.
- **Separate Planning**: If a feature needs to be deployed to all environments, the production phase must be a separate, distinct step in the implementation plan.

## 2. Explicit Permission
- **Consent per Action**: Even if a user has approved a general "fix all environments" plan, each specific modification to a production resource (Firestore, Cloud Run, GCS, etc.) requires an explicit "Yes, proceed with Prod" from the user immediately before execution.
- **Verification**: Before modifying production, verify that the same change has already been successfully verified in `test`.

## 3. Mandatory Warnings
- Every response that includes a production-modifying command MUST start with the following warning:
  > [!CAUTION]
  > **⚠️ WARNING: The following actions will modify the PRODUCTION environment.**

## 4. Specific Resource Rules
- **Firestore**: Never delete a production database without a verified backup and a "Double Yes" from the user.
- **Triggers**: Ensure production triggers use distinct secrets and are never accidentally updated with dev/test credentials.
