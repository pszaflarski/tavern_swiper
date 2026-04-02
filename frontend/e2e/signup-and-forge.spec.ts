import { test, expect, BrowserContext, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
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
  await expect(page.getByTestId('auth-submit-button').filter({ visible: true })).toBeVisible({ timeout: 20000 });

  // Switch to Signup if in Login mode
  const signInTitle = page.getByText(/^Sign In$/i).filter({ visible: true }).first();
  if (await signInTitle.isVisible()) {
    await page.getByTestId('auth-toggle-link').filter({ visible: true }).click();
    await expect(page.getByText(/Begin Your Quest/i).filter({ visible: true })).toBeVisible({ timeout: 10000 });
  }

  await page.getByPlaceholder('hero@realm.com', { exact: true }).filter({ visible: true }).fill(email);
  await page.getByPlaceholder('••••••••', { exact: true }).filter({ visible: true }).fill(password);

  // Click signup and wait for Firebase auth response
  const signupResponse = page.waitForResponse(
    response => response.url().includes('identitytoolkit.googleapis.com') && response.request().method() === 'POST',
    { timeout: 15000 }
  );
  await page.getByTestId('auth-submit-button').filter({ visible: true }).click();
  await signupResponse;

  // Wait for the backend user record creation to complete
  await page.waitForTimeout(1500);

  // The auth screen doesn't auto-redirect, navigate to the main app explicitly
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Wait for Tavern empty state (new user has no profiles)
  await expect(page.getByText(/The Tavern is Empty/i).filter({ visible: true })).toBeVisible({ timeout: 30000 });
}

async function forgeIdentity(page: Page, heroName: string) {
  const visible = (selector: string) => page.locator(selector).filter({ visible: true });
  const getVisibleTestId = (testId: string) => page.getByTestId(testId).filter({ visible: true });

  await getVisibleTestId('forge-identity-button').click();
  await getVisibleTestId('forge-new-identity-button').click();
  
  await visible('[data-testid="identity-name-input"]').fill(heroName);
  await visible('[data-testid="identity-bio-input"]').fill(`${heroName}'s lore for verification.`);

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    getVisibleTestId('identity-image-slot-0').click(),
  ]);
  await fileChooser.setFiles(SAMPLE_IMAGES[0]);

  const slot0 = visible('[data-testid="identity-image-slot-0"] img');
  await slot0.waitFor({ state: 'visible', timeout: 15000 });

  const [fileChooser2] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    getVisibleTestId('identity-image-slot-1').click(),
  ]);
  await fileChooser2.setFiles(SAMPLE_IMAGES[1]);

  const slot1 = visible('[data-testid="identity-image-slot-1"] img');
  await slot1.waitFor({ state: 'visible', timeout: 15000 });

  await page.waitForTimeout(1000);
  await getVisibleTestId('identity-save-button').click();

  await expect(page.getByText(/Your Identities/i).filter({ visible: true }).first()).toBeVisible({ timeout: 15000 });
  const profileName = page.locator('[data-testid="profile-card-name"]').filter({ visible: true }).first();
  await profileName.waitFor({ state: 'visible', timeout: 10000 });
  await expect(profileName).toContainText(heroName);
}

test.describe('Tavern Swiper Integration Flow', () => {

  test('Signup, Forge Profile, Swipe, and Verify Match via REST API', async ({ browser, page }) => {
    const timestamp = Date.now();
    const emailA = `hero-a-${timestamp}@example.com`;
    const emailB = `hero-b-${timestamp}@example.com`;
    const pwd = 'Password123!';
    let tokenA = '';

    page.on('request', request => {
      const headers = request.headers();
      if (headers['authorization']?.startsWith('Bearer ')) {
        tokenA = headers['authorization'].replace('Bearer ', '');
      }
    });

    // ---- 1. SETUP USER A ----
    await signupUser(page, emailA, pwd);
    await forgeIdentity(page, 'Sir Playwright');
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
      await page.goto('/');
      await page.waitForURL('/');
      await page.waitForLoadState('networkidle');
      await expect(page.getByText(/Madam E2E/i).filter({ visible: true }).first()).toBeVisible({ timeout: 20000 });
      await Promise.all([
        page.waitForResponse(r => r.url().includes('/swipes') && r.status() === 201, { timeout: 30000 }),
        page.getByTestId('swipe-right-button').filter({ visible: true }).click(),
      ]);
      console.log('✅ User A swiped right');

      // ---- 4. USER B SWIPES RIGHT ON USER A ----
      await pageB.goto('/');
      await pageB.waitForURL('/');
      await pageB.waitForLoadState('networkidle');
      await expect(pageB.getByText(/Sir Playwright/i).filter({ visible: true }).first()).toBeVisible({ timeout: 20000 });
      await Promise.all([
        pageB.waitForResponse(r => r.url().includes('/swipes') && r.status() === 201, { timeout: 30000 }),
        pageB.getByTestId('swipe-right-button').filter({ visible: true }).click(),
      ]);
      console.log('✅ User B swiped right');

      // ---- 5. MATCH VERIFICATION ----
      expect(tokenA).not.toBe('');
      const headersA = { Authorization: `Bearer ${tokenA}` };
      const userAResp = await axios.get(`${USERS_SERVICE_URL}/users/me`, { headers: headersA });
      const profileA_id = (await axios.get(`${PROFILES_SERVICE_URL}/profiles/user/${userAResp.data.uid}`, { headers: headersA })).data[0].profile_id;

      await expect.poll(async () => {
        try {
          const matchResp = await axios.get(`${SWIPES_SERVICE_URL}/swipes/matches/${profileA_id}`, { headers: headersA });
          console.log(`🔍 Polling matches for profile ${profileA_id}: found ${matchResp.data.length}`);
          return matchResp.data.length > 0;
        } catch (e: any) { 
          console.log(`⚠️ Match poll error: ${e.message}`);
          return false; 
        }
      }, { timeout: 60000, intervals: [2000, 5000] }).toBeTruthy();
      console.log('✅ Match verified successfully!');
    } finally {
      await contextB.close();
    }
  });
});
