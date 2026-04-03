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
    // Since the system is cleared, we need to create the Architect identity first.
    // Note: Auto-registration in useUser.ts is disabled when rootExists is false,
    // so we don't expect a /users/ POST here. We only expect Firebase Auth success.
    await page.getByTestId('auth-toggle-link').filter({ visible: true }).click(); // Switch to Sign Up
    await page.getByPlaceholder('hero@realm.com', { exact: true }).filter({ visible: true }).fill(adminEmail);
    await page.getByPlaceholder('••••••••', { exact: true }).filter({ visible: true }).fill(pwd);

    await page.getByTestId('auth-submit-button').filter({ visible: true }).click();

    // 2.1 Resilient Verification: Check for "email-already-in-use" fallback
    // We handle the case where cleanup might have failed or the user persists in the emulator.
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
    // Now that we are authenticated, we can return to /admin to claim the root throne
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    const claimBtn = page.getByRole('button', { name: /Claim the Root/i }).filter({ visible: true });
    await expect(claimBtn).toBeVisible({ timeout: 15000 });

    await page.getByPlaceholder('Email', { exact: true }).filter({ visible: true }).fill(adminEmail);
    await page.getByPlaceholder('Password', { exact: true }).filter({ visible: true }).fill(pwd);

    // Playwright needs to handle the window.alert() that follows a successful claim
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
    
    // Forced Resync: After claiming the root, we wait 5s for the backend to propagate.
    // This handles any Firebase emulator or service-to-service communication lag.
    console.log('[DEBUG] Root claim successful. Waiting 5s for backend propagation...');
    await page.waitForTimeout(5000);

    // We reload the page to ensure useUser fetches the updated root_admin role immediately.
    console.log('[DEBUG] Reloading page for state resynchronization...');
    await page.reload();
    await page.waitForLoadState('networkidle');
    
    // Patiently verify the dashboard header exists after the reload
    await expect(async () => {
      // Use the dashboard-specific testID or a reliable text element
      await expect(page.getByTestId('admin-dashboard-header')).toBeVisible();
      await expect(page.getByText('Identified Entities')).toBeVisible();
    }).toPass({ timeout: 20000 });

    console.log('✅ System Bootstrapped: Root throne claimed by authenticated Architect.');

    // 4. Discovery Verification
    await page.goto('/(tabs)');
    await page.waitForLoadState('networkidle');

    await expect(async () => {
      // If we see identity selection
      if (await page.getByText(/Identity Required/i).filter({ visible: true }).isVisible()) {
        await page.getByRole('button', { name: /Choose Identity/i }).filter({ visible: true }).click();
        await page.waitForLoadState('networkidle');
      }

      const profileVisible = await page.getByTestId('swipe-card').filter({ visible: true }).first().isVisible();
      if (!profileVisible) {
        const scryBtn = page.getByText(/RE-CAST SCRYING SPELL/i).filter({ visible: true });
        if (await scryBtn.isVisible()) {
          await scryBtn.click();
        }
        throw new Error('No heroes visible in the Tavern yet.');
      }
    }).toPass({ timeout: 30000, intervals: [2000, 5000] });

    console.log('✅ Discovery verified: Heroes identified in the Tavern.');

    // 5. Admin Logout & Security Re-verification
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    const logoutBtn = page.getByTestId('admin-logout-button').filter({ visible: true });
    await logoutBtn.click();

    await expect(page).toHaveURL(/.*auth.*/, { timeout: 15000 });
    console.log('✅ Admin Security verified: Logout redirect to /auth succeeded.');
  });
});
