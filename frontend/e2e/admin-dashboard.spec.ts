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
    // Use a fixed admin email to allow login even if infrastructure cleanup (Firestore purge) fails
    const adminEmail = 'root-admin-e2e@nexus.com';
    const userEmail = `hero-${timestamp}@realm.com`;
    const pwd = 'TestPassword123!';

    // 1. Initial State: Initialization or Login?
    await page.goto('/admin');
    
    // Use toPass to wait for the page to decide between "Bootstrap" or "Login"
    await expect(async () => {
      const claimVisible = await page.getByRole('button', { name: /Claim the Root/i }).filter({ visible: true }).isVisible();
      const loginVisible = await page.getByRole('button', { name: /Login/i }).filter({ visible: true }).isVisible();
      if (!claimVisible && !loginVisible) {
        throw new Error('Neither bootstrap nor login screen is visible (auth loading?)');
      }
    }).toPass({ timeout: 20000 });

    const claimBtn = page.getByRole('button', { name: /Claim the Root/i }).filter({ visible: true });
    
    if (await claimBtn.isVisible()) {
        console.log('Nexus is uninitialized. Starting bootstrapping flow...');
        const initEmail = page.getByPlaceholder('Email', { exact: true }).filter({ visible: true });
        await initEmail.fill(adminEmail);
        await page.getByPlaceholder('Password', { exact: true }).filter({ visible: true }).fill(pwd);
        
        // Monitor the network request instead of the dialog to ensure the backend is done
        const postUsersPromise = page.waitForResponse(response => 
            response.url().includes('/users/') && 
            response.request().method() === 'POST', 
            { timeout: 15000 }
        );

        await claimBtn.click();
        await postUsersPromise;
        // Small delay to ensure DB sync before navigating to /auth
        await page.waitForTimeout(2000);
    } else {
        console.log('Nexus is already initialized (dirty cleanup). Skipping bootstrapping...');
    }

    // 2. Login as Root Admin
    await page.goto('/auth');
    await page.waitForLoadState('networkidle');

    // If we're already logged in (due to dirty state or previous step), check if we need to log out first
    const logoutBtn = page.getByTestId('auth-logout-button').filter({ visible: true });
    if (await logoutBtn.isVisible()) {
        console.log('Already logged in. Logging out to ensure fresh admin session...');
        await logoutBtn.click();
        await page.waitForLoadState('networkidle');
    }
    
    // Wait for auth form to fully render
    await expect(page.getByTestId('auth-submit-button').filter({ visible: true })).toBeVisible({ timeout: 20000 });


    // Ensure we're in login mode (should be default)
    const authEmail = page.getByPlaceholder('hero@realm.com', { exact: true }).filter({ visible: true });
    await authEmail.fill(adminEmail);
    await page.getByPlaceholder('••••••••', { exact: true }).filter({ visible: true }).fill(pwd);
    
    // Click login and wait for Firebase response
    const loginPromise = page.waitForResponse(response => response.url().includes('identitytoolkit.googleapis.com') && response.request().method() === 'POST', { timeout: 15000 });
    await page.getByTestId('auth-submit-button').filter({ visible: true }).click();
    await loginPromise;
    
    // Wait for Firebase auth to persist to indexedDB and for
    // the useUser hook to resolve the user metadata
    await page.waitForTimeout(2500);

    // 3. Navigate to admin dashboard (auth screen doesn't auto-redirect)
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // The admin page might take time to resolve auth state and fetch user role
    // If it lands on "Initialize Nexus", wait a bit and reload (eventual consistency)
    await expect(async () => {
      if (await page.getByText(/Initialize Nexus/i).filter({ visible: true }).first().isVisible()) {
        console.log('Backend sync delay: re-initializing Nexus view...');
        await page.reload();
        await page.waitForLoadState('networkidle');
      }
      await expect(page.getByText('Provision Intelligence')).toBeVisible();
    }).toPass({ 
      intervals: [2000, 3000, 5000], 
      timeout: 30000 
    });

    // 4. Provision a New User
    await page.getByTestId('admin-provision-email').filter({ visible: true }).fill(userEmail);
    await page.getByTestId('admin-provision-password').filter({ visible: true }).fill(pwd);
    await page.getByTestId('admin-provision-submit').filter({ visible: true }).click();
    
    // 5. Verify user in list
    await expect(page.getByText(userEmail).filter({ visible: true })).toBeVisible({ timeout: 15000 });

    // 6. Soft Delete User
    const userRow = page.getByTestId(`admin-user-row-${userEmail}`);
    
    // Intercept the soft-delete response
    const deleteResponsePromise = page.waitForResponse(response => 
      response.url().includes(`/users/${userEmail.split('@')[0]}`) || // Match by UID if possible, or common part
      response.url().includes('/users/') && response.request().method() === 'DELETE', 
      { timeout: 15000 }
    );

    await userRow.filter({ visible: true }).getByTestId('admin-delete-user-button').click();
    await deleteResponsePromise;
    
    // Verify user is removed from active list
    await expect(userRow.filter({ visible: true })).toBeHidden();

    // Toggle "Show Deleted" to see the soft-deleted user with its badge
    await page.getByTestId('admin-show-deleted-switch').click();
    await expect(userRow.getByTestId('admin-user-is-deleted')).toBeVisible();

    // 7. Restore User
    const restoreResponsePromise = page.waitForResponse(response => 
      response.url().includes('/restore') && response.request().method() === 'PATCH', 
      { timeout: 15000 }
    );

    await userRow.getByTestId('admin-restore-user-button').click();
    await restoreResponsePromise;

    await expect(userRow.getByTestId('admin-user-is-deleted')).toBeHidden();

    // 8. Hard Delete User
    const hardDeletePromise = page.waitForResponse(response => 
      response.url().includes('hard=true') && response.request().method() === 'DELETE', 
      { timeout: 15000 }
    );

    await userRow.getByTestId('admin-hard-delete-user-button').click();
    await hardDeletePromise;

    await expect(userRow).toBeHidden();

    // 9. Nuke All (Danger Zone)
    const nukeBtn = page.getByTestId('admin-nuke-button').filter({ visible: true });
    if (await nukeBtn.isVisible()) {
        await nukeBtn.click();
        await expect(page.getByTestId('admin-init-email').filter({ visible: true })).toBeVisible({ timeout: 20000 });
    }
  });
});
