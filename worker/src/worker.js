const { chromium } = require('playwright');

const baseUrl = process.env.INTERNAL_BASE_URL || 'http://backend.cross.fit';
const username = process.env.ADMIN_USER || 'admin';
const password = process.env.ADMIN_PASS || 'admin123';
const intervalMs = Number(process.env.POLL_INTERVAL_SECONDS || 20) * 1000;

function log(message) {
  console.log(`[worker] ${new Date().toISOString()} ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function login(page) {
  log(`opening login page at ${baseUrl}/login`);
  await page.goto(`${baseUrl}/login`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL(/\/admin$/, { timeout: 30000 }),
    page.click('button[type="submit"]')
  ]);
  log(`authenticated as ${username}`);
}

async function bootstrapLogin(page) {
  while (true) {
    try {
      await login(page);
      return;
    } catch (error) {
      log(`login failed: ${error.message}`);
      await sleep(5000);
    }
  }
}

async function processOneCycle(page) {
  await page.goto(`${baseUrl}/admin/messages/next`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  if (page.url().includes('/login')) {
    throw new Error('session expired, redirected to login');
  }

  await page.waitForTimeout(3000);

  const messageId = await page.getAttribute('body', 'data-message-id');
  if (messageId) {
    log(`rendered message #${messageId}`);
  } else {
    log('no new messages available');
  }

  const processButton = page.locator('form[data-process-message] button[type="submit"]');
  if (await processButton.count()) {
    await processButton.first().click();
    await page.waitForTimeout(1000);
    log(`marked message ${messageId || '(unknown)'} as processed`);
  }
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage']
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', (message) => {
    log(`[browser console] ${message.type()}: ${message.text()}`);
  });

  page.on('pageerror', (error) => {
    log(`[browser error] ${error.message}`);
  });

  page.on('dialog', async (dialog) => {
    log(`[browser dialog] ${dialog.message()}`);
    await dialog.dismiss();
  });

  page.on('requestfailed', (request) => {
    log(`[request failed] ${request.url()} -> ${request.failure()?.errorText || 'unknown error'}`);
  });

  await bootstrapLogin(page);

  while (true) {
    try {
      await processOneCycle(page);
      await sleep(intervalMs);
    } catch (error) {
      log(`cycle failed: ${error.message}`);
      await sleep(5000);
      await bootstrapLogin(page);
    }
  }
}

main().catch((error) => {
  console.error(`[worker] fatal error: ${error.stack || error.message}`);
  process.exit(1);
});

