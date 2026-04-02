import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));
  page.on('dialog', dialog => {
    console.log('DIALOG OPENED:', dialog.message());
    dialog.accept();
  });

  console.log('Navigating to admin...');
  await page.goto('http://localhost:8081/admin');
  await page.waitForLoadState('networkidle');

  console.log('Filling form...');
  await page.getByPlaceholder('Email', { exact: true }).filter({ visible: true }).fill('root-debug@example.com');
  await page.getByPlaceholder('Password', { exact: true }).filter({ visible: true }).fill('Password123!');
  
  console.log('Clicking button...');
  await page.getByRole('button', { name: /Claim the Root/i }).filter({ visible: true }).click();
  
  console.log('Waiting 5 seconds...');
  await page.waitForTimeout(5000);
  
  console.log('Done.');
  await browser.close();
})();
