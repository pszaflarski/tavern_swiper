import { test, expect } from '@playwright/test';

test.describe('Admin Dashboard Nexus', () => {

  test('Claim Root, Provision User, and Manage Entities', async ({ page }) => {
    // Global dialog handler for all administrative confirmations
    page.on('dialog', async dialog => {
      if (dialog.message().includes('TERMINATE')) {
        await dialog.accept('TERMINATE');
      } else {
        await dialog.accept();
      }
    });

    const timestamp = Date.now();
    const adminEmail = 'root-admin-e2e@nexus.com';
    const userEmail = `hero-${timestamp}@realm.com`;
    const pwd = 'TestPassword123!';

    // 1. Authenticate as Root Admin First
    await page.goto('/auth');
    await page.waitForLoadState('networkidle');

    // Attempt login first
    await page.getByPlaceholder('hero@realm.com', { exact: true }).filter({ visible: true }).fill(adminEmail);
    await page.getByPlaceholder('••••••••', { exact: true }).filter({ visible: true }).fill(pwd);
    
    console.log('Attempting login for Root Admin...');
    const authResPromise = page.waitForResponse(response => 
      response.url().includes('identitytoolkit.googleapis.com') && response.request().method() === 'POST', 
      { timeout: 15000 }
    );
    await page.getByTestId('auth-submit-button').filter({ visible: true }).click();
    
    // We don't await the promise immediately because it might fail if user doesn't exist
    // Instead, we check the response or UI state
    try {
      const authRes = await authResPromise;
      if (!authRes.ok()) {
        throw new Error('Login failed');
      }
    } catch (e) {
      console.log('Login failed (likely pristine database). Proceeding with Signup...');
      await page.getByTestId('auth-toggle-link').filter({ visible: true }).click();
      await page.getByTestId('auth-submit-button').filter({ visible: true }).click();
    }
    
    // Wait for auto-redirect to tavern root
    await expect(page).toHaveURL(/\/(|\(tabs\).*)$/, { timeout: 30000 });
    console.log('✅ Identity verified. Proceeding to Admin Dashboard...');

    // 2. Initial State: Initialization or Dashboard?
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Wait for the page to decide between "Bootstrap" or "Dashboard"
    await expect(
      page.getByRole('button', { name: /Claim the Root/i }).or(page.getByText('Provision Intelligence'))
    ).toBeVisible({ timeout: 30000 });

    const claimBtn = page.getByRole('button', { name: /Claim the Root/i }).filter({ visible: true });
    
    if (await claimBtn.isVisible()) {
        console.log('Nexus is uninitialized. Starting bootstrapping flow...');
        await page.getByPlaceholder('Email', { exact: true }).filter({ visible: true }).fill(adminEmail);
        await page.getByPlaceholder('Password', { exact: true }).filter({ visible: true }).fill(pwd);
        
        const postUsersPromise = page.waitForResponse(response => 
            response.url().includes('/users/') && 
            response.request().method() === 'POST', 
            { timeout: 15000 }
        );

        await claimBtn.click();
        await postUsersPromise;
        
        // Propagation Delay: Backend needs time to sync Firestore roles
        console.log('[DEBUG] Root claim successful. Waiting 10s for backend propagation...');
        await page.waitForTimeout(10000);
        
        // Reload to ensure the useUser hook fetches the updated role
        await page.reload();
        await page.waitForLoadState('networkidle');
        
        await expect(page.getByText('Provision Intelligence')).toBeVisible({ timeout: 20000 });
    } else {
        console.log('Nexus dashboard already active.');
    }

    // 4. Provision a New User
    await page.getByTestId('admin-provision-email').filter({ visible: true }).fill(userEmail);
    await page.getByTestId('admin-provision-password').filter({ visible: true }).fill(pwd);
    await page.getByTestId('admin-provision-submit').filter({ visible: true }).click();
    
    // 5. Verify user in list
    await expect(page.getByText(userEmail).filter({ visible: true })).toBeVisible({ timeout: 15000 });

    // 6. Soft Delete User
    const userRow = page.getByTestId(`admin-user-row-${userEmail}`);
    await userRow.filter({ visible: true }).getByTestId('admin-delete-user-button').click();
    await expect(userRow.filter({ visible: true })).toBeHidden({ timeout: 10000 });

    // Toggle "Show Deleted" to see the soft-deleted user with its badge
    await page.getByTestId('admin-show-deleted-switch').click();
    await expect(userRow.getByTestId('admin-user-is-deleted')).toBeVisible();

    // 7. Restore User
    await userRow.getByTestId('admin-restore-user-button').click();
    await expect(userRow.getByTestId('admin-user-is-deleted')).toBeHidden();

    // 8. Hard Delete User
    await userRow.getByTestId('admin-hard-delete-user-button').click();
    await expect(userRow).toBeHidden();

    // 9. Nuke All (Danger Zone)
    const nukeBtn = page.getByTestId('admin-nuke-button').filter({ visible: true });
    if (await nukeBtn.isVisible()) {
        console.log('Initiating Nuke All (Danger Zone)...');
        await nukeBtn.click();
        
        // Expect the application to automatically route to .*auth.* (session invalidated)
        await expect(page).toHaveURL(/.*auth.*/, { timeout: 30000 });
        await expect(page.getByTestId('auth-submit-button').filter({ visible: true })).toBeVisible();
        console.log('✅ Nuke All verified: Session invalidated and redirected to /auth.');
    }
  });
});
