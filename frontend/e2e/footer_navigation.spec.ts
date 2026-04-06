import { test, expect, BrowserContext, Page } from '@playwright/test';

test.describe('Footer Navigation', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    // Rule 59: Zero-Trust Browser Context Isolation
    context = await browser.newContext();
    page = await context.newPage();
    
    // Resilient goto to handle Expo dev server cold starts
    await expect(async () => {
      const response = await page.goto('/');
      expect(response?.ok()).toBeTruthy();
    }).toPass({ timeout: 30000 });

    // Login if needed
    try {
      await page.getByTestId('auth-email-input').waitFor({ state: 'visible', timeout: 5000 });
      await page.getByTestId('auth-email-input').fill('user@example.com');
      await page.getByTestId('auth-password-input').fill('Password123!');
      await page.getByTestId('auth-submit-button').click();
    } catch (e) {
      console.log('Already logged in or login screen failed to load.');
    }

    // Wait for tavern screen (initial land)
    // Rule 66: Sentinel-Based Transitions
    await expect(page.getByTestId('tavern-screen').first()).toBeVisible();
  });

  test.afterEach(async () => {
    await context.close();
  });

  test('should navigate between Tavern and Profiles using the footer tabs', async () => {
    // 1. We are already on Tavern (verified in beforeEach)
    
    // 2. Click on Profiles tab in footer
    const profilesTab = page.getByTestId('tab-bar-profiles');
    await profilesTab.click();
    
    // 3. Verify Profiles screen is visible
    // Rule 66: Use unique testID Sentinel for transitions
    await expect(page.getByTestId('profiles-screen').first()).toBeVisible();
    
    // 4. Click back to Tavern tab in footer
    const tavernTab = page.getByTestId('tab-bar-tavern');
    await tavernTab.click();
    
    // 5. Verify Tavern screen is visible
    await expect(page.getByTestId('tavern-screen').first()).toBeVisible();
    
    console.log('Successfully navigated using footer tabs.');
  });
});
