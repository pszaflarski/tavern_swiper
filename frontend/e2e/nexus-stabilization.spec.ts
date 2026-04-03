import { test, expect } from '@playwright/test';

test.describe('Nexus Stabilization flows', () => {

  test('Gated Initialization, Discovery, and Admin Security', async ({ page, context }) => {
    const adminEmail = 'peter@gmail.com';
    const pwd = 'Password123!';

    // 0. Ensure clean session state
    await page.goto('/auth');
    await page.waitForLoadState('networkidle');
    const initialLogoutBtn = page.getByTestId('auth-logout-button').filter({ visible: true });
    if (await initialLogoutBtn.isVisible()) {
      console.log('Stale session detected. Logging out...');
      await initialLogoutBtn.click();
      await page.waitForLoadState('networkidle');
    }

    await context.clearCookies();
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    // 1. Security Guard Verification (Initial Access)
    // Accessing /admin before authentication should send us to /auth
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*auth.*/, { timeout: 20000 });
    console.log('✅ Security Guard verified: Unauthenticated access to /admin redirected to /auth.');

    // 2. Architect Signup
    await page.getByTestId('auth-toggle-link').filter({ visible: true }).click(); // Switch to Sign Up
    await page.getByPlaceholder('hero@realm.com', { exact: true }).filter({ visible: true }).fill(adminEmail);
    await page.getByPlaceholder('••••••••', { exact: true }).filter({ visible: true }).fill(pwd);

    await page.getByTestId('auth-submit-button').filter({ visible: true }).click();

    // 2.1 Resilient Verification: Check for "email-already-in-use" fallback
    const authError = page.getByText(/auth\/email-already-in-use/i).first();
    if (await authError.isVisible()) {
        console.warn('⚠️ User already exists in Auth. Switching to Login...');
        await page.getByTestId('auth-toggle-link').filter({ visible: true }).click();
        await page.getByTestId('auth-submit-button').filter({ visible: true }).click();
    }

    // After cleanup/signup/login, the internal auth hook should redirect us to the Tavern root (/)
    await expect(page).toHaveURL(/\/$/, { timeout: 25000 });
    console.log('✅ Redirection verified: Authenticated Architect dropped into the Tavern.');

    // 3. System Initialization (Claiming the Root)
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    const claimBtn = page.getByRole('button', { name: /Claim the Root/i }).filter({ visible: true });
    await expect(claimBtn).toBeVisible({ timeout: 15000 });

    await page.getByPlaceholder('Email', { exact: true }).filter({ visible: true }).fill(adminEmail);
    await page.getByPlaceholder('Password', { exact: true }).filter({ visible: true }).fill(pwd);

    // Dialog handler
    page.once('dialog', async dialog => {
      console.log(`[DIALOG] ${dialog.message()}`);
      await dialog.accept();
    });

    const claimRootPromise = page.waitForResponse(response => 
      response.url().includes('/users/') && response.request().method() === 'POST', 
      { timeout: 15000 }
    );

    await claimBtn.click();
    await claimRootPromise;
    
    // Forced Resync: We wait for the role claims to propagate, reload once, 
    // and then let React Query naturally fetch the new data without destroying the context.
    console.log('[DEBUG] Root claim successful. Waiting for propagation and re-loading once...');
    await page.waitForTimeout(3000);
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Rely on Playwright's native auto-waiting for the header to appear
    await expect(page.getByTestId('admin-dashboard-header')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Identified Entities')).toBeVisible({ timeout: 10000 });

    console.log('✅ System Bootstrapped: Root throne claimed by authenticated Architect.');

    // 4. Discovery Verification
    await page.goto('/(tabs)');
    await page.waitForLoadState('networkidle');

    // Handle identity selection if it appears
    if (await page.getByText(/Identity Required/i).filter({ visible: true }).isVisible()) {
      await page.getByRole('button', { name: /Choose Identity/i }).filter({ visible: true }).click();
      await page.waitForLoadState('networkidle');
    }

    // Declarative Discovery Assertion with retry fallback
    await expect(async () => {
      // Check if re-cast is needed
      const scryBtn = page.getByText(/RE-CAST SCRYING SPELL/i).filter({ visible: true });
      if (await scryBtn.isVisible()) {
        await scryBtn.click();
      }
      
      // Expected: System correctly shows empty tavern for fresh bootstrap
      // Or if profiles are indexed, a card should appear
      const card = page.getByTestId('swipe-card').first().filter({ visible: true });
      const emptyMsg = page.getByText(/The Tavern is Empty/i).filter({ visible: true });
      
      await expect(card.or(emptyMsg)).toBeVisible({ timeout: 10000 });
    }).toPass({ timeout: 45000, intervals: [2000, 5000] });

    console.log('✅ Discovery verified: Tavern deck populated or empty state confirmed.');

    // 5. Admin Logout & Security Re-verification
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    const logoutBtn = page.getByTestId('admin-logout-button').filter({ visible: true });
    await logoutBtn.click();

    await expect(page).toHaveURL(/.*auth.*/, { timeout: 15000 });
    console.log('✅ Admin Security verified: Logout redirect to /auth succeeded.');
  });
});
