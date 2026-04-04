import { test, expect } from '@playwright/test';
import * as path from 'path';

// Relative from frontend/e2e → ../../sample_profiles/
const SAMPLE_IMAGE = path.resolve(__dirname, '../../sample_profiles/1f2ee97a-1bce-4da8-abe8-e5ae8c429868.jpg');

test.describe('Profile Preview', () => {
  
  test('New Hero forge → Preview Hero → Dismiss', async ({ page }) => {
    const email = `preview-test-${Date.now()}@example.com`;
    const pwd = 'Password123!';

    await page.goto('/auth');
    await page.waitForURL('/auth');
    await page.waitForLoadState('networkidle');
    
    // Wait for the auth form to render
    await expect(page.getByTestId('auth-submit-button').filter({ visible: true })).toBeVisible({ timeout: 20000 });

    // Switch to Signup if in Login mode using robust check
    const signInTitle = page.getByText(/^Sign In$/i).first();
    const signUpTitle = page.getByText(/Begin Your Quest/i).first();

    // Wait for the UI to settle in either state before checking visibility
    await expect(signInTitle.or(signUpTitle)).toBeVisible({ timeout: 10000 });

    if (await signInTitle.isVisible()) {
      await page.getByTestId('auth-toggle-link').filter({ visible: true }).click();
      await expect(signUpTitle).toBeVisible({ timeout: 10000 });
    }
    
    await page.getByPlaceholder('hero@realm.com', { exact: true }).filter({ visible: true }).fill(email);
    await page.getByPlaceholder('••••••••', { exact: true }).filter({ visible: true }).fill(pwd);

    // Click signup and wait for the Firebase auth response
    const signupResponse = page.waitForResponse(
      response => response.url().includes('identitytoolkit.googleapis.com') && response.request().method() === 'POST',
      { timeout: 15000 }
    );
    await page.getByTestId('auth-submit-button').filter({ visible: true }).click();
    await signupResponse;

    // The auth screen doesn't auto-redirect, so navigate to the main app explicitly
    await page.waitForTimeout(1000); // Wait for user record creation to complete
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 2. Wait for Tavern empty state
    await expect(page.getByText('The Tavern is Empty').filter({ visible: true })).toBeVisible({ timeout: 30000 });

    // 3. Navigate to Profiles/Forge
    await page.getByTestId('forge-identity-button').filter({ visible: true }).click();
    await page.getByTestId('forge-new-identity-button').filter({ visible: true }).click();

    // 4. Fill in some hero details
    const heroName = 'Sir Preview';
    const heroClass = 'Knight';
    const heroTagline = 'Noble and True.';
    const heroRealm = 'Camelot';

    await page.getByTestId('identity-name-input').filter({ visible: true }).fill(heroName);
    await page.getByTestId('identity-bio-input').filter({ visible: true }).fill('Born from a test script.');
    await page.getByTestId('identity-class-input').filter({ visible: true }).fill(heroClass);
    await page.getByTestId('identity-tagline-input').filter({ visible: true }).fill(heroTagline);
    await page.getByTestId('identity-realm-input').filter({ visible: true }).fill(heroRealm);

    // 5. Upload a portrait
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      page.getByTestId('identity-image-slot-0').filter({ visible: true }).click(),
    ]);
    await fileChooser.setFiles(SAMPLE_IMAGE);
    await page.locator('[data-testid="identity-image-slot-0"] img').filter({ visible: true }).waitFor({ state: 'visible', timeout: 15000 });

    // 6. Click "Preview Hero"
    await page.getByTestId('identity-preview-button').filter({ visible: true }).click({ force: true });

    // 7. Verify the preview modal title
    await expect(page.getByTestId('preview-header-title').filter({ visible: true })).toBeVisible({ timeout: 15000 });

    // 8. Verify hero data is visible
    await expect(page.getByText(heroName).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(heroClass).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(heroTagline).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(`📍 ${heroRealm}`).filter({ visible: true })).toBeVisible();

    // 9. Dismiss via close button
    const closeBtn = page.getByTestId('close-preview-button').filter({ visible: true }).first();
    await closeBtn.scrollIntoViewIfNeeded();
    await closeBtn.dispatchEvent('click', { force: true });

    // 10. Verify we are back in the forge
    await expect(page.getByTestId('preview-header-title')).toBeHidden();
    await expect(page.getByText('New Hero').filter({ visible: true })).toBeVisible();
  });
});
