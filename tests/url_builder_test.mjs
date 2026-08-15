import assert from 'node:assert/strict';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const distDir = join(projectRoot, 'dist');
const htmlDir = join(projectRoot, 'html');
const hasBuiltApp = existsSync(join(distDir, 'xmillennium.html'))
  && existsSync(join(distDir, 'url-builder.html'));
const staticRoot = hasBuiltApp ? distDir : htmlDir;
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
};

let server;
let browser;
let page;
let baseUrl;

function startStaticServer() {
  return new Promise((resolve, reject) => {
    server = createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const relativePath = normalize(pathname).replace(/^[/\\]+/, '');
      const filePath = join(staticRoot, relativePath || 'url-builder.html');
      if (!filePath.startsWith(staticRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
        response.writeHead(404).end('Not found');
        return;
      }
      response.setHeader('Content-Type', mimeTypes[extname(filePath)] || 'application/octet-stream');
      createReadStream(filePath).pipe(response);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
}

async function launchChromium() {
  const executablePath = process.env.X1PEN_BROWSER_EXECUTABLE;
  if (executablePath) return chromium.launch({ executablePath, headless: true });
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    if (process.platform !== 'darwin') throw error;
    return chromium.launch({ channel: 'chrome', headless: true });
  }
}

before(async () => {
  await startStaticServer();
  browser = await launchChromium();
  page = await browser.newPage();
});

after(async () => {
  await page?.close();
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

test('URL Builder validates inputs and emits a fragment-only launch intent', async () => {
  await page.goto(`${baseUrl}/url-builder.html`);
  const source = 'https://www.dropbox.com/scl/fi/AbCdEf123456/DISK.D88?rlkey=Key_123&dl=0';
  await page.locator('#drive0').fill(source);
  await assert.doesNotReject(() => page.locator('#result').waitFor({ state: 'visible' }));
  await page.waitForFunction(() => document.querySelector('#result').value.includes('#media='));

  const launchUrl = await page.locator('#result').inputValue();
  const parsed = new URL(launchUrl);
  assert.equal(parsed.pathname, '/xmillennium.html');
  assert.equal(parsed.search, '');
  assert.doesNotMatch(parsed.search, /dropbox|rlkey/);
  assert.match(parsed.hash, /^#media=[A-Za-z0-9_-]+$/);

  const intent = await page.evaluate((encoded) => window.XmilRemoteMedia.decodeIntent(encoded),
    parsed.hash.slice('#media='.length));
  assert.equal(JSON.stringify(intent.items), JSON.stringify([{ url: source, slot: 'drive0' }]));
  assert.equal(await page.locator('#copy').isEnabled(), true);
  assert.equal(await page.locator('#open').getAttribute('href'), launchUrl);

  await page.locator('#drive0').fill('https://drive.google.com/file/d/short/view');
  await page.waitForFunction(() => document.querySelector('#error').textContent.length > 0);
  assert.match(await page.locator('#error').textContent(), /Google Drive/);
  assert.equal(await page.locator('#copy').isDisabled(), true);

  await page.setViewportSize({ width: 390, height: 844 });
  const dimensions = await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: innerWidth }));
  assert.ok(dimensions.body <= dimensions.viewport + 1, `horizontal overflow: ${dimensions.body} > ${dimensions.viewport}`);
});

test('Relay-derived HTML-like filenames remain text in the real library DOM', { skip: !hasBuiltApp }, async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/url-builder.html`);
  const source = 'https://www.dropbox.com/scl/fi/AbCdEf123456/%3Cimg%20src%3Dx%20onerror%3Dalert%281%29%3E.D88?rlkey=Key_123&dl=0';
  await page.locator('#library').fill(source);
  await page.waitForFunction(() => document.querySelector('#result').value.includes('#media='));
  const launchUrl = await page.locator('#result').inputValue();

  await page.route('**/api/disk-relay', (route) => route.fulfill({
    status: 200,
    contentType: 'application/octet-stream',
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Disk-Filename': encodeURIComponent('<img src=x onerror=alert(1)>.D88'),
    },
    body: Buffer.from([0, 1, 2, 3]),
  }));

  await page.goto(launchUrl);
  await page.waitForFunction(() => {
    try { return JSON.parse(localStorage.getItem('xmil_library') || '[]').length === 1; } catch (_) { return false; }
  }, null, { timeout: 30_000 });
  await page.evaluate(() => window.XmilCore.renderLibraryList());

  assert.equal(await page.locator('#library-list img').count(), 0);
  assert.equal(await page.locator('#library-list [onerror]').count(), 0);
  assert.equal(await page.locator('.lib-file-name').textContent(), '_img src=x onerror=alert(1)_.D88');
});

test('remote filename collision preserves existing OPFS bytes and imports with a suffix', { skip: !hasBuiltApp }, async () => {
  await page.goto(`${baseUrl}/xmillennium.html`);
  const original = await page.evaluate(async () => {
    const entry = await window.XmilLibrary.addToLibrary(
      new File([new Uint8Array([9, 8, 7, 6])], 'GAME.D88', { type: 'application/octet-stream' }),
    );
    return { key: entry.key, launchUrl: window.XmilRemoteMedia.buildLaunchUrl(location.href, [
      { url: 'https://drive.google.com/file/d/AbCdEf1234567890/view', slot: null },
    ]) };
  });

  page.on('dialog', (dialog) => {
    throw new Error(`remote import unexpectedly opened a confirmation dialog: ${dialog.message()}`);
  });
  await page.route('**/api/disk-relay', (route) => route.fulfill({
    status: 200,
    contentType: 'application/octet-stream',
    headers: { 'X-Disk-Filename': encodeURIComponent('GAME.D88') },
    body: Buffer.from([1, 2, 3, 4]),
  }));
  await page.goto(original.launchUrl);
  await page.waitForFunction(() => {
    const library = window.XmilCore.getLibrary();
    return library.some((entry) => entry.name === 'GAME (1).D88');
  }, null, { timeout: 30_000 });

  const evidence = await page.evaluate(async (key) => ({
    originalBytes: Array.from(new Uint8Array(await window.XmilStorage.read(key))),
    names: window.XmilCore.getLibrary().map((entry) => entry.name),
  }), original.key);
  assert.deepEqual(evidence.originalBytes, [9, 8, 7, 6]);
  assert.ok(evidence.names.includes('GAME.D88'));
  assert.ok(evidence.names.includes('GAME (1).D88'));
});
