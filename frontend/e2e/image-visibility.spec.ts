import { test, expect, BrowserContext, Page } from '@playwright/test';
import * as path from 'path';

const SAMPLE_IMAGE = path.join(__dirname, '../../sample_profiles/1f2ee97a-1bce-4da8-abe8-e5ae8c429868.jpg');

/**
 * Signs up a new user via the auth screen.
 */
async function signupUser(page: Page, email: string, password: string) {
  console.log(`[signupUser] Navigating to /auth for ${email}`);

  // Standard Playwright isolation is handled via Contexts. 
  // No manual localStorage.clear() is needed if using fresh contexts.
  await page.goto('/auth');
  await page.waitForLoadState('networkidle');

  // Wait for the auth form to render
  const submitBtn = page.getByRole('button', { name: /Claim Your Title|Enter Tavern/i });
  await submitBtn.waitFor({ state: 'visible', timeout: 30000 });

  // Switch to Signup if in Login mode
  const signInTitle = page.getByText(/^Sign In$|^Login$/i).first();
  if (await signInTitle.isVisible()) {
    console.log('[signupUser] Switching to Signup mode');
    await page.getByTestId('auth-toggle-link').first().click();
    await expect(page.getByText(/Begin Your Quest|Sign Up/i, { exact: false }).first()).toBeVisible({ timeout: 15000 });
  }

  await page.getByPlaceholder('hero@realm.com', { exact: true }).first().fill(email);
  await page.getByPlaceholder('••••••••', { exact: true }).first().fill(password);

  console.log('[signupUser] Submitting auth form');
  const signupResponse = page.waitForResponse(
    response => response.url().includes('identitytoolkit.googleapis.com') && response.request().method() === 'POST',
    { timeout: 20000 }
  );
  await submitBtn.click();
  await signupResponse;

  console.log('[signupUser] Signup successful, waiting for auto-redirection to Tavern...');
  console.log('[signupUser] Signup successful, waiting for structural sentinel (Tavern Home)...');

  // Wait for the URL to settle on / (handling app-level redirects naturally)
  await expect(page).toHaveURL(/\/$/, { timeout: 30000 });
  await expect(async () => {
    const currentUrl = page.url();
    if (currentUrl.includes('/auth')) {
      console.log('[signupUser] Still on /auth, attempting explicit navigation to /...');
      await page.goto('/');
      await page.waitForLoadState('networkidle');
    }
    // Structural check: Wait for the Tavern screen container to mount
    await expect(page.getByTestId('tavern-screen').or(page.getByTestId('tavern-empty-state'))).toBeVisible({ timeout: 10000 });
  }).toPass({ timeout: 40000, intervals: [2000, 5000] });

  // Wait for either the empty state or the tavern feed to confirm session is ready
  await expect(
    page.getByText(/The Tavern is Empty/i)
      .or(page.getByText(/Identity Required/i))
      .or(page.getByText(/⚔️/i))
  ).toBeVisible({ timeout: 20000 });

  console.log(`[signupUser] ${email} successfully logged in`);

  // Wait for React to mount and user context to sync the UID, then log it
  const currentUid = await page.evaluate(async () => {
    // Access Firebase Auth directly from the Window to get the current UID
    const baseAuth = (window as any).Firebase_Auth_Instance;
    if (baseAuth && baseAuth.currentUser) return baseAuth.currentUser.uid;
    return 'UID_NOT_FOUND';
  }).catch((e) => `EVAL_ERROR: ${e.message}`);
  console.log(`[signupUser] ${email} UID: ${currentUid}`);
}

/**
 * Creates a profile with a sample image.
 */
async function forgeIdentity(page: Page, heroName: string) {
  console.log(`[forgeIdentity] Starting profile creation for ${heroName}`);

  // Go to profiles tab if not there
  if (!(await page.getByTestId('profiles-screen').isVisible())) {
    console.log('[forgeIdentity] Navigating to Profiles tab');
    await page.getByText('Profiles').click();
    await page.waitForURL(url => url.pathname.includes('profiles'));
  }

  const forgeBtn = page.getByTestId('forge-identity-button').first();
  const forgeNewBtn = page.getByTestId('forge-new-identity-button').first();

  if (await forgeBtn.isVisible()) {
    console.log('[forgeIdentity] Clicking Forge Your Identity (Empty State)');
    await forgeBtn.click();
  } else {
    console.log('[forgeIdentity] Clicking Forge New Identity (List State)');
    await forgeNewBtn.click();
  }

  await expect(page.locator('[data-testid="identity-name-input"]').first()).toBeVisible({ timeout: 15000 });
  await page.locator('[data-testid="identity-name-input"]').first().fill(heroName);
  await page.locator('[data-testid="identity-bio-input"]').first().fill(`Lores of ${heroName}.`);

  console.log('[forgeIdentity] Selecting portal for image upload...');
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }),
    page.getByTestId('identity-image-slot-0').first().click(),
  ]);
  await fileChooser.setFiles(SAMPLE_IMAGE);

  // Wait for preview to show it's uploaded
  console.log('[forgeIdentity] Waiting for image preview...');
  await page.locator('[data-testid="identity-image-slot-0"] img').first().waitFor({ state: 'attached', timeout: 20000 });

  console.log('[forgeIdentity] Saving profile...');
  const savePromise = page.waitForResponse(
    response => response.url().includes('/profiles') && ['POST', 'PUT'].includes(response.request().method()),
    { timeout: 15000 }
  ).catch(() => console.log('[forgeIdentity] Warning: Profiles save response not intercepted in time.'));

  await page.getByTestId('identity-save-button').first().click();
  await savePromise;

  await expect(page.getByTestId('profiles-screen')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('profile-card-name').first()).toContainText(heroName, { timeout: 15000 });
  console.log(`[forgeIdentity] ${heroName} successfully forged.`);
}

