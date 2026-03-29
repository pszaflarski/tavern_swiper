import { test, expect, BrowserContext, Page } from '@playwright/test';
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
  }
}

async function forgeIdentity(page: Page, heroName: string) {
  await page.click('[data-testid="forge-identity-button"]');
  await page.click('[data-testid="forge-new-identity-button"]');
  await page.fill('[data-testid="identity-name-input"]', heroName);
  await page.fill('[data-testid="identity-bio-input"]', `${heroName}'s lore for verification.`);
  await page.click('[data-testid="identity-mock-image-button"]');
  await page.click('[data-testid="identity-save-button"]');

  // Wait for return to Profiles list
  await expect(page.getByText('Your Identities').first()).toBeVisible({ timeout: 15000 });
  const profileName = page.locator('[data-testid="profile-card-name"]').first();
  await profileName.waitFor({ state: 'visible', timeout: 10000 });
  await expect(profileName).toContainText(heroName);
}

test.describe('Tavern Swiper Integration Flow', () => {
  
  test.beforeAll(async () => {
    await cleanupDbs();
  });

  test('Signup, Forge Profile, Swipe, and Verify Match via REST API', async ({ browser, page }) => {
    // ---- 1. SETUP USER A ----
    const emailA = `hero-a-${Date.now()}@example.com`;
    const pwd = 'Password123!';
    let tokenA = '';

    page.on('request', request => {
      const headers = request.headers();
      if (headers['authorization']?.startsWith('Bearer ')) {
        tokenA = headers['authorization'].replace('Bearer ', '');
      }
    });

    await page.goto('/auth');
    await page.click('text=New to the realm? Sign up instead');
    await page.fill('[data-testid="auth-name-input"]', 'User A');
    await page.fill('[data-testid="auth-email-input"]', emailA);
    await page.fill('[data-testid="auth-password-input"]', pwd);
    await page.click('[data-testid="auth-submit-button"]');
    await expect(page.getByText('The Tavern is Empty')).toBeVisible({ timeout: 15000 });

    await forgeIdentity(page, 'Sir Playwright');
    console.log('✅ User A created and verified.');

    // ---- 2. SETUP USER B (New Context) ----
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    const emailB = `hero-b-${Date.now()}@example.com`;
    let tokenB = '';

    pageB.on('request', request => {
      const headers = request.headers();
      if (headers['authorization']?.startsWith('Bearer ')) {
        tokenB = headers['authorization'].replace('Bearer ', '');
      }
    });

    await pageB.goto('/auth');
    await pageB.click('text=New to the realm? Sign up instead');
    await pageB.fill('[data-testid="auth-name-input"]', 'User B');
    await pageB.fill('[data-testid="auth-email-input"]', emailB);
    await pageB.fill('[data-testid="auth-password-input"]', pwd);
    await pageB.click('[data-testid="auth-submit-button"]');
    await expect(pageB.getByText('The Tavern is Empty')).toBeVisible({ timeout: 15000 });

    await forgeIdentity(pageB, 'Madam E2E');
    console.log('✅ User B created and verified.');

    // ---- 3. USER A SWIPES RIGHT ON USER B ----
    // Refresh Tavern to see User B
    await page.goto('/');
    // Check for Madam E2E in the feed
    await expect(page.getByText('Madam E2E')).toBeVisible({ timeout: 15000 });
    // Swipe Right
    await page.click('[data-testid="swipe-right-button"]');
    console.log('✅ User A swiped RIGHT on User B.');

    // ---- 4. USER B SWIPES RIGHT ON USER A ----
    await pageB.goto('/');
    await expect(pageB.getByText('Sir Playwright')).toBeVisible({ timeout: 15000 });
    await pageB.click('[data-testid="swipe-right-button"]');
    console.log('✅ User B swiped RIGHT on User A.');

    // ---- 5. FINAL API VERIFICATION ----
    expect(tokenA).not.toBe('');
    expect(tokenB).not.toBe('');
    const headersA = { Authorization: `Bearer ${tokenA}` };
    const headersB = { Authorization: `Bearer ${tokenB}` };

    // A. Verify User A Profiles
    const userAResp = await axios.get(`${USERS_SERVICE_URL}/users/me`, { headers: headersA });
    const uidA = userAResp.data.uid;
    const profilesAResp = await axios.get(`${PROFILES_SERVICE_URL}/profiles/user/${uidA}`, { headers: headersA });
    const profileA_id = profilesAResp.data[0].profile_id;

    // B. Verify User B Profiles
    const userBResp = await axios.get(`${USERS_SERVICE_URL}/users/me`, { headers: headersB });
    const uidB = userBResp.data.uid;
    const profilesBResp = await axios.get(`${PROFILES_SERVICE_URL}/profiles/user/${uidB}`, { headers: headersB });
    const profileB_id = profilesBResp.data[0].profile_id;

    // C. Verify Match via API
    console.log('🔍 Checking Swipes API for Match...');
    const matchResp = await axios.get(`${SWIPES_SERVICE_URL}/swipes/matches/${profileA_id}`, { headers: headersA });
    expect(matchResp.status).toBe(200);
    
    const match = matchResp.data.find((m: any) => 
      (m.profile_id_a === profileA_id && m.profile_id_b === profileB_id) ||
      (m.profile_id_a === profileB_id && m.profile_id_b === profileA_id)
    );
    expect(match).toBeDefined();
    console.log('✅ Match A<->B verified in Swipes API.');

    await contextB.close();
  });
});
