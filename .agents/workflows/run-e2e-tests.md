---
description: Run end-to-end tests for the Tavern Swiper frontend with multi-user match verification.
---

1. **Navigate to Frontend**: Ensure you are in the `frontend` directory.

2. **Start Expo Server**:
   > [!IMPORTANT]
   > For the most reliable and fastest E2E results, **always** ensure you have a fresh Expo server instance. Before starting the tests, check for any running Expo processes, stop them, and restart a new instance.
// turbo
Run `pkill -f expo` (to clear stale instances) then `npx expo start --web` in a persistent background terminal. Wait for the message `Web is waiting on http://localhost:8081` before proceeding.

3. **Verify Environment**:
Check `frontend/.env` to ensure `EXPO_PUBLIC_*_URL` variables point to the cloud `-test` endpoints (e.g. `https://auth-test-hhqol7siba-uc.a.run.app`).

4. **Run E2E Tests**:
// turbo
Run `npm run test:e2e` from the `frontend` directory. 

5. **Self-Heal Failures**:
   If tests fail due to "hidden" elements or timing issues:
   - Analyze `test-results` for screenshots or console logs.
   - Most transition issues in React Native Web can be fixed by adding `await locator.waitFor({ state: 'visible' })` before assertions.
   - **Image Upload**: The test uses `page.waitForEvent('filechooser')` to intercept the native OS file picker triggered by `expo-image-picker` on web and injects real sample images from `sample_profiles/`. If this fails, ensure the sample images exist at `../sample_profiles/` relative to the project root.

6. **Verify Match Sync**:
   After a successful run, confirm the console output shows:
   - `✅ Image slot 0 is populated for [hero].`
   - `✅ Match A<->B verified in Swipes API.`
   - This confirms the UI, image upload, discovery service, and swipes service are all connected.

7. **Cleanup**:
   Terminate the Expo server process when all verification is complete.
