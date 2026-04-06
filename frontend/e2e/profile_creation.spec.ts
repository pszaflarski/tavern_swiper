import { test, expect, BrowserContext, Page } from '@playwright/test';
import path from 'path';

test.describe('Hero Forge Flow', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    // Zero-Trust Browser Context Isolation
    context = await browser.newContext();
    page = await context.newPage();
    
    // resilient goto
    await expect(async () => {
      const response = await page.goto('/');
      expect(response?.ok()).toBeTruthy();
    }).toPass({ timeout: 30000 });

    // Login if needed
    try {
      await page.getByTestId('auth-email-input').waitFor({ state: 'visible', timeout: 10000 });
      await page.getByTestId('auth-email-input').fill('user@example.com');
      await page.getByTestId('auth-password-input').fill('Password123!');
      await page.getByTestId('auth-submit-button').click();
    } catch (e) {
      console.log('Already logged in or login screen skipped.');
    }

    // Wait for tavern as home base
    await expect(page.getByTestId('tavern-screen').last()).toBeVisible();
  });

  test.afterEach(async () => {
    await context.close();
  });

  test('should forge a new hero with 6 images and verify in archives', async () => {
    const heroName = `Antigravity Hero ${Date.now()}`;
    
    // 1. Navigate to Forge
    await page.goto('/profiles/create_and_edit');
    await expect(page.getByTestId('profile-name-input')).toBeVisible();

    // 2. Fill Identity
    await page.getByTestId('profile-name-input').fill(heroName);
    await page.getByTestId('profile-tagline-input').fill('The Agent of Automation');
    await page.getByTestId('profile-bio-input').fill('Forged in the silicon fires of DeepMind to solve any quest.');
    
    // 3. Select Gender
    await page.getByTestId('profile-gender-Other').click();

    // 4. Upload 6 Images (using hidden test sentinel)
    const assetPath = path.join(__dirname, 'assets', 'test_hero.png');
    // We upload 6 files at once to the hidden input
    await page.setInputFiles('input[data-testid="hidden-image-upload"]', [
      assetPath, assetPath, assetPath, assetPath, assetPath, assetPath
    ]);

    // 5. Verify images are reflected in UI (filled slots)
    for (let i = 0; i < 6; i++) {
      await expect(page.getByTestId(`profile-image-filled-${i}`)).toBeVisible();
    }

    // 6. Forge Identity (Save)
    await page.getByTestId('profile-forge-button').click();

    // 7. Verify navigation to Profiles Archives
    // The screen calls router.back(), which should take us to the previous screen or tavern.
    // However, the user asked to check /profiles, so we will navigate there.
    await page.goto('/profiles');
    
    // 8. Find the newly forged hero
    await expect(page.getByTestId(`profile-name-${heroName}`)).toBeVisible();
    
    console.log(`Hero "${heroName}" successfully forged and verified in archives.`);
  });
});
