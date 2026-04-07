import { test, expect } from '@playwright/test';

test.describe('Optimistic Profile Switching', () => {
  test.beforeEach(async ({ page }) => {
    // 1. Navigate to App
    await page.goto('/');
    
    // 2. Login
    try {
      await page.getByTestId('auth-email-input').waitFor({ state: 'visible', timeout: 5000 });
      await page.getByTestId('auth-email-input').fill('user@example.com');
      await page.getByTestId('auth-password-input').fill('Password123!');
      await page.getByTestId('auth-submit-button').click();
    } catch (e) {
      console.log('Already logged in.');
    }

    // 3. Wait for Tavern to load
    await expect(page.getByTestId('tavern-screen').last()).toBeVisible();
    
    // 4. Go to Profiles
    await page.goto('/profiles');
    await expect(page.getByTestId('profiles-screen')).toBeVisible();
  });

  test('should update UI immediately before API responds', async ({ page }) => {
    // 1. Find a profile that is NOT currently active
    // We assume there are at least two profiles for this test to be meaningful.
    // Let's find all profile names and pick the one that isn't the active one.
    
    const profileItem = page.locator('[testID^="profile-item-"]');
    const profileCount = await profileItem.count();
    
    if (profileCount < 2) {
      console.log('Not enough profiles to test switching. Skipping.');
      return;
    }

    // Find the first inactive profile
    let targetProfileId = '';
    for (let i = 0; i < profileCount; i++) {
        const id = await profileItem.nth(i).getAttribute('testID');
        const isActive = await profileItem.nth(i).evaluate(el => el.getAttribute('style')?.includes('rgb(255, 215, 0)') || el.getAttribute('style')?.includes('primary'));
        // In React Native Web, isActive might be reflected in styles or child elements.
        // Let's just look for the checkmark-circle icon which only exists for active profiles.
        const hasCheckmark = await profileItem.nth(i).locator('ion-icon[name="checkmark-circle"]').count() > 0;
        
        if (!hasCheckmark) {
            targetProfileId = id?.replace('profile-item-', '') || '';
            break;
        }
    }

    if (!targetProfileId) {
        console.log('All profiles are active? (Should not happen). Skipping.');
        return;
    }

    console.log(`Targeting profile: ${targetProfileId}`);

    // 2. Setup Route Interception to DELAY the response
    let requestCaptured = false;
    await page.route(`**/profiles/${targetProfileId}/set_active`, async (route) => {
        requestCaptured = true;
        console.log('API Request captured, delaying response...');
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profile_id: targetProfileId, is_active: true }) });
    });

    // 3. Click the profile
    await page.getByTestId(`profile-item-${targetProfileId}`).click();

    // 4. IMMEDIATELY check UI state (before 2 seconds pass)
    // The checkmark and radio button should update instantly.
    const startTime = Date.now();
    await expect(page.getByTestId(`profile-item-${targetProfileId}`).locator('ion-icon[name="checkmark-circle"]')).toBeVisible();
    const endTime = Date.now();
    
    const duration = endTime - startTime;
    console.log(`UI updated in ${duration}ms while API was still pending.`);
    
    expect(duration).toBeLessThan(500); // Should be near-instant
    expect(requestCaptured).toBeTruthy();

    // 5. Wait for API to resolve and verify it stays active
    await page.waitForTimeout(2500);
    await expect(page.getByTestId(`profile-item-${targetProfileId}`).locator('ion-icon[name="checkmark-circle"]')).toBeVisible();
    
    console.log('Verification successful: Switch was optimistic and persisted.');
  });
});
