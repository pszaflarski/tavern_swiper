# Next Steps: Nightshade Witches Seeding & BigQuery CDC Reconciliation

This document outlines the next steps for finalizing the Nightshade Witches bots and implementing the BigQuery CDC-based cache reconciliation loop.

---

## 1. Nightshade Witches Implementation Steps

Now that their configuration is staged in the seeding CSV, the following steps must be completed to bring them to life in the application:

### Step A: Seed the Database
When ready to create the profiles, run the seeding and authentication scripts on the target environment (e.g., `dev` or `test`):
```bash
# 1. Register the "villagers" bot user and create profiles
.venv/bin/python3 scripts/seed_bots.py dev

# 2. Grant 'bot' user type to the villagers account in Firestore users
.venv/bin/python3 scripts/update_bot_user_types.py dev
```

### Step B: Implement LangGraph Agent Files
Create three new agent files in `services/agent_router/agents/` defining their system prompts and tools:
1. **`morgathra.py` (Morgathra Nightshade):**
   * **System Prompt:** Focuses on secrets, quiet narration, and mysterious lore.
   * **Tools:** Bind standard quest tools (`get_my_checkpoints`, `complete_checkpoint`) to make her a Quest Holder.
2. **`azara.py` (Azara Nightshade):**
   * **System Prompt:** High-energy, explosive, protective.
   * **Tools:** Standard conversation tools (and any future combat/action tools).
3. **`lilithra.py` (Lilithra Nightshade):**
   * **System Prompt:** Elusive, quiet, trickster-oriented.
   * **Tools:** Bind standard quest tools and custom stealth/information tools.

### Step C: Register Agents
Add the new agents to `KNOWN_AGENTS` in [agent_registry.py](file:///home/peter/Documents/tavern_swiper/services/agent_router/agent_registry.py):
```python
KNOWN_AGENTS: dict[str, str] = {
    ...
    "morgathra": "agents.morgathra",
    "azara": "agents.azara",
    "lilithra": "agents.lilithra",
}
```

---

## 2. BigQuery CDC Cache Reconciliation Plan

To ensure eventual consistency of Firestore caches without paying for expensive scans in Firestore, we will implement an hourly reconciliation worker using BigQuery CDC.

### Step A: Configure Firestore CDC
Enable the official Firebase `firestore-bigquery-export` extension for:
* **Source collections:** `profiles` (profiles database) and `matches` (discovery database).
* **Cache collections:** `profiles_profiles_cache` (discovery database) and `discovery_matches_cache` (messages database).

### Step B: Build the Hourly Reconciliation Worker
Deploy a Cloud Run job scheduled via Cloud Scheduler to run every hour.

1. **Reconciliation Query:**
   The worker executes a SQL query on BigQuery that:
   * Deduplicates the raw CDC logs to get the latest state of each document using window functions:
     ```sql
     QUALIFY ROW_NUMBER() OVER(PARTITION BY document_id ORDER BY timestamp DESC) = 1
     ```
   * Performs a `FULL OUTER JOIN` between the deduplicated Source table and Cache table.
   * Checks for mismatches (missing cache entries, stale payload fields, or deleted profiles/matches still present in the cache).
   * Filters out updates made within the last 30 minutes to allow the normal Pub/Sub event pipeline time to settle.

2. **Trigger Correction Endpoint:**
   * For every mismatched document ID found, the worker calls the target service's secure admin endpoint (e.g., `POST /profiles/admin/reconcile-cache` or `POST /messages/admin/reconcile-cache`).
   * The API endpoint fetches the source document from its own Firestore database and forces a write/overwrite of the cache record (or performs a deletion if the source is deleted). Since writes/deletes by ID do not require custom queries, they bypass missing Firestore indexes.
