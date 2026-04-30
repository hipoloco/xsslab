const { chromium } = require('playwright');

const baseUrl = process.env.INTERNAL_BASE_URL || 'http://backend.cross.fit';
const username = process.env.ADMIN_USER || 'admin';
const password = process.env.ADMIN_PASS || 'admin123';
const intervalMs = Number(process.env.POLL_INTERVAL_SECONDS || 20) * 1000;
const defaultStorageKey = 'gym_internal_token';

function log(message) {
  console.log(`[worker] ${new Date().toISOString()} ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withToken(pathname, token) {
  const separator = pathname.includes('?') ? '&' : '?';
  return `${pathname}${separator}token=${encodeURIComponent(token)}`;
}

async function login(page) {
  log(`requesting JWT for ${username} from ${baseUrl}/api/login`);

  const response = await page.request.post(`${baseUrl}/api/login`, {
    form: {
      username,
      password
    }
  });

  if (!response.ok()) {
    throw new Error(`login failed with status ${response.status()}`);
  }

  const payload = await response.json();
  const token = payload.token;
  const tokenStorageKey = payload.tokenStorageKey || defaultStorageKey;

  if (!token) {
    throw new Error('login response did not include a token');
  }

  await page.goto(`${baseUrl}/login`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  await page.evaluate(
    ({ storageKey, issuedToken }) => {
      localStorage.setItem(storageKey, issuedToken);
    },
    {
      storageKey: tokenStorageKey,
      issuedToken: token
    }
  );

  log(`authenticated as ${username} with JWT`);
  return token;
}

async function bootstrapLogin(page) {
  while (true) {
    try {
      return await login(page);
    } catch (error) {
      log(`login failed: ${error.message}`);
      await sleep(5000);
    }
  }
}

async function processOneCycle(page, token) {
  await page.goto(`${baseUrl}${withToken('/admin/messages/next', token)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  if (page.url().includes('/login')) {
    throw new Error('token expired or invalid, redirected to login');
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
    const response = await page.request.post(
      `${baseUrl}${withToken(`/admin/messages/${messageId}/process`, token)}`
    );

    if (!response.ok()) {
      throw new Error(
        `failed to mark message ${messageId || '(unknown)'} as processed: ${response.status()}`
      );
    }

    await page.waitForTimeout(1000);
    log(`marked message ${messageId || '(unknown)'} as processed without re-render`);
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

  let authToken = await bootstrapLogin(page);

  while (true) {
    try {
      await processOneCycle(page, authToken);
      await sleep(intervalMs);
    } catch (error) {
      log(`cycle failed: ${error.message}`);
      await sleep(5000);
      authToken = await bootstrapLogin(page);
    }
  }
}

main().catch((error) => {
  console.error(`[worker] fatal error: ${error.stack || error.message}`);
  process.exit(1);
});
