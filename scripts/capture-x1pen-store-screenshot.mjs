import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetUrl = process.env.X1PEN_URL || 'https://x1.onoda-pro.com/x1pen';
const systemBrowsers = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const executablePath = systemBrowsers.find(existsSync);

const popupDocument = await readFile(resolve(repoRoot, 'extension/popup.html'), 'utf8');
const popupCss = await readFile(resolve(repoRoot, 'extension/popup.css'), 'utf8');
const popupBody = popupDocument.match(/<body>([\s\S]*?)<script\s+src="popup\.js"><\/script>/)?.[1];
if (!popupBody) throw new Error('Could not extract the extension popup body');

const browser = await chromium.launch({ headless: true, executablePath });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.locator('#x1pen-toolbar').waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(
    () => document.querySelector('#x1pen-status')?.textContent.trim() === 'Ready',
    undefined,
    { timeout: 60_000 },
  );
  await page.locator('#basic-editor-container .cm-editor').waitFor({ state: 'visible', timeout: 30_000 });

  await page.evaluate(({ body, css }) => {
    const host = document.createElement('div');
    host.id = 'x1pen-connector-store-preview';
    Object.assign(host.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      width: '340px',
      zIndex: '2147483647',
      border: '1px solid #4a5360',
      boxShadow: '0 12px 40px rgba(0, 0, 0, 0.55)',
    });
    const shadow = host.attachShadow({ mode: 'open' });
    const scopedCss = css.replace(/\bbody\s*\{/, '.popup {');
    shadow.innerHTML = `<style>${scopedCss}</style><div class="popup">${body}</div>`;
    document.body.append(host);

    const port = shadow.getElementById('port');
    const code = shadow.getElementById('code');
    const consent = shadow.getElementById('consent');
    const connect = shadow.getElementById('connect');
    const status = shadow.getElementById('status');
    const sessions = shadow.getElementById('sessions');
    port.value = '43110';
    code.value = '482731';
    consent.checked = true;
    connect.disabled = false;
    status.textContent = 'Connected: X1Pen';
    sessions.innerHTML = '<li>Active: X1Pen</li>';
  }, { body: popupBody, css: popupCss });

  await page.screenshot({
    path: resolve(repoRoot, 'extension/store/screenshot-1280x800.png'),
  });
} finally {
  await browser.close();
}
