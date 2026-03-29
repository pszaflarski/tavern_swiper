import { test, expect } from '@playwright/test';
import * as exec from 'child_process';
import * as util from 'util';
import axios from 'axios';

const execPromise = util.promisify(exec.exec);

const USERS_SERVICE_URL = process.env.EXPO_PUBLIC_USERS_URL || 'http://localhost:8006';
const PROFILES_SERVICE_URL = process.env.EXPO_PUBLIC_PROFILES_URL || 'http://localhost:8002';
const SWIPES_SERVICE_URL = process.env.EXPO_PUBLIC_SWIPES_URL || 'http://localhost:8004';

console.log(`🚀 Running tests against:`);
console.log(`   - Users: ${USERS_SERVICE_URL}`);
console.log(`   - Profiles: ${PROFILES_SERVICE_URL}`);
console.log(`   - Swipes: ${SWIPES_SERVICE_URL}`);

async function cleanupDbs() {
  console.log('🧹 Clearing test databases...');
  try {
    const { stdout, stderr } = await execPromise('npx ts-node scripts/cleanup-test-dbs.ts');
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    console.log('✅ Cleanup complete.');
  } catch (error: any) {
    console.error('❌ Cleanup failed:', error.message);
    if (error.stdout) console.log(error.stdout);
    if (error.stderr) console.error(error.stderr);
  }
}

test.describe('Tavern Swiper Integration Flow', () => {
  
  test.beforeAll(async () => {
    await cleanupDbs();
  });

  test('Signup, Forge Profile, and Verify via REST API', async ({ page }) => {
    const testEmail = `hero-${Date.now()}@example.com`;
    const testPassword = 'Password123!';
    const testFullName = 'Playwright Hero';
    let userToken = '';

    // Capture token
    page.on('request', request => {
      const headers = request.headers();
      if (headers['authorization']?.startsWith('Bearer ')) {
        userToken = headers['authorization'].replace('Bearer ', '');
      }
    });

    // 1. Signup
    await page.goto('/auth');
    await page.click('text=New to the realm? Sign up instead');
    await page.fill('[data-testid="auth-name-input"]', testFullName);
    await page.fill('[data-testid="auth-email-input"]', testEmail);
    await page.fill('[data-testid="auth-password-input"]', testPassword);
    await page.click('[data-testid="auth-submit-button"]');

    // Wait for redirect to index
    await expect(page.getByText('The Tavern is Empty')).toBeVisible({ timeout: 15000 });

    // 2. Forge Identity
    await page.click('[data-testid="forge-identity-button"]');
    await page.click('[data-testid="forge-new-identity-button"]');
    await page.fill('[data-testid="identity-name-input"]', 'Sir Playwright');
    await page.fill('[data-testid="identity-bio-input"]', 'Verified via API.');
    await page.click('[data-testid="identity-mock-image-button"]');
    await page.click('[data-testid="identity-save-button"]');

    // Wait for return to Profiles list
    await expect(page.getByText('Your Identities').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Sir Playwright').first()).toBeVisible({ timeout: 15000 });

    // 3. Verify via REST API
    expect(userToken).not.toBe('');
    const headers = { Authorization: `Bearer ${userToken}` };

    // A. Verify User
    const userResp = await axios.get(`${USERS_SERVICE_URL}/users/me`, { headers });
    expect(userResp.status).toBe(200);
    expect(userResp.data.email).toBe(testEmail);
    const uid = userResp.data.uid;

    // B. Verify Profile
    const profilesResp = await axios.get(`${PROFILES_SERVICE_URL}/profiles/user/${uid}`, { headers });
    expect(profilesResp.status).toBe(200);
    const profile = profilesResp.data.find((p: any) => p.display_name === 'Sir Playwright');
    expect(profile).toBeDefined();

    console.log('✅ Signup and Forge verified via REST API.');
  });

  // Note: For a full match test, we would repeat the process for User B
  // and then have User A swipe on User B, then User B swipe on User A.
  // This can be added as a multi-stage test if the user requests more depth.
});
