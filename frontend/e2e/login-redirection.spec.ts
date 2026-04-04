import { test, expect } from '@playwright/test';

test.describe('Login Redirection Stability', () => {
  test('redirects from /auth to / without Root Layout errors', async ({ page }) => {
    const consoleErrors: string[] = [];

    // Listen for console errors, specifically searching for the Expo Router mount error
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`[BROWSER ERROR] ${msg.text()}`);
        if (msg.text().includes('Attempted to navigate before mounting the Root Layout component')) {
          consoleErrors.push(msg.text());
        }
      }
    });

    // 1. Navigate to auth page
    await page.goto('/auth');
    await page.waitForLoadState('networkidle');

    // 2. Perform Signup (to ensure user exists and redirect happens)
    const email = `test-redir-${Date.now()}@example.com`;
    const password = 'Password123!';

    // Switch to Signup if in Login mode using robust check
    const signInTitle = page.getByText(/^Sign In$/i).first();
    const signUpTitle = page.getByText(/Begin Your Quest/i).first();
    
    // Wait for the UI to settle in either state before checking visibility
    await expect(signInTitle.or(signUpTitle)).toBeVisible({ timeout: 10000 });

    if (await signInTitle.isVisible()) {
      await page.getByTestId('auth-toggle-link').filter({ visible: true }).click();
      await expect(signUpTitle).toBeVisible({ timeout: 10000 });
    }

    const emailInput = page.getByPlaceholder('hero@realm.com', { exact: true }).filter({ visible: true });
    const pwdInput = page.getByPlaceholder('••••••••', { exact: true }).filter({ visible: true });

    await emailInput.fill(email);
    await pwdInput.fill(password);

    // Click signup and wait for Firebase auth response
    const signupResponse = page.waitForResponse(
      response => response.url().includes('identitytoolkit.googleapis.com') && response.request().method() === 'POST',
      { timeout: 15000 }
    );
    await page.getByTestId('auth-submit-button').filter({ visible: true }).click();
    await signupResponse;

    // 3. Wait for redirection to the main tab (/)
    await expect(page).toHaveURL(/\/$/, { timeout: 20000 });

    // 4. Verify no critical navigation errors occurred
    expect(consoleErrors, `Detected Expo Router mount error during redirection: ${consoleErrors[0]}`).toHaveLength(0);

    // 5. Verify we are actually in the Tavern (check for BottomNav or a Tab item)
    await expect(page.getByTestId('bottom-nav')).toBeVisible({ timeout: 10000 });
  });
});
