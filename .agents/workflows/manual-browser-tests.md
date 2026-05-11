---
description: Reset the dev environment, seed data, then log in through the React Native frontend in the browser to verify the app works end-to-end.
---
# Manual Browser Tests (Cloud Dev)

This workflow resets the dev environment, seeds sample data, starts the Expo web frontend, and performs end-to-end browser verification across multiple user accounts.

For the comprehensive API-level Swagger test suite, use `/full-manual-api-suite` instead.

> [!CAUTION]
> This workflow clears ALL data in the dev environment (Firestore + Firebase Auth + GCS).

---

## Phase 1: Environment Reset (Clear → Admin → Seed)

// turbo-all

### Step 1: Clear System Data
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

## Phase 2: Verify Frontend Environment

### Step 4: Confirm frontend .env points to dev
The file `frontend/.env` should contain:
```
EXPO_PUBLIC_ROUTER_URL=https://router-dev-hhqol7siba-uc.a.run.app
```
If it doesn't, run the switch_env script:
```bash
bash scripts/switch_env.sh dev
```

### Step 5: Start the Expo web dev server
```bash
cd frontend && npx expo start --web --port 8081
```

Wait for the dev server to report `Web is waiting on http://localhost:8081`.

---

## Phase 3: Browser Tests

> [!CAUTION]
> **Browser Automation Rules — MUST be included in every browser_subagent Task prompt:**
> 1. **MANDATORY**: Always open the browser in an **Incognito window** (or equivalent clean session) to prevent interference from existing browser profiles or cached credentials.
> 2. **Best Practice**: For automated runs via `browser_subagent`, it is highly recommended to use an **isolated Chromium binary** and a **dedicated test profile path** configured in the IDE settings. This prevents state leakage and ensures consistent performance.
> 3. **After verifying the app has successfully navigated to the main screen post-login**, wait 2 seconds, then **press the Escape key** to dismiss the browser's password-save dialog. This dialog blocks all clicks on the underlying page if not dismissed.
> 3. Wait an additional 2 seconds after Escape before interacting with any UI elements.
> 4. If any click appears to not register, try pressing Escape first, then retry the click.

### Test A: Login as Standard User (Valerius the Bold)

1. Open an **Incognito window** and navigate to `http://localhost:8081`
2. Wait for the login screen to load — confirm the "Sign In" title and email/password fields are visible
3. Enter email `user1@example.com` and password `Password123!` using the `auth-email-input` and `auth-password-input` fields
4. Click the "Enter Tavern" button (`auth-submit-button`)
5. Wait for the app to navigate to the main Tavern (Discovery) tab.
6. **MANDATORY**: Once the Tavern tab is visible, wait 2 seconds, then **press Escape** to dismiss any browser password-save dialog.
7. **Verify**: App navigates successfully and remains interactive.

### Test B: Verify Discovery Feed & Profile Details (Valerius)

1. On the Tavern tab (`tavern-screen`), confirm profiles appear in the swipe deck
2. Click the info button (`profile-info-button`) to expand profile details
3. **Verify**: The details overlay (`details-overlay`) appears
4. **Verify**: The details include:
   - `display_name` (e.g., "Lyra Windrunner")
   - `bio` (e.g., "The swiftest ranger in the realm...")
   - `gender` tags if present (e.g., "Female")
5. Close the details overlay by clicking the info button again
6. **Verify**: The ✕ (left swipe) and ❤️ (right swipe) buttons are visible at the bottom

### Test C: Perform a Swipe (Valerius)

1. Click the ❤️ button (`swipe-right-button`) to swipe right on the current profile
2. **Verify**: The deck advances to the next profile (a different name/image appears)
3. Click the ✕ button (`swipe-left-button`) to swipe left on the next profile
4. **Verify**: The deck advances again — no error banner appears

### Test D: Check Profiles Tab & Own Details (Valerius)

1. Click the "Profiles" tab (`tab-bar-profiles`)
2. **Verify**: The profiles screen (`profiles-screen`) loads showing "Valerius the Bold"
3. **Verify**: The profile card shows:
   - The primary image thumbnail
   - The name "Valerius the Bold"
   - The bio snippet "A legendary knight known for his courage..."
4. **Verify**: The active profile has a checkmark badge (radio-button-on icon)
5. **Verify**: The "Forge New Identity" button is visible at the bottom

### Test E: Verify Profile Edit Form (Valerius)

