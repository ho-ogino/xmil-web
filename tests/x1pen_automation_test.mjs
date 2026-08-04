import assert from 'node:assert/strict';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const distDir = join(projectRoot, 'dist');
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
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
      const filePath = join(distDir, relativePath || 'index.html');
      if (!filePath.startsWith(distDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
        response.writeHead(404).end('Not found');
        return;
      }
      response.setHeader('Content-Type', mimeTypes[extname(filePath)] || 'application/octet-stream');
      createReadStream(filePath).pipe(response);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      baseUrl = `http://127.0.0.1:${address.port}`;
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
  assert.ok(existsSync(join(distDir, 'x1pen.html')), 'dist/x1pen.html is missing; run ./build.sh first');
  await startStaticServer();
  browser = await launchChromium();
  const context = await browser.newContext();
  page = await context.newPage();
  await page.goto(`${baseUrl}/x1pen.html`);
}, { timeout: 60_000 });

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('automation API loads and runs a BASIC program', { timeout: 60_000 }, async () => {
  const ready = await page.evaluate(() => window.X1PenAutomation.ready());
  assert.equal(ready.ready, true);
  assert.equal(await page.evaluate(() => window.X1PenAutomation.version), 1);

  const program = {
    sourceMode: 'basic+asm',
    basic: '10 PRINT "MCP READY"',
    asm: '',
    slang: '',
  };
  const loaded = await page.evaluate((value) => window.X1PenAutomation.setProgram(value), program);
  assert.deepEqual(loaded, program);

  await page.evaluate(() => window.XmilControls.setKeyMode(1));
  const result = await page.evaluate(() => window.X1PenAutomation.run());
  assert.equal(result.ok, true);
  assert.equal(result.sourceMode, 'basic+asm');

  await page.waitForTimeout(500);
  const screenshot = await page.locator('#canvas').screenshot({ type: 'png' });
  assert.ok(screenshot.length > 1_000, 'canvas screenshot should contain rendered output');

  const settings = await page.evaluate(() => window.XmilControls.getSettings());
  assert.equal(settings.keyMode, 1, 'automation run must preserve the JoyKey setting');
});

test('automation operations are serialized and stale source modes are cleared', async () => {
  const programs = await page.evaluate(async () => {
    const first = window.X1PenAutomation.setProgram({ sourceMode: 'asm', asm: 'ORG $100\nRET' });
    const second = window.X1PenAutomation.setProgram({ sourceMode: 'slang', slang: 'main() BEGIN\nEND;' });
    return { results: await Promise.all([first, second]), final: window.X1PenAutomation.getProgram() };
  });

  assert.equal(programs.results[0].sourceMode, 'asm');
  assert.equal(programs.results[1].sourceMode, 'slang');
  assert.deepEqual(programs.final, {
    basic: '',
    asm: '',
    slang: 'main() BEGIN\nEND;',
    sourceMode: 'slang',
  });
});
