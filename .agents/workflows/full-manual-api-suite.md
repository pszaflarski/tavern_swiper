---
description: Run manual browser-based API tests against the cloud dev environment. Includes full environment reset, admin bootstrap, profile seeding, and edge case validation via Swagger UI.
---
# Manual Browser Tests (Cloud Dev)

This workflow performs a full environment reset, seeds sample data, then walks through manual API verification via the Swagger UI in the browser. Default target: **dev** cloud environment.

> [!CAUTION]
> This workflow clears ALL data in the target environment (Firestore + Firebase Auth + GCS). Only run against `dev` or `test`.

---

## Phase 1: Environment Reset (Clear → Admin → Seed)

// turbo-all

### Step 1: Clear System Data (Firestore + Firebase Auth + GCS)
```bash
.venv/bin/python3 scripts/clear_system.py dev --clear-firebase
```

### Step 2: Bootstrap Root Admin
```bash
.venv/bin/python3 scripts/create_root_admin.py dev
```

### Step 3: Seed Sample Profiles
```bash
.venv/bin/python3 scripts/seed_profiles.py dev
```

---

## Phase 2: Discover Service URLs

### Step 4: Fetch Cloud Run URLs via Router
```bash
gcloud run services describe router-dev --platform managed --region us-central1 --project tavern-swiper-dev --format 'value(status.url)'
```

Save the router URL, then query it for all service URLs:
```bash
curl -sf "<ROUTER_URL>/router/services" | python3 -m json.tool
```

The output gives you the base URLs for all services. The Swagger UIs are at:
- **Auth**: `<auth_url>/auth/swagger/index.html`
- **Users**: `<users_url>/users/swagger/index.html`
- **Profiles**: `<profiles_url>/profiles/swagger/index.html`
- **Discovery**: `<discovery_url>/discovery/swagger/index.html`
- **Messages**: `<messages_url>/messages/swagger/index.html`

---

## Phase 3: Manual Browser Tests

Open each Swagger UI in the browser and execute the following test cases. For authenticated endpoints, use the Tavern JWT from Step 2 (the `Bearer <token>` printed by `create_root_admin.py`).

### Test 1: Health Checks (All Services)
**Goal**: Verify all 5 services are alive and responding.

| Service | Endpoint | Expected |
|---------|----------|----------|
| Auth | `GET /auth/health` | `200 OK` |
| Users | `GET /users/health` | `200 OK` |
| Profiles | `GET /profiles/health` | `200 OK` |
| Discovery | `GET /discovery/health` | `200 OK` |
| Messages | `GET /messages/health` | `200 OK` |

### Test 2: Auth — Login as Seeded User
**Goal**: Verify seeded credentials work and return valid tokens.

1. `POST /auth/login` with `{"email": "user1@example.com", "password": "Password123!"}`
   - Expected: `200 OK` with `id_token` and `uid`
2. `POST /auth/verify` with the returned `id_token`
   - Expected: `200 OK` with a `token` (Tavern JWT)
3. Save this token — it belongs to **Valerius the Bold**.

### Test 3: Auth — Login as Admin
**Goal**: Verify admin credentials and elevated role.

1. `POST /auth/login` with `{"email": "root@tavernswiper.com", "password": "Password123!"}`
2. `POST /auth/verify` with the `id_token`
   - Expected: JWT with `role: root_admin`

### Test 4: Users — Self-Lookup
**Goal**: Verify token carries correct identity.

1. `GET /users/me` with Valerius's Bearer token
   - Expected: `200 OK`, body contains `email: user1@example.com`

### Test 5: Profiles — List All (Admin)
**Goal**: Verify admin-only endpoint and seeded profile count.

1. `GET /profiles/all` with **root admin** Bearer token
   - Expected: `200 OK`, array with **19 profiles** (from CSV: 19 data rows, some users have 2 profiles)
2. `GET /profiles/all` with **Valerius's** Bearer token
   - Expected: `403 Forbidden` — non-admins blocked

### Test 6: Profiles — Get Active Profile
**Goal**: Verify active profile auto-selection.

1. `GET /profiles/user/me/active` with Valerius's token
   - Expected: `200 OK`, `display_name: "Valerius the Bold"`, `is_active: true`
   - Verify `image_urls` contains at least 1 URL (6 images were seeded for Valerius)

### Test 7: Profiles — Multi-Profile User (user2@example.com)
**Goal**: Verify users with multiple profiles can list and switch.

1. Login as `user2@example.com` / `Password123!` (verify → get token)
2. `GET /profiles/user/me` with that token
   - Expected: Array with 2 profiles: **Elara Brightsoul** and **Sylvana Moonwhisper**
3. Pick the non-active profile's ID, call `POST /profiles/<id>/set_active`
   - Expected: `200 OK`, the previously inactive profile is now active
4. `GET /profiles/user/me/active` — should return the newly activated profile

### Test 8: Profiles — Image Public Accessibility
**Goal**: Verify GCS images are publicly downloadable (catches IAM regressions).

1. From Test 6 or `GET /profiles/<valerius_id>`, grab one URL from `image_urls`
2. Open that URL directly in a new browser tab (NO auth header)
   - Expected: Image loads successfully. If 403 → bucket IAM is broken.

### Test 9: Profiles — Gender Tags
**Goal**: Verify tag system works end-to-end.

1. `GET /profiles/tags/by-category/gender` (with any auth token)
   - Expected: Array of tags including `Female`, `Male`, `Non-binary`
2. `POST /profiles/tags/` with root admin token: `{"category": "gender", "name": "Genderfluid"}`
   - Expected: `201 Created` with `status: "active"` (admin-created tags are auto-active)
