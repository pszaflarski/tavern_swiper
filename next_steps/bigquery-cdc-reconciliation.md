# Next Steps: BigQuery CDC Cache Reconciliation Plan

This document outlines the design and implementation steps for an hourly cache reconciliation loop using BigQuery CDC. This ensures eventual consistency of Firestore database caches without costly cross-database Firestore scans.

---

## 1. Architecture Overview

To ensure that the cached profile/match data in secondary databases matches the source databases:
1. **Firestore CDC Export:** Enable the Firestore-to-BigQuery CDC export extension.
2. **BigQuery Reconciliation Query:** Deduplicate logs and detect mismatches using SQL window functions.
3. **Hourly Worker:** A Cloud Run job triggered by Cloud Scheduler calls correction API endpoints on mismatched document IDs.

```
+------------------+
|    Firestore     | (Source DBs: profiles, discovery)
+------------------+
        |
        | 1. CDC Export (Firebase Extension)
        v
+------------------+
|     BigQuery     | (Deduplicate & join against caches)
+------------------+
        |
        | 2. Detect mismatches (Hourly Job)
        v
+------------------+
|  Reconciliation  | 3. Call Admin endpoints (e.g. POST /admin/reconcile-cache)
|      Worker      | -------------------------------------------+
+------------------+                                            |
                                                                v
                                                     +--------------------+
                                                     | Firestore Caches   |
                                                     | (discovery_db,     |
                                                     |  messages_db)      |
                                                     +--------------------+
```

---

## 2. Implementation Steps

### Step A: Configure Firestore CDC
Enable the official Firebase `firestore-bigquery-export` extension for:
* **Source collections:** `profiles` (profiles database) and `swipes` / `matches` (discovery database).
* **Cache collections:** `profiles_profiles_cache` (discovery database) and `discovery_matches_cache` (messages database).

### Step B: Build the Hourly Reconciliation Worker
Deploy a Cloud Run job scheduled via Cloud Scheduler to run every hour.

#### 1. Reconciliation Query
The worker executes a SQL query on BigQuery that:
* Deduplicates the raw CDC logs to get the latest state of each document:
  ```sql
  QUALIFY ROW_NUMBER() OVER(PARTITION BY document_id ORDER BY timestamp DESC) = 1
  ```
* Performs a `FULL OUTER JOIN` between the deduplicated Source table and Cache table.
* Checks for mismatches (missing cache entries, stale payload fields, or deleted profiles/matches still present in the cache).
* Filters out updates made within the last 30 minutes to allow the normal Pub/Sub event pipeline time to settle.

#### 2. Trigger Correction Endpoint
* For every mismatched document ID found, the worker calls the target service's secure admin endpoint (e.g., `POST /profiles/admin/reconcile-cache` or `POST /messages/admin/reconcile-cache`).
* The API endpoint fetches the source document from its own Firestore database and forces a write/overwrite of the cache record (or performs a deletion if the source is deleted). Since writes/deletes by ID do not require custom queries, they bypass missing Firestore indexes.
