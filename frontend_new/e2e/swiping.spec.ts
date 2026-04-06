import { test, expect, BrowserContext, Page } from '@playwright/test';

test.describe('Swiping Flow', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    // Rule 59: Zero-Trust Browser Context Isolation
    context = await browser.newContext();
    page = await context.newPage();
    // Resilient goto to handle Expo dev server cold starts or connection timeouts
    await expect(async () => {
      const response = await page.goto('/');
      expect(response?.ok()).toBeTruthy();
    }).toPass({ timeout: 30000 });

    // Rule 61: Account for Firebase Auth persistence delays
    // We check if we are on login screen and log in if needed
    try {
      // Increase timeout for cold starts on auth screen
      await page.getByTestId('auth-email-input').waitFor({ state: 'visible', timeout: 15000 });
      await page.getByTestId('auth-email-input').fill('user@example.com');
      await page.getByTestId('auth-password-input').fill('Password123!');
      await page.getByTestId('auth-submit-button').click();
    } catch (e) {
      // If email input not found within 5s, assume we're already logged in or on tavern
      console.log('Login screen not detected, proceeding to tavern check.');
    }

    // Rule 66: Use Sentinels for Transition
    await expect(async () => {
      await expect(page.getByTestId('tavern-screen').first()).toBeVisible();
    }).toPass();
  });

  test.afterEach(async () => {
    await context.close();
  });

  test('should skip a profile and show next (swipe left button)', async () => {
    // Rule 65: Use last() to target top-most element in card decks (due to reverse DOM stacking)
    const firstName = await page.getByTestId('profile-card-name').last().textContent();
    
    await page.getByTestId('swipe-left-button').click();

    // Rule 58: Polling with toPass
    await expect(async () => {
      const nextName = await page.getByTestId('profile-card-name').last().textContent();
      expect(nextName).not.toBe(firstName);
    }).toPass({ timeout: 10000 });
  });

  test('should like a profile and show next (swipe right button)', async () => {
    const firstName = await page.getByTestId('profile-card-name').last().textContent();

    await page.getByTestId('swipe-right-button').click();

    await expect(async () => {
      const nextName = await page.getByTestId('profile-card-name').last().textContent();
      expect(nextName).not.toBe(firstName);
    }).toPass({ timeout: 10000 });
  });

  test('should skip a profile by dragging left (gesture)', async () => {
    const firstName = await page.getByTestId('profile-card-name').last().textContent();
    const card = page.getByTestId('profile-card').last();
    const box = await card.boundingBox();
    if (!box) throw new Error('Could not find card bounding box');

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height * 0.3; // Drag from top area to avoid footer text

    const viewport = page.viewportSize();
    if (!viewport) throw new Error('Could not get viewport size');

    // Wait for profile to load (sentinel: swipe button becomes enabled)
    await expect(page.getByTestId('swipe-left-button')).toBeEnabled();

    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    // Drag to the absolute left edge (X=0) to ensure threshold is crossed
    await page.mouse.move(0, centerY, { steps: 20 }); 
    await page.mouse.up();

    await expect(async () => {
      const nextName = await page.getByTestId('profile-card-name').last().textContent();
      expect(nextName).not.toBe(firstName);
    }).toPass({ timeout: 10000 });
  });

  test('should like a profile by dragging right (gesture)', async () => {
    const firstName = await page.getByTestId('profile-card-name').last().textContent();
    const card = page.getByTestId('profile-card').last();
    const box = await card.boundingBox();
    if (!box) throw new Error('Could not find card bounding box');

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height * 0.3;

    const viewport = page.viewportSize();
    if (!viewport) throw new Error('Could not get viewport size');

    // Wait for profile to load (sentinel: swipe button becomes enabled)
    await expect(page.getByTestId('swipe-left-button')).toBeEnabled();

    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    // Drag to the absolute right edge (X=viewport.width) to ensure threshold is crossed
    await page.mouse.move(viewport.width, centerY, { steps: 20 }); 
    await page.mouse.up();

    await expect(async () => {
      const nextName = await page.getByTestId('profile-card-name').last().textContent();
      expect(nextName).not.toBe(firstName);
    }).toPass({ timeout: 10000 });
  });
});
