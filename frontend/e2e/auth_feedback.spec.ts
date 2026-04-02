import { test, expect } from '@playwright/test';

test.describe('Auth Feedback and Toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth');
    await page.waitForLoadState('networkidle');
    
    // Use .filter({ visible: true }) to handle Expo Router's dual-screen rendering
    await expect(page.getByTestId('auth-submit-button').filter({ visible: true })).toBeVisible({ timeout: 15000 });
  });

  test('shows error message on failed login', async ({ page }) => {
    const emailInput = page.getByPlaceholder('hero@realm.com', { exact: true }).filter({ visible: true });
    await emailInput.fill('wrong_user@example.com');
    await page.getByPlaceholder('••••••••', { exact: true }).filter({ visible: true }).fill('wrong_password');
    await page.getByRole('button', { name: /Enter Tavern/i }).filter({ visible: true }).click();

    const errorText = page.getByTestId('auth-error-text').filter({ visible: true });
    await expect(errorText).toBeVisible({ timeout: 15000 });
    
    const textContent = await errorText.textContent();
    expect(textContent?.length).toBeGreaterThan(0);
  });

  test('toggles password visibility', async ({ page }) => {
    const passwordInput = page.getByPlaceholder('••••••••', { exact: true }).filter({ visible: true });
    const toggleButton = page.getByTestId('auth-password-toggle').filter({ visible: true });

    // Initial state check - should be password
    await expect(passwordInput).toHaveAttribute('type', 'password', { timeout: 10000 });

    // Click toggle to reveal - should NO LONGER be password
    await toggleButton.click();
    await expect(passwordInput).not.toHaveAttribute('type', 'password', { timeout: 10000 });

    // Click toggle to hide again
    await toggleButton.click();
    await expect(passwordInput).toHaveAttribute('type', 'password', { timeout: 10000 });
  });

  test('clears error message when user starts typing', async ({ page }) => {
    const emailInput = page.getByPlaceholder('hero@realm.com', { exact: true }).filter({ visible: true });
    const passwordInput = page.getByPlaceholder('••••••••', { exact: true }).filter({ visible: true });
    const submitBtn = page.getByRole('button', { name: /Enter Tavern/i }).filter({ visible: true });

    await emailInput.fill('bad@example.com');
    await passwordInput.fill('pass');
    await submitBtn.click();

    const errorText = page.getByTestId('auth-error-text').filter({ visible: true });
    await expect(errorText).toBeVisible({ timeout: 15000 });

    // Start typing to clear error
    await emailInput.pressSequentially(' more text', { delay: 50 });
    await expect(errorText).not.toBeVisible();
  });
});
