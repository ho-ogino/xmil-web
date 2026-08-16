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
  assert.equal(await page.title(), 'X millennium Web URL Builder');
  assert.equal(await page.locator('h1').textContent(), 'X millennium Web URL Builder');
  assert.equal(await page.locator('#model').inputValue(), 'x1');
  assert.match(await page.locator('#model + .hint').textContent(), /生成URLには選択したMODEL.*保存設定.*指定なし/s);
  assert.equal(await page.locator('#model').evaluate((element) => (
    element.closest('.field').previousElementSibling.id === 'emm-config'
      && element.closest('.field').previousElementSibling.previousElementSibling.querySelector('#cmt') === document.querySelector('#cmt')
  )), true);

  const libraryState = await page.locator('#library').evaluate((element) => {
    element.focus();
    return {
      value: element.value,
      display: getComputedStyle(element.closest('.field')).display,
      focused: document.activeElement === element,
      offsetParent: element.offsetParent,
    };
  });
  assert.deepEqual(libraryState, { value: '', display: 'none', focused: false, offsetParent: null });
  const visibleText = await page.locator('body').innerText();
  assert.doesNotMatch(visibleText, /外部メディアとして保存のみ|EXTERNAL/);
  assert.match(visibleText, /EMM（一時・任意）/);
  assert.equal(await page.locator('#emm-config input[type="url"]').count(), 0);
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('外部メディアURLまたはEMM'));
  assert.equal(await page.locator('#result').inputValue(), '');
  assert.equal(await page.locator('#copy').isDisabled(), true);

  await page.locator('#add-emm').click();
  assert.equal(await page.locator('.emm-row').count(), 1);
  assert.equal(await page.locator('.emm-slot').inputValue(), 'emm0');
  assert.equal(await page.locator('.emm-size').inputValue(), String(1024 * 1024));
  await page.waitForFunction(() => document.querySelector('#result').value.includes('#media='));
  const emmOnlyUrl = new URL(await page.locator('#result').inputValue());
  const emmOnlyIntent = await page.evaluate((encoded) => window.XmilRemoteMedia.decodeIntent(encoded),
    emmOnlyUrl.hash.slice('#media='.length));
  assert.equal(JSON.stringify(emmOnlyIntent.items), '[]');
  assert.equal(JSON.stringify(emmOnlyIntent.emms), JSON.stringify([{ slot: 'emm0', size: 1024 * 1024 }]));
  assert.match(await page.locator('#status').textContent(), /再読み込みするとゼロ/);
  await page.locator('.remove-emm').click();

  const source = 'https://www.dropbox.com/scl/fi/AbCdEf123456/DISK.D88?rlkey=Key_123&dl=0';
  await page.locator('#library').evaluate((element) => {
    element.value = 'https://drive.google.com/file/d/HiddenLibrary123456/view';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#result').inputValue(), '');
  await page.locator('#drive0').fill(source);
  await assert.doesNotReject(() => page.locator('#result').waitFor({ state: 'visible' }));
  await page.waitForFunction(() => document.querySelector('#result').value.includes('#media='));

  const x1Url = await page.locator('#result').inputValue();
  const x1Parsed = new URL(x1Url);
  assert.equal(x1Parsed.searchParams.get('model'), 'x1');
  const x1Intent = await page.evaluate((encoded) => window.XmilRemoteMedia.decodeIntent(encoded),
    x1Parsed.hash.slice('#media='.length));
  assert.equal(JSON.stringify(x1Intent.items), JSON.stringify([{ url: source, slot: 'drive0' }]));
  assert.equal(JSON.stringify(x1Intent.emms), '[]');

  await page.locator('#model').selectOption('');
  await page.waitForFunction(() => !new URL(document.querySelector('#result').value).searchParams.has('model'));
  await page.locator('#model').selectOption('x1turboz');
  await page.waitForFunction(() => new URL(document.querySelector('#result').value).searchParams.get('model') === 'x1turboz');
  const launchUrl = await page.locator('#result').inputValue();
  const parsed = new URL(launchUrl);
  assert.equal(parsed.pathname, '/xmillennium.html');
  assert.equal(parsed.searchParams.get('model'), 'x1turboz');
  assert.deepEqual(parsed.searchParams.getAll('model'), ['x1turboz']);
  assert.doesNotMatch(parsed.search, /dropbox|rlkey/);
  assert.match(parsed.hash, /^#media=[A-Za-z0-9_-]+$/);

  const intent = await page.evaluate((encoded) => window.XmilRemoteMedia.decodeIntent(encoded),
    parsed.hash.slice('#media='.length));
  assert.equal(JSON.stringify(intent.items), JSON.stringify([{ url: source, slot: 'drive0' }]));
  assert.match(await page.locator('#status').textContent(), /MODEL: X1turboZ.*このタブのみ/s);
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

test('URL Builder rejects duplicate EMM slots and caps remote plus EMM at six', async () => {
  await page.goto(`${baseUrl}/url-builder.html`);
  await page.locator('#add-emm').click();
  await page.locator('#add-emm').click();
  await page.locator('.emm-slot').nth(1).selectOption('emm0');
  await page.waitForFunction(() => document.querySelector('#error').textContent.includes('同じ挿入先'));
  assert.equal(await page.locator('#copy').isDisabled(), true);

  await page.locator('.emm-slot').nth(1).selectOption('emm1');
  for (let index = 0; index < 4; index += 1) await page.locator('#add-emm').click();
  assert.equal(await page.locator('.emm-row').count(), 6);
  assert.equal(await page.locator('#add-emm').isDisabled(), true);
  assert.equal(await page.locator('#copy').isEnabled(), true);
});

test('URL MODEL is temporary across first boot, settings saves, reset, and normal navigation', { skip: !hasBuiltApp, timeout: 120_000 }, async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/url-builder.html`);
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => localStorage.setItem('xmil_settings', JSON.stringify({ romType: 1, motorSound: true })));
  const source = 'https://drive.google.com/file/d/ModelOverride123456/view';
  const launchUrl = await page.evaluate(({ target, mediaUrl }) => window.XmilRemoteMedia.buildLaunchUrl(target, [
    { url: mediaUrl, slot: null },
  ], 'x1turboz'), { target: `${baseUrl}/xmillennium.html`, mediaUrl: source });

  await page.unroute('**/api/disk-relay');
  await page.route('**/api/disk-relay', (route) => route.fulfill({
    status: 200,
    contentType: 'application/octet-stream',
    headers: { 'X-Disk-Filename': encodeURIComponent('MODELTEST.D88') },
    body: Buffer.from([1, 2, 3, 4]),
  }));
  await page.goto(launchUrl);
  await page.waitForFunction(() => window.Module?._js_get_rom_type?.() === 3, null, { timeout: 30_000 });
  assert.equal(new URL(page.url()).searchParams.get('model'), 'x1turboz');
  assert.equal(await page.locator('input[name="rom-type"]:checked').getAttribute('value'), '3');
  assert.equal(await page.locator('input[name="rom-type"][value="3"]').isDisabled(), true);
  assert.match(await page.locator('.cfg-model-note').textContent(), /URL指定.*保存設定は変更しません.*modelを外して/);
  assert.deepEqual(await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(window, '__XMIL_LAUNCH_MODEL');
    return { value: descriptor.value, writable: descriptor.writable, configurable: descriptor.configurable };
  }), { value: 3, writable: false, configurable: false });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('xmil_settings')).romType), 1);

  await page.locator('#cfg-motor-item').click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('xmil_settings')).romType), 1);
  await page.evaluate(() => window.XmilControls.setRomType(1));
  await page.evaluate(() => window.XmilControls.iplReset());
  await page.waitForFunction(() => window.Module._js_get_rom_type() === 3);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('xmil_settings')).romType), 1);

  await page.goto(`${baseUrl}/xmillennium.html`);
  await page.waitForFunction(() => window.Module?._js_get_rom_type?.() === 1, null, { timeout: 30_000 });
  assert.equal(await page.locator('input[name="rom-type"]:checked').getAttribute('value'), '1');
  assert.equal(await page.locator('input[name="rom-type"][value="1"]').isDisabled(), false);

  await page.goto(`${baseUrl}/url-builder.html`);
  await page.evaluate(() => localStorage.clear());
  const firstVisitUrl = await page.evaluate(({ target, mediaUrl }) => window.XmilRemoteMedia.buildLaunchUrl(target, [
    { url: mediaUrl, slot: null },
  ], 'x1turbo'), { target: `${baseUrl}/xmillennium.html`, mediaUrl: source });
  await page.goto(firstVisitUrl);
  await page.waitForFunction(() => window.Module?._js_get_rom_type?.() === 2, null, { timeout: 30_000 });
  await page.locator('#cfg-motor-item').click();
  const firstVisitSettings = await page.evaluate(() => JSON.parse(localStorage.getItem('xmil_settings')));
  assert.equal(Object.hasOwn(firstVisitSettings, 'romType'), false);
  await page.evaluate(() => localStorage.clear());
  await page.unroute('**/api/disk-relay');
});

test('media URL starts clean, preserves mount state and fragment, and recreates temporary EMM as zero', { skip: !hasBuiltApp, timeout: 120_000 }, async () => {
  await page.goto(`${baseUrl}/url-builder.html`);
  await page.evaluate(() => localStorage.clear());
  const savedMountState = JSON.stringify({ drive0: 'normal-disk-key', emm4: 'EMM4.MEM' });
  await page.evaluate((value) => localStorage.setItem('xmil_mount_state', value), savedMountState);
  const launchUrl = await page.evaluate((target) => window.XmilRemoteMedia.buildLaunchUrl(
    target, [], 'x1', [{ slot: 'emm2', size: 320 * 1024 }],
  ), `${baseUrl}/xmillennium.html`);
  const launchHash = new URL(launchUrl).hash;

  await page.goto(launchUrl);
  await page.waitForFunction(() => window.XmilCore?.getSlotState?.().emm2 === '__remote_temp_emm__', null, { timeout: 30_000 });
  const first = await page.evaluate(() => {
    const notice = document.querySelector('#remote-session-notice');
    return {
      state: window.XmilCore.getSlotState(),
      ephemeral: window.XmilCore.getSlotEphemeral(),
      mountState: localStorage.getItem('xmil_mount_state'),
      hash: location.hash,
      bytes: Array.from(window.Module.FS.readFile('/EMM2.MEM').slice(0, 4)),
      notice: notice.textContent,
      noticeTitle: notice.getAttribute('title'),
      noticeAriaLabel: notice.getAttribute('aria-label'),
      noticeHidden: notice.classList.contains('hidden'),
      noticeWidth: notice.getBoundingClientRect().width,
      mainContentWidth: document.querySelector('#main-content').getBoundingClientRect().width,
    };
  });
  assert.equal(first.state.emm2, '__remote_temp_emm__');
  assert.equal(Object.entries(first.state).filter(([, value]) => value).length, 1);
  assert.equal(first.ephemeral.emm2, true);
  assert.equal(first.mountState, savedMountState);
  assert.equal(first.hash, launchHash);
  assert.deepEqual(first.bytes, [0, 0, 0, 0]);
  assert.equal(first.noticeHidden, false);
  assert.equal(first.notice, 'External Session');
  const noticeDetail = '共有URLの一時セッションです。通常のマウント設定は変更しません。URLはアドレスバーと履歴に残ります。外部メディアの変更はこのブラウザへ保存されますが、EMMは一時メモリのためイジェクトまたは再読み込みで消去されます。再読み込みするとURLの初期構成へ戻ります。';
  assert.equal(first.noticeTitle, noticeDetail);
  assert.equal(first.noticeAriaLabel, `External Session。${noticeDetail}`);
  assert.ok(first.noticeWidth < first.mainContentWidth / 2);

  const manual = await page.evaluate(async (mountState) => {
    const entry = await window.XmilLibrary.addToLibrary(new File([
      new Uint8Array(0x2b0),
    ], 'MANUAL.D88', { type: 'application/octet-stream' }));
    await window.XmilCore.mountFromLibrary(entry.key, 'drive0');
    const mounted = window.XmilCore.getSlotState().drive0;
    const unchangedAfterMount = localStorage.getItem('xmil_mount_state') === mountState;
    await window.XmilCore.ejectSlot('drive0');
    return {
      mounted,
      key: entry.key,
      unchangedAfterMount,
      unchangedAfterEject: localStorage.getItem('xmil_mount_state') === mountState,
    };
  }, savedMountState);
  assert.equal(manual.mounted, manual.key);
  assert.equal(manual.unchangedAfterMount, true);
  assert.equal(manual.unchangedAfterEject, true);

  const rollback = await page.evaluate(async (mountState) => {
    const originalWriteFile = window.Module.FS.writeFile;
    window.Module.FS.writeFile = function(path, bytes) {
      originalWriteFile.call(this, path, bytes.slice(0, 256));
      throw new Error('injected VFS failure');
    };
    let message = '';
    try {
      await window.XmilCore.mountTemporaryEmm('emm3', 512 * 1024);
    } catch (error) {
      message = error.message;
    } finally {
      window.Module.FS.writeFile = originalWriteFile;
    }
    return {
      message,
      state: window.XmilCore.getSlotState().emm3,
      ephemeral: window.XmilCore.getSlotEphemeral().emm3,
      fileExists: window.Module.FS.analyzePath('/EMM3.MEM').exists,
      libraryHasEmm3: window.XmilCore.getLibrary().some((entry) => entry.name === 'EMM3.MEM'),
      mountStateUnchanged: localStorage.getItem('xmil_mount_state') === mountState,
    };
  }, savedMountState);
  assert.match(rollback.message, /容量を確保できません/);
  assert.deepEqual(rollback, {
    message: rollback.message,
    state: null,
    ephemeral: false,
    fileExists: false,
    libraryHasEmm3: false,
    mountStateUnchanged: true,
  });

  await page.evaluate(() => {
    const bytes = window.Module.FS.readFile('/EMM2.MEM');
    bytes[0] = 127;
    window.Module.FS.writeFile('/EMM2.MEM', bytes);
  });
  assert.equal(await page.evaluate(() => window.Module.FS.readFile('/EMM2.MEM')[0]), 127);
  await page.reload();
  await page.waitForFunction(() => window.XmilCore?.getSlotState?.().emm2 === '__remote_temp_emm__', null, { timeout: 30_000 });
  assert.equal(await page.evaluate(() => window.Module.FS.readFile('/EMM2.MEM')[0]), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('xmil_mount_state')), savedMountState);
  assert.equal(new URL(page.url()).hash, launchHash);
  await page.evaluate(() => localStorage.clear());
});

test('Relay-derived HTML-like filenames remain text in the real library DOM', { skip: !hasBuiltApp }, async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/url-builder.html`);
  const source = 'https://www.dropbox.com/scl/fi/AbCdEf123456/%3Cimg%20src%3Dx%20onerror%3Dalert%281%29%3E.D88?rlkey=Key_123&dl=0';
  const launchUrl = await page.evaluate(({ target, mediaUrl }) => window.XmilRemoteMedia.buildLaunchUrl(target, [
    { url: mediaUrl, slot: null },
  ]), { target: `${baseUrl}/xmillennium.html`, mediaUrl: source });

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
  await page.evaluate(() => document.querySelector('.lib-filter[data-type="external"]').click());

  assert.equal(await page.locator('#library-list img').count(), 0);
  assert.equal(await page.locator('#library-list [onerror]').count(), 0);
  assert.equal(await page.locator('.lib-file-name').textContent(), '_img src=x onerror=alert(1)_.D88');
});

test('remote same-name import preserves normal OPFS bytes in a separate external namespace', { skip: !hasBuiltApp }, async () => {
  await page.goto(`${baseUrl}/xmillennium.html`);
  const original = await page.evaluate(async () => {
    const entry = await window.XmilLibrary.addToLibrary(
      new File([new Uint8Array([9, 8, 7, 6])], 'GAME.D88', { type: 'application/octet-stream' }),
    );
    return { key: entry.key, launchUrl: window.XmilRemoteMedia.buildLaunchUrl(location.href, [
      { url: 'https://drive.google.com/file/d/AbCdEf1234567890/view', slot: null },
    ]) };
  });

  const unexpectedDialog = (dialog) => {
    throw new Error(`remote import unexpectedly opened a confirmation dialog: ${dialog.message()}`);
  };
  page.on('dialog', unexpectedDialog);
  await page.route('**/api/disk-relay', (route) => route.fulfill({
    status: 200,
    contentType: 'application/octet-stream',
    headers: { 'X-Disk-Filename': encodeURIComponent('GAME.D88') },
    body: Buffer.from([1, 2, 3, 4]),
  }));
  await page.goto(original.launchUrl);
  await page.waitForFunction(() => {
    const library = window.XmilCore.getLibrary();
    return library.some((entry) => entry.originKind === 'external' && entry.name === 'GAME.D88');
  }, null, { timeout: 30_000 });
  page.off('dialog', unexpectedDialog);

  const evidence = await page.evaluate(async (key) => ({
    originalBytes: Array.from(new Uint8Array(await window.XmilStorage.read(key))),
    entries: window.XmilCore.getLibrary().map((entry) => ({
      key: entry.key, name: entry.name, originKind: entry.originKind || null,
      sourceId: entry.externalSource?.sourceId || null,
    })),
  }), original.key);
  assert.deepEqual(evidence.originalBytes, [9, 8, 7, 6]);
  assert.equal(evidence.entries.filter((entry) => entry.name === 'GAME.D88').length, 2);
  assert.ok(evidence.entries.some((entry) => entry.key === original.key && entry.originKind === null));
  assert.ok(evidence.entries.some((entry) => entry.key.startsWith('remote_') && entry.originKind === 'external'));

  await page.evaluate(() => window.XmilCore.renderLibraryList());
  assert.equal(await page.locator('.lib-row').count(), 1, 'ALL hides the external entry');
  await page.evaluate(() => document.querySelector('.lib-filter[data-type="external"]').click());
  assert.equal(await page.locator('.lib-row').count(), evidence.entries.filter((entry) => entry.originKind === 'external').length);
  assert.ok((await page.locator('.lib-external-meta').allTextContents()).some((text) => /Google Drive/.test(text)));

  const remoteEntry = evidence.entries.find((entry) => entry.name === 'GAME.D88' && entry.originKind === 'external');
  const remoteKey = remoteEntry.key;
  const resized = await page.evaluate(async ({ key, sourceId }) => {
    await window.XmilStorage.write(key, new Uint8Array([5, 4, 3, 2, 1]).buffer);
    await window.XmilCore.syncExternalLibraryEntrySize(key);
    const inspection = await window.XmilCore.inspectRemoteLibraryEntry(sourceId);
    return { state: inspection.state, size: inspection.entry.size, bytes: Array.from(new Uint8Array(await window.XmilStorage.read(key))) };
  }, remoteEntry);
  assert.deepEqual(resized, { state: 'ready', size: 5, bytes: [5, 4, 3, 2, 1] });
  let deleteWarning = '';
  page.once('dialog', async (dialog) => {
    deleteWarning = dialog.message();
    await dialog.dismiss();
  });
  await page.evaluate((key) => window.XmilLibrary.deleteFromLibrary(key), remoteKey);
  assert.match(deleteWarning, /ゲーム内セーブ[\s\S]*削除すると復元できません/);
  assert.ok(await page.evaluate(async (key) => !!(await window.XmilStorage.read(key)), remoteKey));
});
