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
    if (context) {
      await context.close();
    }
  });

  test('should forge a new hero, alter their path, and cast them into the void', async () => {
    test.setTimeout(120000); // Extended for full lifecycle
    const heroName = `Hero ${Math.random().toString(36).substring(7)}`;
    const alteredName = `${heroName} the Redeemed`;
    
    // 1. FORGE (Create)
    await page.goto('/profiles/create_and_edit');
    await page.getByTestId('profile-name-input').fill(heroName);
    await page.getByTestId('profile-tagline-input').fill('The Agent of Automation');
    await page.getByTestId('profile-bio-input').fill('Forged in silicon fires.');
    await page.getByTestId('profile-gender-Other').click();

    // Upload initial images
    const assetPath = path.join(__dirname, 'assets', 'test_hero.png');
    await page.setInputFiles('input[data-testid="hidden-image-upload"]', [assetPath, assetPath]);
    
    await page.getByTestId('profile-forge-button').click();

    // 2. VERIFY & NAVIGATE TO ARCHIVES
    await page.goto('/profiles');
    await expect(page.getByTestId(`profile-name-${heroName}`)).toBeVisible();
    
    // 3. ALTER (Edit)
    // Find the profile card containing this hero and click its edit button
    await page.getByLabel(`Edit ${heroName} profile`).click();
    
    // Verify currently in edit mode
    await expect(page.getByTestId('profile-name-input')).toHaveValue(heroName);
    
    // Update Identity
    await page.getByTestId('profile-name-input').clear();
    await page.getByTestId('profile-name-input').fill(alteredName);
    await page.getByTestId('profile-tagline-input').clear();
    await page.getByTestId('profile-tagline-input').fill('The Redeemed Hero');
    
    // Remove existing images
    const removeButtons = page.getByLabel(/Remove image .*/);
    const removeCount = await removeButtons.count();
    for (let i = 0; i < removeCount; i++) {
        await removeButtons.first().click();
    }
    
    // Add 1 new image
    await page.setInputFiles('input[data-testid="hidden-image-upload"]', [assetPath]);
    
    // Confirm Alteration
    await page.getByTestId('profile-forge-button').click();
    
    // 4. VERIFY ALTERATION IN ARCHIVES
    // The app naturally navigates back to /profiles after editing
    await expect(page.getByTestId(`profile-name-${alteredName}`)).toBeVisible();
    await expect(page.getByTestId(`profile-name-${heroName}`)).not.toBeVisible();

    // 5. VOID (Delete)
    // Handle the browser confirm dialog
    page.once('dialog', async dialog => {
      console.log(`Confirming deletion dialog: ${dialog.message()}`);
      await dialog.accept();
    });
    
    console.log(`Initiating deletion for hero: ${alteredName}`);
    await page.getByLabel(`Delete ${alteredName} profile`).click();
    
    // 6. FINAL VERIFICATION
    // Increase timeout for deletion to reflect in list
    await expect(page.getByTestId(`profile-name-${alteredName}`)).not.toBeVisible({ timeout: 20000 });
    
    console.log(`Full lifecycle verified for hero: ${heroName} -> ${alteredName} -> Voided.`);
  });
});
