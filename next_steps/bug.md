# Integration Test Bugs

Two integration tests fail consistently in both `dev` and `prod` environments.

---

## Bug 1: Messages Inbox Returns Empty for Conversation Participant

**Failing test:** `test_messages_flow.py::test_full_conversation_lifecycle` — Step 3

**Reproduction:**
1. Register Hero A and Hero B, create profiles, match them via mutual right swipes
2. Hero A initiates a conversation → 201 ✅
3. Hero A sends a message → 201 ✅
4. Hero B fetches their inbox via `GET /messages/conversations/profile/{hero_b_profile_id}` → 200, but **returns empty list**
5. Test asserts the conversation should appear in Hero B's inbox → **FAILS**

**Observed behavior:**
- The conversation is successfully created
- Messages are sent successfully
- Hero B's inbox query returns `200 []` — the conversation is not found

**Expected behavior:**
- Hero B's inbox should contain the conversation with `last_message` populated

**Likely cause:**
The `ProfileConversation` mapping (which maps a profile ID to its conversations) may not be created for Hero B when Hero A initiates the conversation. The messages service likely only creates the mapping for the initiator, not both participants.

**Relevant code:**
- `services/messages/messages_go/handlers.go` — conversation creation handler
- `services/messages/messages_go/` — inbox query handler (`GET /messages/conversations/profile/:profile_id`)

---

## Bug 2: Batch Profile Fetch Returns Empty

**Failing test:** `test_profiles_api.py::test_batch_profile_fetch`

**Reproduction:**
1. Register two users, create profiles `p1`, `p2` (user 1) and `p3` (user 2)
2. `POST /profiles/batch` with `{"profile_ids": [p1, p2, p3, "non-existent-id"]}`
3. Response: `200 []` — **empty list**

**Observed behavior:**
- All three profiles are created successfully (201)
- Batch fetch returns `200` with an empty array `[]`

**Expected behavior:**
- Should return the 3 existing profiles and silently skip `"non-existent-id"`

**Likely cause:**
The batch endpoint's Firestore query may be using the wrong database ID, wrong collection name, or an incorrect query pattern (e.g., `__name__ IN [...]` vs iterating individual doc gets). Since individual profile operations work fine, this is isolated to the batch code path.

**Relevant code:**
- `services/profiles/profiles_go/handlers.go` — `handleBatchGetProfiles` or equivalent handler
