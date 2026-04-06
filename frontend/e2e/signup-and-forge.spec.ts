import { test, expect, BrowserContext, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import axios from 'axios';

const USERS_SERVICE_URL = process.env.EXPO_PUBLIC_USERS_URL || 'http://localhost:8006';
const PROFILES_SERVICE_URL = process.env.EXPO_PUBLIC_PROFILES_URL || 'http://localhost:8002';
const SWIPES_SERVICE_URL = process.env.EXPO_PUBLIC_SWIPES_URL || 'http://localhost:8004';

const SAMPLE_IMAGES = [
  path.resolve(__dirname, '../../sample_profiles/1f2ee97a-1bce-4da8-abe8-e5ae8c429868.jpg'),
  path.resolve(__dirname, '../../sample_profiles/2bbfac57-b369-1ad6-edc7-d7fc29b9c651.jpeg'),
];

/**
 * Signs up a new user via the auth screen.
 * Handles toggling to signup mode, filling credentials, submitting,
 * and navigating to the main app after signup.
 */
async function signupUser(page: Page, email: string, password: string) {
  await page.goto('/auth');
  await page.waitForURL('/auth');
  await page.waitForLoadState('networkidle');

  // Wait for the auth form to render
  await expect(page.getByTestId('auth-submit-button')).toBeVisible({ timeout: 20000 });

  // Switch to Signup if in Login mode using robust check
  const signInTitle = page.getByText(/^Sign In$/i).first();
  const signUpTitle = page.getByText(/Begin Your Quest/i).first();

  // Wait for the UI to settle in either state before checking visibility
  await expect(signInTitle.or(signUpTitle)).toBeVisible({ timeout: 10000 });

  if (await signInTitle.isVisible()) {
    await page.getByTestId('auth-toggle-link').first().click();
    await expect(signUpTitle).toBeVisible({ timeout: 10000 });
  }

  await page.getByPlaceholder('hero@realm.com', { exact: true }).first().fill(email);
  await page.getByPlaceholder('••••••••', { exact: true }).first().fill(password);

  // Click signup and wait for Firebase auth response
  const signupResponse = page.waitForResponse(
    response => response.url().includes('identitytoolkit.googleapis.com') && response.request().method() === 'POST',
    { timeout: 15000 }
  );
  await page.getByTestId('auth-submit-button').first().click();
  await signupResponse;

  console.log('[signupUser] Signup successful, waiting for structural sentinel (Tavern Home)...');

  await expect(async () => {
    // Structural check: Wait for the Tavern screen container to mount
    await expect(page.getByTestId('tavern-screen').or(page.getByTestId('tavern-empty-state'))).toBeVisible({ timeout: 10000 });
  }).toPass({ timeout: 40000, intervals: [2000, 5000] });
}

async function forgeIdentity(page: Page, heroName: string) {

  await page.getByTestId('forge-identity-button').first().click();
  await page.getByTestId('forge-new-identity-button').first().click();

  await page.locator('[data-testid="identity-name-input"]').first().fill(heroName);
  await page.locator('[data-testid="identity-bio-input"]').first().fill(`${heroName}'s lore for verification.`);

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    page.getByTestId('identity-image-slot-0').first().click(),
  ]);
  await fileChooser.setFiles(SAMPLE_IMAGES[0]);

  await expect(page.locator('[data-testid="identity-image-slot-0"] img').first()).toBeAttached({ timeout: 15000 });

  const [fileChooser2] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    page.getByTestId('identity-image-slot-1').first().click(),
  ]);
  await fileChooser2.setFiles(SAMPLE_IMAGES[1]);

  await expect(page.locator('[data-testid="identity-image-slot-1"] img').first()).toBeAttached({ timeout: 15000 });

  await page.getByTestId('identity-save-button').first().click();

  console.log('[forgeIdentity] Profile saved, waiting for redirect to Profiles List...');
  await expect(page.getByTestId('profiles-screen')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('profile-card-name').first()).toContainText(heroName, { timeout: 15000 });
}

