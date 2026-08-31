const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.locator('button', { hasText: 'Switch Manager' }).click();
  await page.waitForTimeout(800);

  // sélectionne un port non protégé et ouvre l'aperçu
  await page.locator('.port', { hasText: /^2$/ }).first().click();
  await page.waitForTimeout(400);
  await page.locator('button', { hasText: 'Preview commands' }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'C:/Dossier_GitHub/netcontrol/pw-toast-preview.png', fullPage: true });

  await page.locator('button', { hasText: /^Apply/ }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'C:/Dossier_GitHub/netcontrol/pw-toast-applied.png', fullPage: true });

  console.log('ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
