import { test, expect } from '@playwright/test';

test.describe('Admin Dashboard Nexus', () => {

  test('Claim Root, Provision User, and Manage Entities', async ({ page }) => {
    const timestamp = Date.now();
    const adminEmail = `root-${timestamp}@nexus.com`;
    const userEmail = `hero-${timestamp}@realm.com`;
    const pwd = 'Password123!';

    // 1. Navigate to Admin and Claim Root
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // Use .filter({ visible: true }) to handle Expo Router's duplicate screens
    const initEmail = page.getByPlaceholder('Email', { exact: true }).filter({ visible: true });
    await expect(initEmail).toBeVisible({ timeout: 20000 });
    await initEmail.fill(adminEmail);
    await page.getByPlaceholder('Password', { exact: true }).filter({ visible: true }).fill(pwd);
    
    // Explicitly verify the inputs received the text
    await expect(initEmail).toHaveValue(adminEmail, { timeout: 5000 });
    await expect(page.getByPlaceholder('Password', { exact: true }).filter({ visible: true })).toHaveValue(pwd, { timeout: 5000 });

    // Catch any dialogs that pop up, but do not block on them
    page.once('dialog', dialog => dialog.accept().catch(() => {}));
    
    // Monitor the network request instead of the dialog to ensure the backend is done
    const postUsersPromise = page.waitForResponse(response => response.url().includes('/users/') && response.request().method() === 'POST', { timeout: 15000 });

    await page.getByRole('button', { name: /Claim the Root/i }).filter({ visible: true }).click();
    await postUsersPromise;

    // 2. Login as Root Admin
    await page.goto('/auth');
    await page.waitForLoadState('networkidle');
    
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
    await page.waitForTimeout(2000);

    // 3. Navigate to admin dashboard (auth screen doesn't auto-redirect)
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // The admin page might take time to resolve auth state and fetch user role
    await expect(page.getByText('Nexus Dashboard').filter({ visible: true }).first()).toBeVisible({ timeout: 30000 });

    // 4. Provision a New User
    await page.getByTestId('admin-provision-email').filter({ visible: true }).fill(userEmail);
    await page.getByTestId('admin-provision-password').filter({ visible: true }).fill(pwd);
    page.once('dialog', dialog => dialog.accept().catch(() => {}));
    await page.getByTestId('admin-provision-submit').filter({ visible: true }).click();
    
    // 5. Verify user in list
    await expect(page.getByText(userEmail).filter({ visible: true })).toBeVisible({ timeout: 15000 });

    // 6. Soft Delete User
    const userRow = page.getByText(userEmail).filter({ visible: true }).locator('..').locator('..');
    page.once('dialog', dialog => dialog.accept());
    await userRow.locator('role=button >> nth=0').click();
    await expect(userRow.getByText('Deleted')).toBeVisible({ timeout: 10000 });

    // 7. Restore User
    page.once('dialog', dialog => dialog.accept());
    await userRow.locator('role=button >> nth=0').click();
    await expect(userRow.getByText('Deleted')).not.toBeVisible({ timeout: 10000 });

    // 8. Nuke All (Danger Zone)
    const nukeBtn = page.getByTestId('admin-nuke-button').filter({ visible: true });
    if (await nukeBtn.isVisible()) {
        page.once('dialog', dialog => dialog.accept('TERMINATE'));
        await nukeBtn.click();
        await expect(page.getByTestId('admin-init-email').filter({ visible: true })).toBeVisible({ timeout: 20000 });
    }
  });
});