1. On the Profiles tab, click the Edit button (`edit-profile-button`) for the first profile
2. **Verify**: The Profile Form (`profile-form`) loads
3. **Verify**: The following fields are pre-populated correctly:
   - **Display Name**: "Valerius the Bold"
   - **Bio**: "A legendary knight known for his courage and impeccable armor. Seeking companionship in the Tavern."
   - **Gender**: "Male" is selected
4. **Verify**: The image grid shows the 6 seeded images in their correct slots
5. Click the back button or "Cancel" to return to the list

### Test F: Check Messages Tab (Valerius)

1. Click the "Messages" tab (`tab-bar-messages`)
2. **Verify**: The inbox loads with at least one conversation (seeded between Lyra and Valerius)
3. Click on the conversation row (`inbox-item`) to open it
4. **Verify**: The conversation thread shows messages:
   - Lyra: "Greetings! I've been looking for a brave soul to join me at the Rusty Dragon. Interested?"
   - Valerius: "The Rusty Dragon? Count me in! I'll bring the map. What time are we meeting?"

### Test F: Logout (Valerius)

1. Click the "Account" tab (`tab-bar-account`)
2. **Verify**: The Account screen loads (`account-screen`)
3. Click the "Logout" button (`logout-button`)
4. **Verify**: App redirects back to the login screen with "Sign In" title visible

### Test G: Login as Multi-Profile User (Elara / Sylvana)

1. On the login screen, enter email `user2@example.com` and password `Password123!`
2. Click "Enter Tavern"
3. Wait for the app to navigate to the main screen.
4. **MANDATORY**: Once the main screen is visible, wait 2 seconds, then **press Escape** to dismiss any browser password-save dialog.
5. **Verify**: App navigates to the main screen.

### Test H: Verify Multi-Profile Switching

1. Click the "Profiles" tab (`tab-bar-profiles`)
2. **Verify**: Two profiles are listed — **Elara Brightsoul** and **Sylvana Moonwhisper**
3. **Verify**: One of them has the active checkmark badge
4. Click on the other (non-active) profile card to switch the active profile
5. **Verify**: The checkmark badge moves to the newly selected profile
6. Click the "Tavern" tab (`tab-bar-tavern`) to return to discovery
7. **Verify**: The discovery feed loads successfully (may show loading spinner briefly, then profiles)

### Test I: Verify Feed Content for Second User

1. On the Tavern tab, click the info button (`profile-info-button`)
2. **Verify**: A different set of profiles appears in the feed compared to Valerius's session (since this is a different user)
3. **Verify**: Neither "Elara Brightsoul" nor "Sylvana Moonwhisper" appear in their own feed (self-exclusion)

### Test J: Logout and Login as Admin

1. Navigate to Account tab → Logout
2. Login as `admin@example.com` / `Password123!`
3. Wait for the app to navigate to the Profiles tab.
4. **MANDATORY**: Once the Profiles tab is visible, wait 2 seconds, then **press Escape** to dismiss any browser password-save dialog.
5. Click the "Profiles" tab
5. **Verify**: Two profiles listed — **Thrain Ironfoot** and **Borin Stonehammer**
6. Click on the Tavern tab
7. **Verify**: Discovery feed loads with profiles (admins use the feed like any user)

### Test K: Final Logout

1. Navigate to Account tab → Logout
2. **Verify**: App returns to login screen
3. **Verify**: No console errors or crashed UI state

---

## Verification Checklist

### Authentication
- [ ] Login screen loads at localhost:8081
- [ ] Email/password login succeeds for `user1@example.com`
- [ ] Email/password login succeeds for `user2@example.com`
- [ ] Email/password login succeeds for `admin@example.com`
- [ ] Logout redirects to login screen each time

### Discovery
- [ ] Feed shows profiles in the swipe deck
- [ ] Info button reveals profile details (name, bio, gender)
- [ ] Right swipe (❤️) advances the deck
- [ ] Left swipe (✕) advances the deck
- [ ] No swipe error banner appears
- [ ] User's own profiles are excluded from their feed

### Profiles
- [ ] Valerius shows 1 profile with image
- [ ] user2 shows 2 profiles (Elara + Sylvana)
- [ ] admin shows 2 profiles (Thrain + Borin)
- [ ] Profile switching updates the active badge
- [ ] "Forge New Identity" button is present

### Messages
- [ ] Valerius's inbox contains a conversation with Lyra
- [ ] Conversation thread shows the seeded messages
- [ ] Messages display in correct order

### Account
- [ ] Account screen renders
- [ ] Logout button works and clears session