test.describe('Image Visibility Cross-User Validation', () => {

  test('User B should see User A\'s profile image in the discovery feed', async ({ browser }) => {
    test.setTimeout(180000); // 3 minute timeout for this complex test

    const timestamp = Date.now();
    const emailA = `hero-a-${timestamp}@example.com`;
    const emailB = `hero-b-${timestamp}@example.com`;
    const pwd = 'Password123!';
    const nameA = `Sir Visibility ${timestamp.toString().slice(-4)}`;
    const nameB = `Madam Validator ${timestamp.toString().slice(-4)}`;

    // ---- 1. SETUP USER A (The Profiler) ----
    console.log('--- Setting up User A ---');
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    pageA.on('console', msg => console.log(`USER A CONSOLE: ${msg.text()}`));

    await signupUser(pageA, emailA, pwd);
    await forgeIdentity(pageA, nameA);
    console.log('✅ User A identity forged with image');

    // Switch to Tavern and back to ensure state consistency
    await pageA.getByTestId('bottom-nav').getByText('Tavern').click();
    console.log('✅ User A ready, Discovery indexing will be verified by User B');

    // ---- 2. SETUP USER B (The Discoverer) ----
    console.log('--- Setting up User B ---');
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    pageB.on('console', msg => console.log(`USER B CONSOLE: ${msg.text()}`));

    try {
      await signupUser(pageB, emailB, pwd);
      await forgeIdentity(pageB, nameB);
      console.log('✅ User B identity forged');

      // Verify User B's own identity in header to confirm session isolation
      console.log('--- Verifying User B Isolation ---');
      await expect(pageB.getByText(nameB).first()).toBeVisible({ timeout: 15000 });
      console.log('✅ User B session isolated (Header shows Madam Validator)');

      // Strategy A: Network Interception for the image URL
      console.log('--- Strategy A: Network Validation ---');
      // We start the listener BEFORE clicking "Tavern" to catch the early Fetch/Image load
      const imageRequestPromise = pageB.waitForResponse(
        resp => resp.url().includes('storage.googleapis.com') &&
          resp.url().includes('/profiles/') &&
          resp.status() === 200,
        { timeout: 30000 }
      );

      console.log('--- Navigation to Tavern & Polling for Discovery Indexing ---');
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
        await expect(pageB.getByTestId('tavern-screen').or(pageB.getByTestId('tavern-empty-state'))).toBeVisible({ timeout: 5000 });
      }).toPass({ timeout: 30000, intervals: [3000, 5000] });

      console.log(`Seeking User A (${nameA}) in User B's feed...`);
      await expect(async () => {
        const topCardName = await pageB.getByTestId('profile-card-name').first().textContent().catch(() => null);
        if (topCardName && new RegExp(nameA, 'i').test(topCardName)) {
          return; // Target found
        } else if (topCardName && topCardName.trim().length > 0) {
          console.log(`Top card is ${topCardName}, swiping left to dismiss...`);
          const swipePromise = pageB.waitForResponse(r => r.url().includes('/swipes') && r.status() === 201, { timeout: 10000 }).catch(() => { });
          await pageB.getByTestId('swipe-left-button').first().click();
          await swipePromise;
          throw new Error('Not the target yet');
        } else {
          console.log('Feed is empty or target not found. Reloading feed...');
          await pageB.reload();
          await pageB.waitForLoadState('networkidle');
          throw new Error('Waiting for Discovery to index target profile');
        }
      }).toPass({ timeout: 45000, intervals: [1000, 2000] });

      // Verify the hero image component is present
      const heroImageWrapper = pageB.getByTestId('discovery-hero-image').first();
      await expect(heroImageWrapper).toBeVisible({ timeout: 20000 });

      // Locate the inner img tag and ensure it's in the DOM, but DO NOT assert visual visibility
      // React Native Web often hides the img tag and shows a background-image instead.
      const heroImageImg = heroImageWrapper.locator('img').first();
      await expect(heroImageImg).toBeAttached({ timeout: 10000 });

      const response = await imageRequestPromise;
      console.log(`✅ Strategy A Passed: Image loaded with status ${response.status()} from ${response.url().substring(0, 50)}...`);

      // ---- 4. VERIFY VIA DOM DECODING ----
      console.log('--- Strategy B: DOM Image Decoding Validation ---');

      // Wait for image to be fully loaded in DOM using the specific <img> tag
      await heroImageImg.evaluate(async (img: HTMLImageElement) => {
        if (img.complete && img.naturalWidth > 0) return;
        if (img.complete && img.naturalWidth === 0) throw new Error('Image already failed to load in DOM');

        return new Promise((resolve, reject) => {
          img.onload = () => resolve(true);
          img.onerror = () => reject(new Error('Image failed to load in DOM'));
          // Set a timeout for the load event
          setTimeout(() => reject(new Error('Image load timed out in DOM')), 20000);
        });
      });

      const { isImageRendered, naturalWidth, naturalHeight } = await heroImageImg.evaluate((img: HTMLImageElement) => {
        return {
          isImageRendered: img.complete && img.naturalWidth > 0,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight
        };
      });

      expect(isImageRendered).toBeTruthy();
      expect(naturalWidth).toBeGreaterThan(0);

      console.log(`✅ Strategy B Passed: Image rendered successfully (${naturalWidth}x${naturalHeight}px)`);

    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

});