3. `POST /profiles/tags/` with Valerius's token: `{"category": "fandom", "name": "Dragonlance"}`
   - Expected: `201 Created` with `status: "pending"` and `suggested_by` set

### Test 10: Discovery — Feed
**Goal**: Verify the discovery feed excludes the requesting user's own profiles.

1. Login as `kaelen@example.com` (Kaelen Duskwood)
2. `GET /discovery/feed/<kaelen_profile_id>`
   - Expected: Array of profiles, **none** with `display_name: "Kaelen Duskwood"`
   - Should contain other seeded profiles (after Pub/Sub propagation)

### Test 11: Discovery — Swipe and Match
**Goal**: Verify mutual swipe creates a match.

1. Use **Kaelen's** token: `POST /discovery/swipe/` with `{"swiper_profile_id": "<kaelen_id>", "swiped_profile_id": "<seraphina_id>", "direction": "right"}`
   - Expected: `200 OK`, `match: false` (one-sided)
2. Login as `seraphina@example.com`, swipe right on Kaelen: `POST /discovery/swipe/` with `{"swiper_profile_id": "<seraphina_id>", "swiped_profile_id": "<kaelen_id>", "direction": "right"}`
   - Expected: `200 OK`, `match: true`, `match_id` present
3. `GET /discovery/matches/profile/<kaelen_id>` with Kaelen's token
   - Expected: Array containing the match with Seraphina

### Test 12: Messages — Conversation Lifecycle
**Goal**: Verify matched users can message each other.

1. Wait ~5s for match cache propagation to the messages service
2. Use Kaelen's token: `POST /messages/conversations` with `{"participant_profile_ids": ["<kaelen_id>", "<seraphina_id>"]}`
   - Expected: `200` or `201` with `conversation_id`
3. `POST /messages/conversations/<conv_id>/messages` with `{"sender_profile_id": "<kaelen_id>", "content": "Greetings from the shadows!"}`
   - Expected: `200 OK`
4. Use Seraphina's token: `GET /messages/conversations/<conv_id>/messages`
   - Expected: Array with 1 message, content = "Greetings from the shadows!"
5. Reply as Seraphina: `POST /messages/conversations/<conv_id>/messages` with `{"sender_profile_id": "<seraphina_id>", "content": "The stars foretold our meeting!"}`

### Test 13: Messages — Unauthorized Sender (Edge Case)
**Goal**: Verify non-participants cannot send messages.

1. Login as `garrick@example.com` (Garrick Bloodbane — NOT in the conversation)
2. `POST /messages/conversations/<conv_id>/messages` with `{"sender_profile_id": "<garrick_id>", "content": "I shouldn't be here"}`
   - Expected: `403 Forbidden`

### Test 14: Discovery — Left Swipe Exclusion (Edge Case)
**Goal**: Verify left-swiped profiles don't reappear in the feed.

1. Use Kaelen's token: `POST /discovery/swipe/` with `{"swiper_profile_id": "<kaelen_id>", "swiped_profile_id": "<garrick_id>", "direction": "left"}`
2. `GET /discovery/feed/<kaelen_id>` — poll several times
   - Expected: Garrick Bloodbane **never** appears in the results

### Test 15: Auth — Invalid Token (Edge Case)
**Goal**: Verify services reject garbage tokens.

1. Call `GET /profiles/user/me` with `Authorization: Bearer totally-fake-token`
   - Expected: `401 Unauthorized`
2. Call `GET /users/me` with the same fake token
   - Expected: `401 Unauthorized`

### Test 16: Profiles — Soft Delete and Restore (Edge Case)
**Goal**: Verify admin can soft-delete a user and restore them.

1. Root admin: `DELETE /users/<garrick_uid>` 
   - Expected: `200 OK` with soft-deleted user record
2. `GET /users/me` with Garrick's token
   - Expected: `403` or `404` (user is soft-deleted)
3. Root admin: `PATCH /users/<garrick_uid>/restore`
   - Expected: `200 OK` with restored user
4. `GET /users/me` with Garrick's token
   - Expected: `200 OK` — user is back

### Test 17: Profiles — Create Profile Rejects String Gender (Edge Case)
**Goal**: Verify API enforces array-of-ProfileTag for gender field.

1. `POST /profiles/` with any auth token: `{"display_name": "Bad Gender", "gender": "Male"}`
   - Expected: `422 Unprocessable Entity`

### Test 18: Profiles — Batch Fetch (Edge Case)
**Goal**: Verify batch endpoint handles mixed valid/invalid IDs gracefully.

1. Gather 2 real profile IDs from Test 5
2. `POST /profiles/batch` with `{"profile_ids": ["<real_id_1>", "<real_id_2>", "non-existent-id"]}`
   - Expected: `200 OK`, array with exactly 2 profiles (invalid ID silently excluded)

---

## Phase 4: Verification Summary

After completing all tests, verify:
- [ ] All 5 health endpoints returned `200`
- [ ] Auth login/register/verify flow works for seeded users
- [ ] Admin-only endpoints correctly block regular users (403)
- [ ] Seeded profiles appear with correct data and images
- [ ] Multi-profile switching works
- [ ] Images are publicly accessible via GCS URLs
- [ ] Tag creation respects admin vs user roles
- [ ] Discovery feed excludes self and left-swiped profiles
- [ ] Mutual match triggers match creation
- [ ] Messages flow works between matched participants
- [ ] Unauthorized message sending is blocked
- [ ] Invalid tokens are rejected across all services
- [ ] Soft-delete and restore user lifecycle works
- [ ] Batch endpoints handle invalid IDs gracefully