test.describe('Tavern Swiper Integration Flow', () => {

  test('Signup, Forge Profile, Swipe, and Verify Match via REST API', async ({ browser }) => {
    const timestamp = Date.now();
    const emailA = `hero-a-${timestamp}@example.com`;
    const emailB = `hero-b-${timestamp}@example.com`;
    const pwd = 'Password123!';
    let tokenA = '';

    // ---- 1. SETUP USER A ----
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();

    pageA.on('request', request => {
      const headers = request.headers();
      if (headers['authorization']?.startsWith('Bearer ')) {
        tokenA = headers['authorization'].replace('Bearer ', '');
      }
    });

    await signupUser(pageA, emailA, pwd);
    await forgeIdentity(pageA, 'Sir Playwright');
    console.log('✅ User A identity forged');

    // ---- 2. SETUP USER B ----
    const contextB = await browser.newContext();
    try {
      const pageB = await contextB.newPage();
      let tokenB = '';

      pageB.on('request', request => {
        const headers = request.headers();
        if (headers['authorization']?.startsWith('Bearer ')) {
          tokenB = headers['authorization'].replace('Bearer ', '');
        }
      });

      await signupUser(pageB, emailB, pwd);
      await forgeIdentity(pageB, 'Madam E2E');
      console.log('✅ User B identity forged');

      // ---- 3. USER A SWIPES RIGHT ON USER B ----
      console.log('Polling for User B in User A\'s feed...');
      await expect(async () => {
        const currentUrl = pageA.url();
        if (currentUrl.includes('/auth')) {
          console.log('User A got bounced to /auth, navigating back to /');
          await pageA.goto('/');
          await pageA.waitForLoadState('networkidle');
        } else {
          await pageA.reload();
          await pageA.waitForLoadState('networkidle');
        }
        await expect(pageA.getByText(/Madam E2E/i).first()).toBeVisible({ timeout: 5000 });
      }).toPass({ timeout: 45000, intervals: [3000, 5000] });

      console.log('Seeking target and Swiping Right (User A -> User B)...');
      await expect(async () => {
        const topCardName = await pageA.getByTestId('profile-card-name').first().textContent().catch(() => null);
        if (topCardName && topCardName.includes('Madam E2E')) {
          await Promise.all([
            pageA.waitForResponse(r => r.url().includes('/swipes') && r.status() === 201, { timeout: 10000 }),
            pageA.getByTestId('swipe-right-button').first().click(),
          ]);
          return;
        } else if (topCardName && topCardName.trim().length > 0) {
          console.log(`Top card is ${topCardName}, swiping left to dismiss...`);
          await Promise.all([
            pageA.waitForResponse(r => r.url().includes('/swipes') && r.status() === 201, { timeout: 10000 }),
            pageA.getByTestId('swipe-left-button').first().click(),
          ]);
          throw new Error('Not the target yet');
        } else {
          console.log('Deck empty. Reloading to fetch indexed profiles...');
          await pageA.reload();
          await pageA.waitForLoadState('networkidle');
          throw new Error('Waiting for cards to populate');
        }
      }).toPass({ timeout: 30000, intervals: [500, 1000] });
      console.log('✅ User A swiped right');

      // ---- 4. USER B SWIPES RIGHT ON USER A ----
      console.log('Polling for User A in User B\'s feed...');
      await expect(async () => {
        const currentUrl = pageB.url();
        if (currentUrl.includes('/auth')) {
          console.log('User B got bounced to /auth, navigating back to /');
          await pageB.goto('/');
          await pageB.waitForLoadState('networkidle');
        } else {
          await pageB.reload();
          await pageB.waitForLoadState('networkidle');
        }
        await expect(pageB.getByText(/Sir Playwright/i).first()).toBeVisible({ timeout: 5000 });
      }).toPass({ timeout: 45000, intervals: [3000, 5000] });

      console.log('Seeking target and Swiping Right (User B -> User A)...');
      await expect(async () => {
        const topCardName = await pageB.getByTestId('profile-card-name').first().textContent().catch(() => null);
        if (topCardName && topCardName.includes('Sir Playwright')) {
          await Promise.all([
            pageB.waitForResponse(r => r.url().includes('/swipes') && r.status() === 201, { timeout: 10000 }),
            pageB.getByTestId('swipe-right-button').first().click(),
          ]);
          return;
        } else if (topCardName && topCardName.trim().length > 0) {
          console.log(`Top card is ${topCardName}, swiping left to dismiss...`);
          await Promise.all([
            pageB.waitForResponse(r => r.url().includes('/swipes') && r.status() === 201, { timeout: 10000 }),
            pageB.getByTestId('swipe-left-button').first().click(),
          ]);
          throw new Error('Not the target yet');
        } else {
          console.log('Deck empty. Reloading to fetch indexed profiles...');
          await pageB.reload();
          await pageB.waitForLoadState('networkidle');
          throw new Error('Waiting for cards to populate');
        }
      }).toPass({ timeout: 30000, intervals: [500, 1000] });
      console.log('✅ User B swiped right');

      // ---- 5. MATCH VERIFICATION ----
      expect(tokenA).not.toBe('');
      console.log(`[DEBUG] Using Token A: ${tokenA.substring(0, 15)}...`);
      const headersA = { Authorization: `Bearer ${tokenA}` };

      const userAResp = await axios.get(`${USERS_SERVICE_URL}/users/me`, { headers: headersA });
      console.log(`[DEBUG] User A UID: ${userAResp.data.uid}`);
      const profilesResp = await axios.get(`${PROFILES_SERVICE_URL}/profiles/user/${userAResp.data.uid}`, { headers: headersA });
      const profileA_id = profilesResp.data[0]?.profile_id;
      console.log(`[DEBUG] Profile A ID: ${profileA_id}`);
      expect(profileA_id).toBeDefined();

      await expect.poll(async () => {
        try {
          const matchResp = await axios.get(`${SWIPES_SERVICE_URL}/swipes/matches/${profileA_id}`, { headers: headersA });
          console.log(`🔍 Polling matches for profile ${profileA_id}: Response data: ${JSON.stringify(matchResp.data)}`);
          const matchesList = Array.isArray(matchResp.data) ? matchResp.data : (matchResp.data.matches || []);
          return matchesList.length > 0;
        } catch (e: any) {
          console.log(`⚠️ Match poll error: ${e.message}`);
          return false;
        }
      }, { timeout: 60000, intervals: [2000, 5000] }).toBeTruthy();
      console.log('✅ Match verified successfully!');
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
