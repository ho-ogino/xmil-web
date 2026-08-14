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

async function snapshotX1PenPersistence(targetPage) {
  return targetPage.evaluate(async () => {
    async function hashBytes(bytes) {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    }

    const entries = (await window.XmilStorage.list())
      .map(({ key, name, size }) => ({ key, name, size }))
      .sort((left, right) => left.key.localeCompare(right.key));
    const stored = [];
    for (const entry of entries) {
      const bytes = await window.XmilStorage.read(entry.key);
      stored.push({ key: entry.key, size: bytes.byteLength, hash: await hashBytes(bytes) });
    }
    const allLocalStorage = {};
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      allLocalStorage[key] = localStorage.getItem(key);
    }
    return {
      allLocalStorage: Object.fromEntries(Object.entries(allLocalStorage).sort(([left], [right]) =>
        left.localeCompare(right))),
      editor: localStorage.getItem('x1pen_editor'),
      editorAsm: localStorage.getItem('x1pen_editor_asm'),
      editorSlang: localStorage.getItem('x1pen_editor_slang'),
      mountState: localStorage.getItem('x1pen_mount_state'),
      library: localStorage.getItem('xmil_library'),
      storageManifest: localStorage.getItem('xmil_opfs_manifest'),
      entries,
      stored,
    };
  });
}

async function seedX1PenPersistentDiskState(targetPage, { project = false } = {}) {
  await targetPage.goto(`${baseUrl}/x1pen.html`);
  await targetPage.evaluate(() => window.X1PenAutomation.ready());
  return targetPage.evaluate(async ({ makeProject }) => {
    const api = window.X1PenAutomation;
    const current = api.getProgram();
    await api.setProgram({
      sourceMode: 'basic+asm',
      basic: '10 PRINT "PERSISTENT ORIGINAL"\n20 END',
      asm: '; PERSISTENT ASM',
      slang: '',
    }, current.revision, current.revisionEpoch);

    const response = await fetch('fuzzybasic_boot.v2.d88');
    const bytes = await response.arrayBuffer();
    const owner = await window.XmilLibrary.addToLibrary(
      new File([bytes], makeProject ? 'PROJECT.D88' : 'OWNER.D88', { type: 'application/octet-stream' }),
    );
    const data = await window.XmilLibrary.addToLibrary(
      new File([bytes], 'DATA.D88', { type: 'application/octet-stream' }),
    );
    if (makeProject) {
      const library = window.XmilCore.getLibrary();
      const entry = library.find((candidate) => candidate.key === owner.key);
      entry.x1penProject = true;
      entry.sourceKey = 'seed-source';
      entry.sourceHash = 'seed-hash';
      entry.projectMode = 'fuzzybasic';
      entry.projectUpdatedAt = '2026-08-15T00:00:00.000Z';
      window.XmilCore.saveLibrary(library);
    }
    await window.XmilLibrary.mountFromLibrary(owner.key, 'drive0');
    await window.XmilLibrary.mountFromLibrary(data.key, 'drive1');
    return { ownerKey: owner.key, dataKey: data.key };
  }, { makeProject: project });
}

function installShareRoute(context, id, payload, status = 200) {
  return context.route(`**/api/share/${id}`, (route) => route.fulfill({
    status,
    contentType: 'application/json',
    body: status === 200 ? JSON.stringify(payload) : JSON.stringify({ error: 'not found' }),
  }));
}

async function assertEphemeralShareDocument(targetPage) {
  const state = await targetPage.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(window, '__X1PEN_EPHEMERAL_SHARE');
    return {
      flag: window.__X1PEN_EPHEMERAL_SHARE,
      writable: descriptor.writable,
      configurable: descriptor.configurable,
      multiTabPromise: window.__multiTabPromise,
      tabChannel: window.__tabChannel,
    };
  });
  assert.deepEqual(state, {
    flag: true,
    writable: false,
    configurable: false,
    multiTabPromise: null,
    tabChannel: null,
  });
  await assert.doesNotReject(() => targetPage.locator('#x1pen-share-mode').waitFor({ state: 'visible' }));
  assert.match(await targetPage.locator('#x1pen-share-mode').textContent(), /edits are not saved/i);
}

async function runWithRecordedKeyEvents() {
  return page.evaluate(async () => {
    const module = window.Module;
    const originalKeyDown = module._js_key_down;
    const originalKeyUp = module._js_key_up;
    const originalSetKeyMode = module._js_set_key_mode;
    const events = [];
    const modeChanges = [];
    module._js_key_down = function(vk) {
      events.push({ type: 'down', vk, at: performance.now() });
      return originalKeyDown.call(module, vk);
    };
    module._js_key_up = function(vk) {
      events.push({ type: 'up', vk, at: performance.now() });
      return originalKeyUp.call(module, vk);
    };
    module._js_set_key_mode = function(mode) {
      modeChanges.push(mode);
      return originalSetKeyMode.call(module, mode);
    };
    try {
      return { result: await window.X1PenAutomation.run(), events, modeChanges };
    } finally {
      module._js_key_down = originalKeyDown;
      module._js_key_up = originalKeyUp;
      module._js_set_key_mode = originalSetKeyMode;
    }
  });
}

function assertSequentialKeyEvents(actual, keys, gapMinimumMs) {
  assert.deepEqual(
    actual.map(({ type, vk }) => [type, vk]),
    keys.flatMap((vk) => [['down', vk], ['up', vk]]),
  );
  for (let index = 0; index < keys.length; index++) {
    const down = actual[index * 2];
    const up = actual[index * 2 + 1];
    assert.ok(up.at - down.at >= 70, `key ${index} hold must be at least 70ms`);
    if (index < keys.length - 1) {
      const nextDown = actual[index * 2 + 2];
      assert.ok(nextDown.at - up.at >= gapMinimumMs,
        `gap after key ${index} must be at least ${gapMinimumMs}ms`);
    }
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
  assert.equal(await page.evaluate(() => window.X1PenAutomation.version), 2);
  assert.deepEqual(ready.x1pen, {
    name: 'x1pen',
    version: '0.9.1',
    automationApiVersion: 2,
    features: ['automation.core', 'automation.run-recovery', 'automation.source-sync', 'screen.capture', 'input.keyboard', 'input.pad', 'debugger.cpu', 'debugger.vram'],
  });
  assert.equal(ready.capabilities.debugger.available, true);
  assert.equal(ready.capabilities.debugger.version, 2);
  assert.equal(ready.capabilities.debugger.addressSpaceSize, 0x10000);
  assert.equal(ready.capabilities.debugger.maxReadLength, 4096);
  assert.equal(ready.capabilities.debugger.runPending, false);
  assert.equal(ready.capabilities.debugger.vram.available, true);
  assert.deepEqual(ready.capabilities.debugger.vram.regions, ['text', 'attribute', 'kanji', 'graphics']);
  assert.deepEqual(ready.capabilities.debugger.vram.regionSizes, {
    text: 0x0800,
    attribute: 0x0800,
    kanji: 0x0800,
    graphics: 0x4000,
  });
  assert.deepEqual(ready.capabilities.debugger.vram.modelDependentRegions, ['kanji']);
  assert.deepEqual(ready.capabilities.debugger.vram.availableRegions, ['text', 'attribute', 'graphics']);

  const turboRegions = await page.evaluate(() => {
    const module = window.Module;
    const saved = module._js_get_rom_type;
    module._js_get_rom_type = () => 2;
    try {
      return window.X1PenAutomation.getStatus().capabilities.debugger.vram.availableRegions;
    } finally {
      module._js_get_rom_type = saved;
    }
  });
  assert.deepEqual(turboRegions, ['text', 'attribute', 'kanji', 'graphics']);

  const unavailableCapability = await page.evaluate(() => {
    const module = window.Module;
    const saved = module._js_debug_step;
    module._js_debug_step = null;
    try {
      return window.X1PenAutomation.getStatus().capabilities.debugger.available;
    } finally {
      module._js_debug_step = saved;
    }
  });
  assert.equal(unavailableCapability, false);

  const unavailableVramCapability = await page.evaluate(() => {
    const module = window.Module;
    const saved = module._js_debug_read_vram;
    module._js_debug_read_vram = null;
    try {
      return {
        debugger: window.X1PenAutomation.getStatus().capabilities.debugger.available,
        vram: window.X1PenAutomation.getStatus().capabilities.debugger.vram.available,
        availableRegions: window.X1PenAutomation.getStatus().capabilities.debugger.vram.availableRegions,
      };
    } finally {
      module._js_debug_read_vram = saved;
    }
  });
  assert.deepEqual(unavailableVramCapability, { debugger: true, vram: false, availableRegions: [] });

  const program = {
    sourceMode: 'basic+asm',
    basic: '10 PRINT "MCP READY"',
    asm: '',
    slang: '',
  };
  const loaded = await page.evaluate((value) => {
    const current = window.X1PenAutomation.getProgram();
    return window.X1PenAutomation.setProgram(value, current.revision, current.revisionEpoch);
  }, program);
  assert.equal(loaded.basic, program.basic);
  assert.equal(loaded.sourceMode, program.sourceMode);
  assert.equal(loaded.revision, 1);
  assert.equal(typeof loaded.instanceId, 'string');
  assert.equal(typeof loaded.revisionEpoch, 'string');

  const validation = await page.evaluate(() => window.X1PenAutomation.validate());
  assert.equal(validation.ok, true);
  assert.ok(validation.output.basicBytes > 0);

  await page.evaluate(() => window.XmilControls.setKeyMode(1));
  const { result, events, modeChanges } = await runWithRecordedKeyEvents();
  assert.equal(result.ok, true);
  assert.equal(result.sourceMode, 'basic+asm');
  assertSequentialKeyEvents(events, [0x52, 0x55, 0x4E, 0x0D], 85);
  assert.deepEqual(modeChanges, [0, 1], 'automation run must restore the JoyKey mode');

  const apiReentry = await page.evaluate(async () => {
    const api = window.X1PenAutomation;
    const module = window.Module;
    const savedDown = module._js_key_down;
    const savedUp = module._js_key_up;
    const events = [];
    module._js_key_down = (vk) => { events.push(['down', vk]); return savedDown.call(module, vk); };
    module._js_key_up = (vk) => { events.push(['up', vk]); return savedUp.call(module, vk); };
    try {
      const firstPromise = api.run();
      const immediate = api.getStatus().runAdmission;
      const secondPromise = api.run();
      const [first, second] = await Promise.all([firstPromise, secondPromise]);
      return { first, second, immediate, events, final: api.getStatus().runAdmission };
    } finally {
      module._js_key_down = savedDown;
      module._js_key_up = savedUp;
    }
  });
  assert.equal(apiReentry.first.ok, true);
  assert.equal(apiReentry.second.ok, false);
  assert.equal(apiReentry.second.code, 'RUN_IN_PROGRESS');
  assert.equal(apiReentry.second.retryable, true);
  assert.equal(apiReentry.immediate.pending, true, 'Automation must reserve synchronously before queueing');
  assert.equal(apiReentry.final.pending, false);
  assert.deepEqual(apiReentry.events.map(([type, vk]) => [type, vk]),
    [0x52, 0x55, 0x4E, 0x0D].flatMap((vk) => [['down', vk], ['up', vk]]));

  const uiReentry = await page.evaluate(async () => {
    const api = window.X1PenAutomation;
    const module = window.Module;
    const button = document.getElementById('btn-run');
    const savedDown = module._js_key_down;
    const savedUp = module._js_key_up;
    const events = [];
    module._js_key_down = (vk) => { events.push(['down', vk]); return savedDown.call(module, vk); };
    module._js_key_up = (vk) => { events.push(['up', vk]); return savedUp.call(module, vk); };
    try {
      button.click();
      const reserved = {
        ariaDisabled: button.getAttribute('aria-disabled'),
        ariaBusy: button.getAttribute('aria-busy'),
        pending: api.getStatus().runAdmission.pending,
      };
      button.removeAttribute('aria-disabled');
      button.removeAttribute('aria-busy');
      button.click();
      const deadline = Date.now() + 5000;
      while (api.getStatus().runAdmission.pending && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return { reserved, events, final: api.getStatus().runAdmission };
    } finally {
      module._js_key_down = savedDown;
      module._js_key_up = savedUp;
    }
  });
  assert.deepEqual(uiReentry.reserved, { ariaDisabled: 'true', ariaBusy: 'true', pending: true });
  assert.equal(uiReentry.final.pending, false);
  assert.deepEqual(uiReentry.events,
    [0x52, 0x55, 0x4E, 0x0D].flatMap((vk) => [['down', vk], ['up', vk]]));

  await page.waitForTimeout(500);
  const screenshot = await page.locator('#canvas').screenshot({ type: 'png' });
  assert.ok(screenshot.length > 1_000, 'canvas screenshot should contain rendered output');

  const settings = await page.evaluate(() => window.XmilControls.getSettings());
  assert.equal(settings.keyMode, 1, 'automation run must preserve the JoyKey setting');
});

test('SLANG Import inserts formatted values at the cursor', { timeout: 180_000 }, async () => {
  const basicTab = page.locator('.editor-tab[data-tab="basic"]');
  const asmTab = page.locator('.editor-tab[data-tab="asm"]');
  const slangTab = page.locator('.editor-tab[data-tab="slang"]');
  const asmImport = page.locator('#btn-asm-import');
  const slangImport = page.locator('#btn-slang-import');
  const slangLines = page.locator('#slang-editor-container .cm-line');

  async function setProgram(sourceMode, source) {
    await page.evaluate(({ mode, text }) => {
      const api = window.X1PenAutomation;
      const current = api.getProgram();
      return api.setProgram({
        sourceMode: mode,
        basic: mode === 'basic+asm' ? text : '',
        asm: mode === 'asm' ? text : '',
        slang: mode === 'slang' ? text : '',
      }, current.revision, current.revisionEpoch);
    }, { mode: sourceMode, text: source });
  }

  async function importFile(button, name, bytes, statusText) {
    const chooserPromise = page.waitForEvent('filechooser');
    await button.click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name,
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(bytes),
    });
    await page.waitForFunction(
      (expected) => document.getElementById('x1pen-status').textContent.includes(expected),
      statusText,
    );
  }

  await basicTab.click();
  assert.equal(await asmImport.isVisible(), false);
  assert.equal(await slangImport.isVisible(), false);
  await asmTab.click();
  assert.equal(await asmImport.isVisible(), true);
  assert.equal(await slangImport.isVisible(), false);
  await slangTab.click();
  assert.equal(await asmImport.isVisible(), false);
  assert.equal(await slangImport.isVisible(), true);

  await setProgram('slang', 'PREFIX\n\nSUFFIX');
  await slangTab.click();
  await slangLines.nth(1).click();
  await page.keyboard.press('Home');
  const bytes = Array.from({ length: 17 }, (_, index) => index);
  await importFile(slangImport, 'values.bin', bytes, 'Imported: values.bin (17 bytes)');
  const values = Array.from({ length: 16 }, (_, index) =>
    '$' + index.toString(16).toUpperCase().padStart(2, '0')).join(',') + ',\n$10';
  let source = await page.evaluate(() => window.X1PenAutomation.getProgram().slang);
  assert.equal(source, 'PREFIX\n' + values + '\nSUFFIX');
  assert.doesNotMatch(values, /,$/);

  await importFile(slangImport, 'cursor.bin', [0xaa], 'Imported: cursor.bin (1 bytes)');
  source = await page.evaluate(() => window.X1PenAutomation.getProgram().slang);
  assert.equal(source, 'PREFIX\n' + values + '$AA\nSUFFIX', 'cursor moves to inserted end');

  await setProgram('slang', 'PREFIX\nSELECTME\nSUFFIX');
  await slangTab.click();
  await slangLines.nth(1).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await importFile(slangImport, 'selection.bin', [0xbb], 'Imported: selection.bin (1 bytes)');
  source = await page.evaluate(() => window.X1PenAutomation.getProgram().slang);
  assert.equal(source, 'PREFIX\nSELECTME$BB\nSUFFIX', 'selection remains and insertion uses its head');

  await importFile(slangImport, 'empty.bin', [], 'Empty file cannot be imported');
  assert.equal(await page.evaluate(() => window.X1PenAutomation.getProgram().slang), source);
  await importFile(
    slangImport,
    'oversize.bin',
    Buffer.alloc(128 * 1024 + 1),
    'File too large (max 128KB)',
  );
  assert.equal(await page.evaluate(() => window.X1PenAutomation.getProgram().slang), source);

  await setProgram('asm', 'RET');
  await asmTab.click();
  await page.locator('#asm-editor-container .cm-line').first().click();
  await page.keyboard.press('Home');
  await importFile(asmImport, 'asm.bin', [1, 2], 'Imported: asm.bin (2 bytes)');
  assert.equal(
    await page.evaluate(() => window.X1PenAutomation.getProgram().asm),
    '; imported: asm.bin (2 bytes)\nDB $01,$02\nRET',
  );

  await setProgram('basic+asm', '10 PRINT "MCP READY"');
  await basicTab.click();
});

test('keyboard input is bounded, serialized with Run, and always releases ownership', { timeout: 60_000 }, async () => {
  const behavior = await page.evaluate(async () => {
    const api = window.X1PenAutomation;
    const module = window.Module;
    const savedDown = module._js_key_down;
    const savedUp = module._js_key_up;
    const savedGate = module._js_set_automation_input_lock;
    const events = [];
    const gates = [];
    module._js_key_down = (vk) => { events.push(['down', vk]); return savedDown.call(module, vk); };
    module._js_key_up = (vk) => { events.push(['up', vk]); return savedUp.call(module, vk); };
    module._js_set_automation_input_lock = (locked) => {
      gates.push(locked);
      return savedGate.call(module, locked);
    };
    try {
      const first = api.sendKey(0x41, 120);
      const busy = await api.sendKey(0x42, 80).then(
        () => null,
        (error) => ({ code: error.code, feature: error.feature }),
      );
      const run = api.run();
      const [sent, runResult] = await Promise.all([first, run]);
      return { sent, busy, runResult, events, gates };
    } finally {
      module._js_key_down = savedDown;
      module._js_key_up = savedUp;
      module._js_set_automation_input_lock = savedGate;
    }
  });
  assert.deepEqual(behavior.sent, { ok: true, code: 0x41, durationMs: 120 });
  assert.deepEqual(behavior.busy, { code: 'INPUT_IN_PROGRESS', feature: 'input.keyboard' });
  assert.equal(behavior.runResult.ok, true);
  assert.deepEqual(behavior.events.map(([type, vk]) => [type, vk]), [
    ['down', 0x41], ['up', 0x41],
    ...[0x52, 0x55, 0x4E, 0x0D].flatMap((vk) => [['down', vk], ['up', vk]]),
  ]);
  assert.deepEqual(behavior.gates, [1, 0, 1, 0]);

  const validation = await page.evaluate(async () => {
    const api = window.X1PenAutomation;
    const invalid = [];
    for (const args of [[0x10, 80], [0x41, 79], ['KeyA', 80]]) {
      try {
        await api.sendKey(args[0], args[1]);
        invalid.push(null);
      } catch (error) {
        invalid.push(error.code);
      }
    }
    return invalid;
  });
  assert.deepEqual(validation, ['INVALID_INPUT', 'INVALID_INPUT', 'INVALID_INPUT']);

  const recovery = await page.evaluate(async () => {
    const api = window.X1PenAutomation;
    const module = window.Module;
    const savedDown = module._js_key_down;
    const savedGate = module._js_set_automation_input_lock;
    const gates = [];
    let fail = true;
    module._js_key_down = (vk) => {
      if (fail) {
        fail = false;
        throw new Error('injected key-down failure');
      }
      return savedDown.call(module, vk);
    };
    module._js_set_automation_input_lock = (locked) => {
      gates.push(locked);
      return savedGate.call(module, locked);
    };
    try {
      const failed = await api.sendKey(0x41, 80).then(
        () => null,
        (error) => error.message,
      );
      const recovered = await api.sendKey(0x42, 80);
      return { failed, recovered, gates };
    } finally {
      module._js_key_down = savedDown;
      module._js_set_automation_input_lock = savedGate;
    }
  });
  assert.match(recovery.failed, /injected key-down failure/);
  assert.deepEqual(recovery.recovered, { ok: true, code: 0x42, durationMs: 80 });
  assert.deepEqual(recovery.gates, [1, 0, 1, 0], 'input ownership must release after rejection');

  const unavailable = await page.evaluate(async () => {
    const api = window.X1PenAutomation;
    const module = window.Module;
    const saved = module._js_set_automation_input_lock;
    module._js_set_automation_input_lock = null;
    try {
      const advertised = api.getStatus().x1pen.features.includes('input.keyboard');
      const errorCode = await api.sendKey(0x41, 80).then(
        () => null,
        (error) => error.code,
      );
      return { advertised, errorCode };
    } finally {
      module._js_set_automation_input_lock = saved;
    }
  });
  assert.deepEqual(unavailable, { advertised: false, errorCode: 'INPUT_UNAVAILABLE' });

  const hidden = await page.evaluate(async () => {
    const api = window.X1PenAutomation;
    const module = window.Module;
    const originalDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    const savedDown = module._js_key_down;
    let downCalls = 0;
    module._js_key_down = (...args) => {
      downCalls++;
      return savedDown.apply(module, args);
    };
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    try {
      const errorCode = await api.sendKey(0x41, 80).then(
        () => null,
        (error) => error.code,
      );
      return { errorCode, downCalls };
    } finally {
      module._js_key_down = savedDown;
      if (originalDescriptor) {
        Object.defineProperty(document, 'visibilityState', originalDescriptor);
      } else {
        delete document.visibilityState;
      }
    }
  });
  assert.deepEqual(hidden, { errorCode: 'INPUT_TAB_NOT_VISIBLE', downCalls: 0 });
});

test('pad input is bounded, queued, superseded by release, and cleaned on disconnect', { timeout: 60_000 }, async () => {
  const behavior = await page.evaluate(async () => {
    const api = window.X1PenAutomation;
    const module = window.Module;
    const savedSet = module._js_set_automation_pad;
    const savedRelease = module._js_release_automation_pads;
    const calls = [];
    module._js_set_automation_pad = (port, bits) => {
      calls.push(['set', port, bits]);
      return savedSet.call(module, port, bits);
    };
    module._js_release_automation_pads = () => {
      calls.push(['release-all']);
      return savedRelease.call(module);
    };
    try {
      const first = api.setPad(1, 0xFE);
      const busy = await api.setPad(2, 0xBF).then(
        () => null,
        (error) => error.code,
      );
      const firstResult = await first;
      const released = await api.setPad(1, 0xFF);

      const queued = api.setPad(1, 0xFE).then(
        () => null,
        (error) => error.code,
      );
      const supersedingRelease = await api.setPad(1, 0xFF);
      const cancelled = await queued;

      await api.setPad(2, 0xBF);
      api.setConnectionState(false);
      return {
        firstResult, busy, released, supersedingRelease, cancelled, calls,
      };
    } finally {
      module._js_set_automation_pad = savedSet;
      module._js_release_automation_pads = savedRelease;
      api.releasePads();
    }
  });
  assert.deepEqual(behavior.firstResult, { ok: true, port: 1, bits: 0xFE });
  assert.equal(behavior.busy, 'PAD_INPUT_IN_PROGRESS');
  assert.deepEqual(behavior.released, { ok: true, port: 1, bits: 0xFF });
  assert.deepEqual(behavior.supersedingRelease, { ok: true, port: 1, bits: 0xFF });
  assert.equal(behavior.cancelled, 'PAD_INPUT_CANCELLED');
  assert.deepEqual(behavior.calls, [
    ['set', 1, 0xFE],
    ['set', 1, 0xFF],
    ['set', 1, 0xFF],
    ['set', 2, 0xBF],
    ['release-all'],
  ]);

  const ordering = await page.evaluate(async () => {
    const api = window.X1PenAutomation;
    const module = window.Module;
    const savedDown = module._js_key_down;
    const savedUp = module._js_key_up;
    const savedSet = module._js_set_automation_pad;
    const events = [];
    module._js_key_down = (vk) => { events.push(['down', vk]); return savedDown.call(module, vk); };
    module._js_key_up = (vk) => { events.push(['up', vk]); return savedUp.call(module, vk); };
    module._js_set_automation_pad = (port, bits) => {
      events.push(['pad', port, bits]);
      return savedSet.call(module, port, bits);
    };
    try {
      const run = api.run();
      const pad = api.setPad(1, 0xFE);
      await Promise.all([run, pad]);
      await api.setPad(1, 0xFF);
      return events;
    } finally {
      module._js_key_down = savedDown;
      module._js_key_up = savedUp;
      module._js_set_automation_pad = savedSet;
      api.releasePads();
    }
  });
  assert.deepEqual(ordering.slice(0, 8),
    [0x52, 0x55, 0x4E, 0x0D].flatMap((vk) => [['down', vk], ['up', vk]]));
  assert.deepEqual(ordering.slice(8), [['pad', 1, 0xFE], ['pad', 1, 0xFF]]);

  const hidden = await page.evaluate(async () => {
    const api = window.X1PenAutomation;
    const originalDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    try {
      const pressError = await api.setPad(1, 0xFE).then(
        () => null,
        (error) => error.code,
      );
      const release = await api.setPad(1, 0xFF);
      return { pressError, release };
    } finally {
      if (originalDescriptor) Object.defineProperty(document, 'visibilityState', originalDescriptor);
      else delete document.visibilityState;
      api.releasePads();
    }
  });
  assert.deepEqual(hidden, {
    pressError: 'INPUT_TAB_NOT_VISIBLE',
    release: { ok: true, port: 1, bits: 0xFF },
  });

  const validation = await page.evaluate(async () => {
    const api = window.X1PenAutomation;
    const module = window.Module;
    const invalid = [];
    for (const args of [[0, 255], [3, 0], [1, -1], [2, 256], [1, 1.5]]) {
      invalid.push(await api.setPad(args[0], args[1]).then(
        () => null,
        (error) => error.code,
      ));
    }
    const savedSet = module._js_set_automation_pad;
    let fail = true;
    module._js_set_automation_pad = (port, bits) => {
      if (fail) {
        fail = false;
        return 0;
      }
      return savedSet.call(module, port, bits);
    };
    try {
      const failed = await api.setPad(1, 0xFE).then(
        () => null,
        (error) => error.code,
      );
      const recovered = await api.setPad(1, 0xFE);
      return { invalid, failed, recovered };
    } finally {
      module._js_set_automation_pad = savedSet;
      api.releasePads();
    }
  });
  assert.deepEqual(validation.invalid, Array(5).fill('INVALID_INPUT'));
  assert.equal(validation.failed, 'INPUT_UNAVAILABLE');
  assert.deepEqual(validation.recovered, { ok: true, port: 1, bits: 0xFE });

  const unavailable = await page.evaluate(async () => {
    const api = window.X1PenAutomation;
    const module = window.Module;
    const savedRelease = module._js_release_automation_pads;
    module._js_release_automation_pads = null;
    try {
      return {
        advertised: api.getStatus().x1pen.features.includes('input.pad'),
        errorCode: await api.setPad(1, 0xFE).then(
          () => null,
          (error) => error.code,
        ),
      };
    } finally {
      module._js_release_automation_pads = savedRelease;
      api.releasePads();
    }
  });
  assert.deepEqual(unavailable, { advertised: false, errorCode: 'INPUT_UNAVAILABLE' });
});

test('keyboard input changes captured guest screens for character entry and PRESS FIRE', { timeout: 60_000 }, async () => {
  const result = await page.evaluate(async () => {
    const api = window.X1PenAutomation;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitForScreenChange = async (before, timeoutMs = 3000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const current = api.captureScreen();
        if (current !== before) return current;
        await sleep(50);
      }
      throw new Error('Timed out waiting for captured X1Pen screen to change');
    };
    const current = api.getProgram();
    const program = await api.setProgram({
      sourceMode: 'basic+asm',
      basic: [
        '10 CLS',
        '20 PRINT "TYPE 1"',
        '30 INPUT A',
        '40 PRINT "VALUE";A',
        '50 PRINT "PRESS FIRE"',
        '60 A=GET',
        '70 IF A=0 THEN 60',
        '80 CLS',
        '90 PRINT "FIRE OK"',
      ].join('\n'),
      asm: '',
      slang: '',
    }, current.revision, current.revisionEpoch);
    const validation = await api.validate();
    if (!validation.ok) throw new Error('Acceptance program did not validate');
    const run = await api.run();
    if (!run.ok) throw new Error('Acceptance program did not run');
    await sleep(300);

    const beforeCharacter = api.captureScreen();
    await api.sendKey(0x31, 80);
    const afterCharacter = await waitForScreenChange(beforeCharacter);
    await api.sendKey(0x0D, 80);
    const pressFire = await waitForScreenChange(afterCharacter);
    await api.sendKey(0x20, 80);
    const afterFire = await waitForScreenChange(pressFire);
    return {
      revision: program.revision,
      characterChanged: beforeCharacter !== afterCharacter,
      pressFireChanged: afterCharacter !== pressFire,
      fireTransitionChanged: pressFire !== afterFire,
      capturePrefixes: [beforeCharacter, afterCharacter, pressFire, afterFire]
        .map((value) => value.slice(0, 22)),
    };
  });
  assert.equal(result.characterChanged, true);
  assert.equal(result.pressFireChanged, true);
  assert.equal(result.fireTransitionChanged, true);
  assert.deepEqual(result.capturePrefixes, Array(4).fill('data:image/png;base64,'));
});

test('pad input drives guest JOY edges and independent ports in captured screens', { timeout: 60_000 }, async () => {
  const result = await page.evaluate(async () => {
    const api = window.X1PenAutomation;
    const previousSettings = window.XmilControls.getSettings();
    window.XmilControls.setJoystick(false);
    window.XmilControls.setKeyMode(2);
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitForScreenChange = async (before, timeoutMs = 3000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const current = api.captureScreen();
        if (current !== before) return current;
        await sleep(50);
      }
      throw new Error('Timed out waiting for captured X1Pen pad screen to change');
    };
    const loadAndRun = async (basic) => {
      api.releasePads();
      const current = api.getProgram();
      await api.setProgram(
        { sourceMode: 'basic+asm', basic, asm: '', slang: '' },
        current.revision,
        current.revisionEpoch,
      );
      const validation = await api.validate();
      if (!validation.ok) throw new Error('Pad acceptance program did not validate');
      const run = await api.run();
      if (!run.ok) throw new Error('Pad acceptance program did not run');
      await sleep(300);
    };

    try {
    await loadAndRun([
      '10 CLS',
      '20 O=JOY(0)',
      '30 N=JOY(0)',
      '40 E=(N XOR O) AND O',
      '50 IF E=0 THEN 30',
      '60 PRINT "EDGE";E',
      '70 O=N',
      '80 GOTO 30',
    ].join('\n'));
    const beforeEdge = api.captureScreen();
    await api.setPad(1, 0xFE);
    const afterUp = await waitForScreenChange(beforeEdge);
    await api.setPad(1, 0xFF);
    await api.setPad(1, 0xBF);
    const afterButton = await waitForScreenChange(afterUp);

    await loadAndRun([
      '10 CLS',
      '20 A=JOY(0)',
      '30 B=JOY(1)',
      '40 LOCATE 0,0',
      '50 PRINT A;B;"   "',
      '60 GOTO 20',
    ].join('\n'));
    const bothReleased = api.captureScreen();
    await api.setPad(2, 0xBF);
    const port2Held = await waitForScreenChange(bothReleased);
    await api.setPad(1, 0xFE);
    const bothHeld = await waitForScreenChange(port2Held);

    window.Module._js_xmil_reset();
    await sleep(100);
    const rerun = await api.run();
    if (!rerun.ok) throw new Error('Pad reset verification program did not rerun');
    await sleep(300);
    const afterReset = await waitForScreenChange(bothHeld);
    return {
      upEdgeChanged: beforeEdge !== afterUp,
      buttonEdgeChanged: afterUp !== afterButton,
      port2Changed: bothReleased !== port2Held,
      port1IndependentChanged: port2Held !== bothHeld,
      resetChangedHeldScreen: bothHeld !== afterReset,
      capturePrefixes: [
        beforeEdge, afterUp, afterButton, bothReleased, port2Held, bothHeld, afterReset,
      ].map((value) => value.slice(0, 22)),
    };
    } finally {
      api.releasePads();
      window.XmilControls.setJoystick(previousSettings.joystickEnable !== false);
      window.XmilControls.setKeyMode(previousSettings.keyMode);
    }
  });
  assert.deepEqual(result, {
    upEdgeChanged: true,
    buttonEdgeChanged: true,
    port2Changed: true,
    port1IndependentChanged: true,
    resetChangedHeldScreen: true,
    capturePrefixes: Array(7).fill('data:image/png;base64,'),
  });
});

test('SLANG STICK reads JoyKey and pad input with defined interrupt behavior', { timeout: 90_000 }, async () => {
  const probeAddress = 0x4000;
  const previousSettings = await page.evaluate(() => window.XmilControls.getSettings());
  const readProbe = (length = 16) => page.evaluate(({ address, byteLength }) => (
    window.X1PenAutomation.debugger.readMemory(address, byteLength).bytes
  ), { address: probeAddress, byteLength: length });
  const waitForProbe = async (expected, timeout = 5000) => {
    await page.waitForFunction(({ address, values }) => {
      const bytes = window.X1PenAutomation.debugger.readMemory(address, values.length).bytes;
      return values.every((value, index) => value === null || bytes[index] === value);
    }, { address: probeAddress, values: expected }, { timeout });
    return readProbe(expected.length);
  };
  const loadAndRunSlang = (slang) => page.evaluate(async (source) => {
    const api = window.X1PenAutomation;
    api.releasePads();
    const current = api.getProgram();
    await api.setProgram({
      sourceMode: 'slang', basic: '', asm: '', slang: source,
    }, current.revision, current.revisionEpoch);
    const validation = await api.validate();
    if (!validation.ok) {
      throw new Error(`STICK acceptance program did not validate: ${JSON.stringify(validation.diagnostics)}`);
    }
    const run = await api.run();
    if (!run.ok) throw new Error(`STICK acceptance program did not run: ${JSON.stringify(run)}`);
    return { validation, run };
  }, slang);
  const clearProbe = [
    '  I=0;',
    '  LOOP',
    '  {',
    '    MEM[$4000+I]=0;',
    '    I=I+1;',
    '    IF I==16 THEN EXIT;',
    '  }',
  ];

  try {
    await page.evaluate(() => {
      window.XmilControls.setJoystick(false);
      window.XmilControls.setKeyMode(1);
      window.X1PenAutomation.releasePads();
    });

    await loadAndRunSlang([
      'MAIN()',
      '{',
      '  VAR I, BASE;',
      ...clearProbe,
      '  BASE=3;',
      '  LOOP',
      '  {',
      '    MEM[$4000]=STICK(0);',
      '    MEM[$4001]=STICK(1);',
      '    MEM[$4002]=STICK(2);',
      '    MEM[$4003]=STICK($100);',
      '    MEM[$4004]=STICK($FFFF);',
      '    MEM[$4005]=BASE+STICK(0)*2;',
      '    MEMW[$4006]=MEMW[$4006]+1;',
      '  }',
      '}',
    ].join('\n'));

    assert.deepEqual(await waitForProbe([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x01]),
      [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x01]);

    await page.evaluate(() => window.X1PenAutomation.setPad(1, 0xFE));
    assert.deepEqual(await waitForProbe([0xFE, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]),
      [0xFE, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
    await page.evaluate(() => window.X1PenAutomation.setPad(2, 0xBF));
    assert.deepEqual((await waitForProbe([0xFE, 0xBF])).slice(0, 2), [0xFE, 0xBF]);
    await page.evaluate(() => window.X1PenAutomation.releasePads());
    await waitForProbe([0xFF, 0xFF]);

    await page.keyboard.down('ArrowUp');
    assert.equal((await waitForProbe([0xFE]))[0], 0xFE);
    await page.keyboard.up('ArrowUp');
    assert.equal((await waitForProbe([0xFF]))[0], 0xFF);

    await loadAndRunSlang([
      'MAIN()',
      '{',
      '  VAR I, BASE, SAMPLE;',
      ...clearProbe,
      '  PSG_INIT(1);',
      '  LOOP',
      '  {',
      '    IF STICK(0)!=$FF THEN EXIT;',
      '  }',
      '  I=0; BASE=3;',
      '  LOOP',
      '  {',
      '    SAMPLE=STICK(0);',
      '    MEM[$4000]=SAMPLE;',
      '    MEM[$4001]=BASE+STICK(0)*2;',
      '    I=I+1;',
      '    IF I==1000 THEN EXIT;',
      '  }',
      '  MEMW[$4002]=I;',
      '  MEM[$4004]=$A5;',
      '  LOOP { }',
      '}',
    ].join('\n'));
    await page.evaluate(() => window.X1PenAutomation.setPad(1, 0xFE));
    assert.deepEqual(await waitForProbe([0xFE, 0xFF, 0xE8, 0x03, 0xA5]),
      [0xFE, 0xFF, 0xE8, 0x03, 0xA5]);
    const ctcState = await page.evaluate(() => window.X1PenAutomation.debugger.pause());
    assert.equal(ctcState.registers.iff1, true, 'valid STICK calls must leave interrupts enabled');

    await loadAndRunSlang([
      'FORCE_DI(0) { CODE($F3,$C9); }',
      'MAIN()',
      '{',
      '  VAR I;',
      ...clearProbe,
      '  FORCE_DI();',
      '  MEM[$4000]=STICK(0);',
      '  MEM[$4001]=$A5;',
      '  LOOP { }',
      '}',
    ].join('\n'));
    await waitForProbe([0xFF, 0xA5]);
    const validAfterDi = await page.evaluate(() => window.X1PenAutomation.debugger.pause());
    assert.equal(validAfterDi.registers.iff1, true,
      'a valid STICK call must re-enable interrupts even when the caller used DI');

    await loadAndRunSlang([
      'FORCE_DI(0) { CODE($F3,$C9); }',
      'MAIN()',
      '{',
      '  VAR I;',
      ...clearProbe,
      '  FORCE_DI();',
      '  MEM[$4000]=STICK(2);',
      '  MEM[$4001]=$A5;',
      '  LOOP { }',
      '}',
    ].join('\n'));
    await waitForProbe([0xFF, 0xA5]);
    const invalidAfterDi = await page.evaluate(() => window.X1PenAutomation.debugger.pause());
    assert.equal(invalidAfterDi.registers.iff1, false,
      'an invalid STICK call must return before changing interrupt state');
  } finally {
    await page.keyboard.up('ArrowUp').catch(() => {});
    await page.evaluate((settings) => {
      const api = window.X1PenAutomation;
      api.releasePads();
      window.Module._js_xmil_reset();
      window.XmilControls.setJoystick(settings.joystickEnable !== false);
      window.XmilControls.setKeyMode(settings.keyMode);
    }, previousSettings);
  }
});

test('SLANG TATTR writes only the current visible text attribute cell', { timeout: 90_000 }, async () => {
  const probeAddress = 0x4000;
  const loadAndRunSlang = (slang) => page.evaluate(async (source) => {
    const api = window.X1PenAutomation;
    const current = api.getProgram();
    await api.setProgram({
      sourceMode: 'slang', basic: '', asm: '', slang: source,
    }, current.revision, current.revisionEpoch);
    const validation = await api.validate();
    if (!validation.ok) {
      throw new Error(`TATTR acceptance program did not validate: ${JSON.stringify(validation.diagnostics)}`);
    }
    const run = await api.run();
    if (!run.ok) throw new Error(`TATTR acceptance program did not run: ${JSON.stringify(run)}`);
    return { validation, run };
  }, slang);
  const waitForProbe = async (offset, expected, timeout = 5000) => {
    await page.waitForFunction(({ address, values }) => {
      const bytes = window.X1PenAutomation.debugger.readMemory(address, values.length).bytes;
      return values.every((value, index) => value === null || bytes[index] === value);
    }, { address: probeAddress + offset, values: expected }, { timeout });
  };
  const readMemory = (offset, length) => page.evaluate(({ address, byteLength }) => (
    window.X1PenAutomation.debugger.readMemory(address, byteLength).bytes
  ), { address: probeAddress + offset, byteLength: length });
  const readVram = (region, offset, length = 1) => page.evaluate((request) => (
    window.X1PenAutomation.debugger.readVram(request).bytes
  ), { region, offset, length });

  try {
    // No WIDTH or LOCATE call: LSX's initialized cursor and the runtime's default
    // 80-column mode must still make the current-cell operation well-defined.
    await loadAndRunSlang([
      'MAIN()',
      '{',
      '  MEM[$4000]=TATTR($5A);',
      '  MEM[$4001]=$A5;',
      '  LOOP { }',
      '}',
    ].join('\n'));
    await waitForProbe(0, [1, 0xA5]);
    const defaultAttributes = await readVram('attribute', 0, 2000);
    assert.ok(defaultAttributes.includes(0x5A), 'standalone TATTR must write a visible default-mode cell');
    const defaultInterrupts = await page.evaluate(() => window.X1PenAutomation.debugger.pause());
    assert.equal(defaultInterrupts.registers.iff1, true);

    await loadAndRunSlang([
      'ARRAY BYTE GLYPH[] = {',
      '  $3C,0,0, $7E,0,0, $DB,0,0, $FF,0,0,',
      '  $A5,0,0, $FF,0,0, $66,0,0, $3C,0,0',
      '};',
      'MAIN()',
      '{',
      '  WIDTH(40);',
      '  LOCATE(4,3);',
      '  MEM[$4000]=TATTR($27);',
      '  MEM[$4001]=PORT[$207C];',
      '  WIDTH(40);',
      '  MEM[$4002]=PORT[$207C];',
      '  LOCATE(4,3);',
      '  MEM[$4003]=TATTR($27);',
      '  MEM[$4004]=PORT[$207C];',
      '  LOCATE(39,24);',
      '  MEM[$4005]=TATTR($FF);',
      '  PORT[$23E8]=$66;',
      '  MEM[$4011]=PORT[$23E8];',
      '  LOCATE(0,25);',
      '  MEM[$4006]=TATTR($22);',
      '  MEM[$4012]=PORT[$23E8];',
      '  LOCATE(3,3);',
      '  TATTR($55);',
      '  MEM[$4007]=TATTR($100);',
      '  LOCATE(40,0);',
      '  MEM[$4008]=TATTR($33);',
      '  PCGDEFS(128,GLYPH,1);',
      '  LOCATE(2,3);',
      '  MEMW[$4009]=CSR();',
      '  MEM[$400B]=TATTR($27);',
      '  MEMW[$400C]=CSR();',
      '  PRINT(CHR$(128));',
      '  MEMW[$400E]=CSR();',
      '  LOCATE(1,1);',
      '  MEM[$4010]=TATTR(0);',
      '  MEM[$4013]=$A5;',
      '  LOOP { }',
      '}',
    ].join('\n'));
    await waitForProbe(19, [0xA5]);
    assert.deepEqual(await readMemory(0, 20), [
      1, 0x27, 7, 1, 0x27, 1, 0, 0, 1,
      0x02, 0x03, 1, 0x02, 0x03, 0x03, 0x03, 1,
      0x66, 0x66, 0xA5,
    ]);
    assert.deepEqual(await readVram('attribute', 999), [0xFF]);
    assert.deepEqual(await readVram('attribute', 123), [0x55]);
    assert.deepEqual(await readVram('attribute', 40), [0x33]);
    assert.deepEqual(await readVram('attribute', 41), [0]);
    assert.deepEqual(await readVram('attribute', 122), [0x27]);
    assert.deepEqual(await readVram('text', 122), [128]);

    await loadAndRunSlang([
      'MAIN()',
      '{',
      '  WIDTH(80);',
      '  LOCATE(79,24);',
      '  MEM[$4000]=TATTR($FF);',
      '  PORT[$27D0]=$66;',
      '  MEM[$4004]=PORT[$27D0];',
      '  LOCATE(0,25);',
      '  MEM[$4001]=TATTR($22);',
      '  MEM[$4005]=PORT[$27D0];',
      '  LOCATE(80,0);',
      '  MEM[$4002]=TATTR($33);',
      '  MEM[$4006]=$A5;',
      '  LOOP { }',
      '}',
    ].join('\n'));
    await waitForProbe(0, [1, 0, 1, null, 0x66, 0x66, 0xA5]);
    assert.deepEqual(await readVram('attribute', 1999), [0xFF]);
    assert.deepEqual(await readVram('attribute', 80), [0x33]);

    await loadAndRunSlang([
      'FORCE_DI(0) { CODE($F3,$C9); }',
      'MAIN()',
      '{',
      '  FORCE_DI();',
      '  MEM[$4000]=TATTR($27);',
      '  MEM[$4001]=$A5;',
      '  LOOP { }',
      '}',
    ].join('\n'));
    await waitForProbe(0, [1, 0xA5]);
    const disabledInterrupts = await page.evaluate(() => window.X1PenAutomation.debugger.pause());
    assert.equal(disabledInterrupts.registers.iff1, false,
      'TATTR must preserve a disabled interrupt state');
  } finally {
    await page.evaluate(() => window.Module._js_xmil_reset());
  }
});

test('SLANG runtime arity is rejected by Validate while valid VSYNC still runs', { timeout: 60_000 }, async () => {
  const probeAddress = 0x4000;
  const setSlang = (source) => page.evaluate(async (slang) => {
    const api = window.X1PenAutomation;
    const current = api.getProgram();
    return api.setProgram({
      sourceMode: 'slang', basic: '', asm: '', slang,
    }, current.revision, current.revisionEpoch);
  }, source);

  try {
    await setSlang([
      'MAIN() BEGIN',
      '  VSYNC();',
      'END;',
    ].join('\n'));
    const invalid = await page.evaluate(async () => ({
      validation: await window.X1PenAutomation.validate(),
      program: window.X1PenAutomation.getProgram(),
    }));
    assert.equal(invalid.validation.ok, false);
    assert.equal(invalid.validation.diagnostics.length, 1);
    assert.equal(invalid.validation.diagnostics[0].kind, 'slang');
    assert.equal(invalid.validation.diagnostics[0].line, 2);
    assert.match(invalid.validation.diagnostics[0].message, /expected 1 argument, got 0/);
    assert.equal(invalid.program.asm, '');

    await setSlang([
      'VSYNC_PROC() BEGIN',
      'END;',
      'MAIN() BEGIN',
      '  MEM[$4000]=$5A;',
      '  VSYNC(1);',
      '  MEM[$4001]=$A5;',
      '  LOOP { }',
      'END;',
    ].join('\n'));
    const valid = await page.evaluate(async () => {
      const api = window.X1PenAutomation;
      const validation = await api.validate();
      if (!validation.ok) {
        throw new Error(`VSYNC validation failed: ${JSON.stringify(validation.diagnostics)}`);
      }
      const run = await api.run();
      if (!run.ok) throw new Error(`VSYNC run failed: ${JSON.stringify(run)}`);
      return { validation, run };
    });
    assert.equal(valid.validation.ok, true);
    assert.equal(valid.run.ok, true);
    assert.equal(valid.run.sourceMode, 'slang');
    await page.waitForFunction((address) => {
      const bytes = window.X1PenAutomation.debugger.readMemory(address, 2).bytes;
      return bytes[0] === 0x5A && bytes[1] === 0xA5;
    }, probeAddress, { timeout: 5000 });
  } finally {
    await page.evaluate(() => window.Module._js_xmil_reset());
  }
});

test('documented SLANG inline assembly runs with the current calling convention', { timeout: 120_000 }, async () => {
  const probeAddress = 0x7000;
  const readMemory = (offset, length) => page.evaluate(({ address, byteLength }) => (
    window.X1PenAutomation.debugger.readMemory(address, byteLength).bytes
  ), { address: probeAddress + offset, byteLength: length });
  const waitForMemory = async (offset, expected, timeout = 15_000) => {
    const address = probeAddress + offset;
    try {
      await page.waitForFunction(({ address: target, values }) => {
        const bytes = window.X1PenAutomation.debugger.readMemory(target, values.length).bytes;
        return values.every((value, index) => value === null || bytes[index] === value);
      }, { address, values: expected }, { timeout, polling: 20 });
    } catch (error) {
      const diagnostic = await page.evaluate(({ target, length }) => {
        const api = window.X1PenAutomation;
        const state = api.debugger.getState();
        return {
          actual: api.debugger.readMemory(target, length).bytes,
          emulatorRunning: state.emulatorRunning,
          cycles: state.cycles,
          runState: state.runState,
        };
      }, { target: address, length: expected.length });
      throw new Error(
        `memory wait timed out: address=0x${address.toString(16)} ` +
        `expected=${JSON.stringify(expected)} diagnostic=${JSON.stringify(diagnostic)}`,
        { cause: error },
      );
    }
    return readMemory(offset, expected.length);
  };
  const loadAndRunSlang = (slang) => page.evaluate(async (source) => {
    const api = window.X1PenAutomation;
    const current = api.getProgram();
    await api.setProgram({
      sourceMode: 'slang', basic: '', asm: '', slang: source,
    }, current.revision, current.revisionEpoch);
    const validation = await api.validate();
    if (!validation.ok) {
      throw new Error(`inline acceptance program did not validate: ${JSON.stringify(validation.diagnostics)}`);
    }
    const run = await api.run();
    if (!run.ok) throw new Error(`inline acceptance program did not run: ${JSON.stringify(run)}`);
    return { validation, run };
  }, slang);
  try {
    // INKEY is intentionally not timing-asserted in this browser E2E. Its
    // LSX input queue can return zero, one, or repeated results for the same
    // bounded host hold depending on build speed and timer scheduling. The
    // deterministic runtime dispatch and documented examples are covered by
    // x1pen_reference_test.mjs; keyboard delivery is covered by the dedicated
    // bounded-input and captured-guest-screen tests above.
    await loadAndRunSlang([
      'MACHINE ASMFUNC(1):ASMROUTINE;',
      'MAIN() BEGIN',
      '  VAR VALUE;',
      '  VALUE=ASMFUNC(100);',
      '  PRINT(VALUE, /);',
      '  MEMW[$7000]=VALUE;',
      '  MEM[$7002]=$A5;',
      '  LOOP { }',
      'END;',
      '#ASM',
      'ASMROUTINE:',
      '  LD DE,123',
      '  ADD HL,DE',
      '  RET',
      '#END',
    ].join('\n'));
    assert.deepEqual(await waitForMemory(0, [223, 0, 0xA5]), [223, 0, 0xA5]);
    const textBytes = await page.evaluate(() => (
      window.X1PenAutomation.debugger.readVram({ region: 'text', offset: 0, length: 2000 }).bytes
    ));
    assert.ok(textBytes.some((value, index) => (
      value === 0x32 && textBytes[index + 1] === 0x32 && textBytes[index + 2] === 0x33
    )), 'text VRAM must contain the printed 223 sequence');
  } finally {
    await page.evaluate(() => window.Module._js_xmil_reset());
  }
});

test('automation operations are serialized and stale source modes are cleared', async () => {
  const programs = await page.evaluate(async () => {
    const first = window.X1PenAutomation.setProgram({ sourceMode: 'asm', asm: 'ORG $100\nRET' });
    const second = window.X1PenAutomation.setProgram({ sourceMode: 'slang', slang: 'main() BEGIN\nEND;' });
    return { results: await Promise.all([first, second]), final: window.X1PenAutomation.getProgram() };
  });

  assert.equal(programs.results[0].sourceMode, 'asm');
  assert.equal(programs.results[1].sourceMode, 'slang');
  assert.equal(programs.final.basic, '');
  assert.equal(programs.final.asm, '');
  assert.equal(programs.final.slang, 'main() BEGIN\nEND;');
  assert.equal(programs.final.sourceMode, 'slang');
  assert.ok(programs.final.revision > programs.results[0].revision);
});

test('a guarded SLANG replacement clears ASM generated by a real compile', { timeout: 60_000 }, async () => {
  const result = await page.evaluate(async () => {
    const api = window.X1PenAutomation;
    let current = api.getProgram();
    await api.setProgram({
      sourceMode: 'slang',
      slang: 'MAIN() BEGIN\n  PRINT("BEFORE");\nEND;',
    }, current.revision, current.revisionEpoch);
    const validation = await api.validate();
    if (!validation.ok) throw new Error(`SLANG validation failed: ${JSON.stringify(validation.diagnostics)}`);
    const run = await api.run();
    if (!run.ok) throw new Error(`SLANG Run failed: ${JSON.stringify(run)}`);
    const generated = api.getProgram();
    current = generated;
    const updated = await api.setProgram({
      sourceMode: 'slang',
      slang: 'MAIN() BEGIN\n  PRINT("AFTER");\nEND;',
    }, current.revision, current.revisionEpoch);
    return {
      generatedAsmLength: generated.asm.length,
      updatedAsm: updated.asm,
      persistedAsm: localStorage.getItem('x1pen_editor_asm'),
      updatedSlang: updated.slang,
    };
  });
  assert.ok(result.generatedAsmLength > 0, 'Run must produce generated ASM before the guarded edit');
  assert.equal(result.updatedAsm, '');
  assert.equal(result.persistedAsm, '');
  assert.match(result.updatedSlang, /AFTER/);
});

test('automation program updates persist across page reloads', { timeout: 60_000 }, async () => {
  const basic = '10 PRINT "PERSISTED BY MCP"';
  const stored = await page.evaluate(async (source) => {
    localStorage.setItem('x1pen_editor_asm', 'STALE ASM');
    localStorage.setItem('x1pen_editor_slang', 'STALE SLANG');
    await window.X1PenAutomation.setProgram({
      sourceMode: 'basic+asm',
      basic: source,
      asm: '',
    });
    return {
      basic: localStorage.getItem('x1pen_editor'),
      asm: localStorage.getItem('x1pen_editor_asm'),
      slang: localStorage.getItem('x1pen_editor_slang'),
    };
  }, basic);
  assert.deepEqual(stored, { basic, asm: '', slang: '' });

  await page.reload();
  await page.evaluate(() => window.X1PenAutomation.ready());
  const restored = await page.evaluate(() => window.X1PenAutomation.getProgram());
  assert.equal(restored.basic, basic);
  assert.equal(restored.asm, '');
  assert.equal(restored.slang, '');
  assert.equal(restored.sourceMode, 'basic+asm');
});

test('revision conflicts prevent stale AI updates', async () => {
  const result = await page.evaluate(async () => {
    const stale = window.X1PenAutomation.getProgram();
    await window.X1PenAutomation.setProgram({ sourceMode: 'basic+asm', basic: '10 PRINT "HUMAN"' });
    try {
      await window.X1PenAutomation.setProgram(
        { sourceMode: 'basic+asm', basic: '10 PRINT "AI"' },
        stale.revision,
        stale.revisionEpoch,
      );
      return null;
    } catch (error) {
      return {
        message: error.message,
        code: error.code,
        expectedRevision: error.expectedRevision,
        currentRevision: error.currentRevision,
        revisionEpoch: error.currentRevisionEpoch,
        source: window.X1PenAutomation.getProgram().basic,
      };
    }
  });
  assert.match(result.message, /Revision conflict/);
  assert.equal(result.code, 'REVISION_MISMATCH');
  assert.equal(result.expectedRevision + 1, result.currentRevision);
  assert.equal(typeof result.revisionEpoch, 'string');
  assert.equal(result.source, '10 PRINT "HUMAN"');
});

test('reload epoch prevents colliding stale revisions from mutating source', async () => {
  await page.reload();
  await page.evaluate(() => window.X1PenAutomation.ready());
  const stale = await page.evaluate(() => window.X1PenAutomation.getProgram());
  await page.evaluate(() => window.X1PenAutomation.setProgram({
    sourceMode: 'basic+asm', basic: '10 PRINT "HUMAN"',
  }));
  await page.reload();
  await page.evaluate(() => window.X1PenAutomation.ready());

  const result = await page.evaluate(async (baseline) => {
    const before = window.X1PenAutomation.getProgram();
    try {
      await window.X1PenAutomation.setProgram(
        { sourceMode: 'basic+asm', basic: '10 PRINT "STALE AI"' },
        baseline.revision,
        baseline.revisionEpoch,
      );
      return null;
    } catch (error) {
      return {
        code: error.code,
        message: error.message,
        before,
        after: window.X1PenAutomation.getProgram(),
        observedEpoch: error.currentRevisionEpoch,
      };
    }
  }, stale);
  assert.equal(result.code, 'REVISION_EPOCH_MISMATCH');
  assert.match(result.message, /does not match the current program epoch/);
  assert.doesNotMatch(result.message, /reloaded/);
  assert.equal(result.before.instanceId, stale.instanceId);
  assert.notEqual(result.before.revisionEpoch, stale.revisionEpoch);
  assert.equal(result.before.revision, stale.revision);
  assert.equal(result.observedEpoch, result.before.revisionEpoch);
  assert.equal(result.after.basic, '10 PRINT "HUMAN"');
});

test('revision-only guarded writes degrade visibly for legacy transports', async () => {
  const result = await page.evaluate(async () => {
    const current = window.X1PenAutomation.getProgram();
    return window.X1PenAutomation.setProgram(
      { sourceMode: 'basic+asm', basic: '10 PRINT "NO EPOCH"' },
      current.revision,
    );
  });
  assert.equal(result.basic, '10 PRINT "NO EPOCH"');
  assert.equal(result.guardedWritesReloadSafe, false);
  assert.equal(result.writeGuard, 'revision-only');
});

test('source-sync transports still fail closed when revision epoch is missing', async () => {
  const result = await page.evaluate(async () => {
    const current = window.X1PenAutomation.getProgram();
    try {
      await window.X1PenAutomation.setProgram(
        { sourceMode: 'basic+asm', basic: '10 PRINT "MISSING EPOCH"' },
        current.revision,
        undefined,
        { requireRevisionEpoch: true },
      );
      return null;
    } catch (error) {
      return { code: error.code, action: error.action, after: window.X1PenAutomation.getProgram().basic };
    }
  });
  assert.equal(result.code, 'REVISION_EPOCH_REQUIRED');
  assert.match(result.action, /expectedRevisionEpoch/);
  assert.equal(result.after, '10 PRINT "NO EPOCH"');
});

test('connection state and AI interaction lock are visible', async () => {
  const locked = await page.evaluate(() => {
    window.X1PenAutomation.setConnectionState(true);
    const status = window.X1PenAutomation.setInteractionLocked(true, 'AI test');
    return {
      status,
      panelInert: document.getElementById('editor-panel').inert,
      overlay: document.getElementById('x1pen-automation-lock').textContent,
      badgeHidden: document.getElementById('x1pen-mcp-status').classList.contains('hidden'),
    };
  });
  assert.equal(locked.status.connected, true);
  assert.equal(locked.status.interactionLocked, true);
  assert.equal(locked.status.languageProfiles.fuzzybasic.id, 'x1pen-fuzzybasic-1.2L');
  assert.equal(locked.status.languageProfiles.slang.id, 'x1pen-slang-c9e8f53-lsx');
  assert.equal(locked.status.languageProfiles.slang.envType, 1);
  assert.equal(locked.status.sourceMode, 'basic+asm');
  assert.equal(locked.status.activeLanguageProfile.id, 'x1pen-fuzzybasic-1.2L');
  assert.equal(locked.panelInert, true);
  assert.equal(locked.overlay, 'AI test');
  assert.equal(locked.badgeHidden, false);

  const nested = await page.evaluate(() => {
    window.X1PenAutomation.setInteractionLocked(true, 'Second AI operation');
    window.X1PenAutomation.setInteractionLocked(false);
    return {
      status: window.X1PenAutomation.getStatus(),
      panelInert: document.getElementById('editor-panel').inert,
      runDisabled: document.getElementById('btn-run').disabled,
    };
  });
  assert.equal(nested.status.interactionLocked, true, 'one completed operation must not release another operation lock');
  assert.equal(nested.panelInert, true);
  assert.equal(nested.runDisabled, true);

  const unlocked = await page.evaluate(() => {
    window.X1PenAutomation.setInteractionLocked(false);
    window.X1PenAutomation.setConnectionState(false);
    return {
      status: window.X1PenAutomation.getStatus(),
      panelInert: document.getElementById('editor-panel').inert,
      hasSavedButtonState: document.getElementById('btn-run').dataset.mcpWasDisabled !== undefined,
    };
  });
  assert.equal(unlocked.status.interactionLocked, false);
  assert.equal(unlocked.panelInert, false);
  assert.equal(unlocked.hasSavedButtonState, false);
});

test('automation validation and capture return structured results', async () => {
  await page.evaluate(() => window.X1PenAutomation.setProgram({ sourceMode: 'asm', asm: 'ORG $100\nBOGUS A' }));
  const validation = await page.evaluate(() => window.X1PenAutomation.validate());
  assert.equal(validation.ok, false);
  assert.equal(validation.diagnostics[0].kind, 'asm');
  assert.equal(validation.diagnostics[0].line, 2);

  const dataUrl = await page.evaluate(() => window.X1PenAutomation.captureScreen());
  const png = Buffer.from(dataUrl.split(',')[1], 'base64');
  assert.equal(png.readUInt32BE(16), 640);
  assert.equal(png.readUInt32BE(20), 400);
});

test('focus loss releases physical keys before automation command injection', { timeout: 60_000 }, async () => {
  const markerAddress = 0x4000;
  const marker = [0x12, 0x34, 0x56, 0x78];
  await page.evaluate(async () => {
    await window.X1PenAutomation.setProgram({
      sourceMode: 'asm',
      asm: [
        'ORG 0100h',
        'LD A,012h',
        'LD (04000h),A',
        'LD A,034h',
        'LD (04001h),A',
        'LD A,056h',
        'LD (04002h),A',
        'LD A,078h',
        'LD (04003h),A',
        'LOOP:',
        'JP LOOP',
      ].join('\n'),
    });
    document.getElementById('canvas').focus();
  });

  await page.keyboard.down('Alt');
  try {
    await page.evaluate(() => window.dispatchEvent(new FocusEvent('blur')));
    await page.evaluate(() => window.XmilControls.setKeyMode(2));
    const { result, events, modeChanges } = await runWithRecordedKeyEvents();
    assert.equal(result.ok, true);
    assertSequentialKeyEvents(events, [0x50, 0x52, 0x4F, 0x47, 0x0D], 40);
    assert.deepEqual(modeChanges, [0, 2], 'automation run must restore the current JoyKey mode');
    await page.waitForFunction(({ address, bytes }) => {
      const module = window.Module;
      const ptr = module._malloc(bytes.length);
      try {
        if (module._js_debug_read_memory(address, ptr, bytes.length) !== bytes.length) return false;
        const memory = new Uint8Array(module.wasmMemory.buffer, ptr, bytes.length);
        return bytes.every((value, index) => memory[index] === value);
      } finally {
        module._free(ptr);
      }
    }, { address: markerAddress, bytes: marker });
  } finally {
    await page.keyboard.up('Alt');
  }
});

test('debugger adapter maps logical VRAM without using side-effecting I/O reads', { timeout: 60_000 }, async () => {
  const run = await page.evaluate(async () => {
    const api = window.X1PenAutomation;
    await api.debugger.setBreakpoints([]);
    await api.setProgram({
      sourceMode: 'asm',
      asm: [
        'ORG 0100h',
        'LD BC,04000h',
        'IN A,(C)',
        'LD BC,04000h',
        'LD A,011h',
        'OUT (C),A',
        'LD BC,08001h',
        'LD A,022h',
        'OUT (C),A',
        'LD BC,0C002h',
        'LD A,033h',
        'OUT (C),A',
        'LD BC,02004h',
        'LD A,044h',
        'OUT (C),A',
        'LOOP:',
        'JP LOOP',
      ].join('\n'),
    });
    return api.run();
  });
  assert.equal(run.ok, true);

  await page.waitForFunction(() => {
    try {
      const debuggerApi = window.X1PenAutomation.debugger;
      return debuggerApi.readVram({ region: 'graphics', bank: 'access', plane: 'blue', offset: 0, length: 1 }).bytes[0] === 0x11 &&
        debuggerApi.readVram({ region: 'graphics', bank: 'display', plane: 'red', offset: 1, length: 1 }).bytes[0] === 0x22 &&
        debuggerApi.readVram({ region: 'graphics', bank: 0, plane: 'green', offset: 2, length: 1 }).bytes[0] === 0x33 &&
        debuggerApi.readVram({ region: 'attribute', offset: 4, length: 1 }).bytes[0] === 0x44;
    } catch {
      return false;
    }
  });

  const initial = await page.evaluate(async () => {
    const api = window.X1PenAutomation;
    await api.debugger.pause();
    return {
      version: api.debugger.version,
      video: api.debugger.getVideoState(),
      blue: api.debugger.readVram({ region: 'graphics', bank: 'access', plane: 'blue', offset: 0, length: 1 }),
      red: api.debugger.readVram({ region: 'graphics', bank: 'display', plane: 'red', offset: 1, length: 1 }),
      green: api.debugger.readVram({ region: 'graphics', bank: 0, plane: 'green', offset: 2, length: 1 }),
      attribute: api.debugger.readVram({ region: 'attribute', offset: 4, length: 1 }),
    };
  });
  assert.equal(initial.version, 2);
  assert.equal(initial.video.model, 'x1');
  assert.equal(initial.video.displayBank, 0);
  assert.equal(initial.video.accessBank, 0);
  assert.equal(initial.video.graphics.banks, 1);
  assert.equal(initial.video.graphics.planeSize, 0x4000);
  assert.deepEqual(initial.blue.bytes, [0x11]);
  assert.equal(initial.blue.bank, 0);
  assert.equal(initial.blue.bankSelector, 'access');
  assert.deepEqual(initial.red.bytes, [0x22]);
  assert.equal(initial.red.bank, 0);
  assert.deepEqual(initial.green.bytes, [0x33]);
  assert.deepEqual(initial.attribute.bytes, [0x44]);

  const cpuReads = await page.evaluate(async () => {
    const api = window.X1PenAutomation;
    await api.setProgram({
      sourceMode: 'asm',
      asm: [
        'ORG 0100h',
        'LOOP:',
        'LD BC,04003h',
        'IN A,(C)',
        'LD (05000h),A',
        'LD BC,02006h',
        'IN A,(C)',
        'LD (05001h),A',
        'JP LOOP',
      ].join('\n'),
    });
    const run = await api.run();
    return { run };
  });
  assert.equal(cpuReads.run.ok, true);

  const written = await page.evaluate(async () => {
    const debuggerApi = window.X1PenAutomation.debugger;
    await debuggerApi.pause();
    const graphics = await debuggerApi.writeVram({
      region: 'graphics', bank: 'access', plane: 'blue', offset: 3, bytes: [0x5A],
    });
    const attribute = await debuggerApi.writeVram({
      region: 'attribute', offset: 6, bytes: [0x06],
    });
    const result = {
      graphics,
      attribute,
      graphicsRead: debuggerApi.readVram({
        region: 'graphics', bank: 0, plane: 'blue', offset: 3, length: 1,
      }),
      attributeRead: debuggerApi.readVram({ region: 'attribute', offset: 6, length: 1 }),
    };
    await debuggerApi.resume();
    return result;
  });
  assert.equal(written.graphics.bank, 0);
  assert.equal(written.graphics.bytesWritten, 1);
  assert.equal(written.graphics.redrawPending, true);
  assert.equal(written.attribute.bytesWritten, 1);
  assert.deepEqual(written.graphicsRead.bytes, [0x5A]);
  assert.deepEqual(written.attributeRead.bytes, [0x06]);

  await page.waitForFunction(() => {
    const memory = window.X1PenAutomation.debugger.readMemory(0x5000, 2);
    return memory.bytes[0] === 0x5A && memory.bytes[1] === 0x06;
  });

  const errors = await page.evaluate(async () => {
    const debuggerApi = window.X1PenAutomation.debugger;
    const capture = async (operation) => {
      try {
        await operation();
        return null;
      } catch (error) {
        return { message: error.message, code: error.code };
      }
    };
    const runningWrite = await capture(() => debuggerApi.writeVram({
      region: 'graphics', bank: 0, plane: 'blue', offset: 0, bytes: [0],
    }));
    await debuggerApi.pause();
    const kanji = await capture(() => debuggerApi.readVram({ region: 'kanji', offset: 0, length: 1 }));
    const bank1 = await capture(() => debuggerApi.readVram({
      region: 'graphics', bank: 1, plane: 'blue', offset: 0, length: 1,
    }));
    const range = await capture(() => debuggerApi.readVram({
      region: 'attribute', offset: 0x07FF, length: 2,
    }));
    const module = window.Module;
    const dataPtr = module._malloc(1);
    const bankPtr = module._malloc(4);
    let rawInvalidRead;
    let rawOversizedRead;
    let rawShortVideoState;
    try {
      rawInvalidRead = module._js_debug_read_vram(3, 0, 0, 0x4000, dataPtr, 1, bankPtr);
      rawOversizedRead = module._js_debug_read_vram(3, 0, 0, 0, dataPtr, 4097, bankPtr);
      rawShortVideoState = module._js_debug_get_video_state(bankPtr, 1);
    } finally {
      module._free(dataPtr);
      module._free(bankPtr);
    }
    await debuggerApi.resume();
    return { runningWrite, kanji, bank1, range, rawInvalidRead, rawOversizedRead, rawShortVideoState };
  });
  assert.equal(errors.runningWrite.code, 'DEBUGGER_NOT_PAUSED');
  assert.equal(errors.kanji.code, 'DEBUGGER_VRAM_UNSUPPORTED');
  assert.equal(errors.bank1.code, 'DEBUGGER_VRAM_UNSUPPORTED');
  assert.match(errors.range.message, /exceeds the attribute region/);
  assert.equal(errors.rawInvalidRead, -1);
  assert.equal(errors.rawOversizedRead, -1);
  assert.equal(errors.rawShortVideoState, -11);
});

test('debugger adapter pauses, steps, resumes, and reads mapped memory', { timeout: 60_000 }, async () => {
  const programAddress = 0x0100;
  const expectedBytes = [0x00, 0x3C, 0xC3, 0x00, 0x01]; // NOP; INC A; JP 0100h

  const initial = await page.evaluate(async () => {
    const debuggerApi = window.X1PenAutomation.debugger;
    await debuggerApi.setBreakpoints([]);
    await window.X1PenAutomation.setProgram({
      sourceMode: 'asm',
      asm: 'ORG 0100h\nNOP\nINC A\nJP 0100h',
    });
    return {
      debuggerVersion: debuggerApi.version,
      run: await window.X1PenAutomation.run(),
    };
  });
  assert.equal(initial.debuggerVersion, 2);
  assert.equal(initial.run.ok, true);

  await page.waitForFunction(({ address, bytes }) => {
    try {
      const memory = window.X1PenAutomation.debugger.readMemory(address, bytes.length);
      return bytes.every((value, index) => memory.bytes[index] === value);
    } catch {
      return false;
    }
  }, { address: programAddress, bytes: expectedBytes });

  const stopped = await page.evaluate(async (address) => {
    const debuggerApi = window.X1PenAutomation.debugger;
    await debuggerApi.pause();
    const configured = await debuggerApi.setBreakpoints([address, address]);
    const running = await debuggerApi.resume();
    const state = await debuggerApi.waitForPause({
      afterSequence: running.sequence,
      stopReason: 'breakpoint',
      address,
      timeoutMs: 5000,
    });
    return {
      configured,
      state,
      memory: debuggerApi.readMemory(address, 5),
    };
  }, programAddress);
  assert.equal(stopped.configured.breakpointCount, 1, 'duplicate breakpoints are removed');
  assert.equal(stopped.state.version, 1);
  assert.equal(stopped.state.runState, 'paused');
  assert.equal(stopped.state.runStateCode, 1);
  assert.equal(stopped.state.stopReason, 'breakpoint');
  assert.equal(stopped.state.stopReasonCode, 2);
  assert.equal(stopped.state.stopAddress, programAddress);
  assert.equal(stopped.state.breakpointCount, 1);
  assert.equal(stopped.state.registers.pc, programAddress);
  assert.equal(stopped.state.registers.a, stopped.state.registers.af >>> 8);
  assert.equal(typeof stopped.state.registers.iff1, 'boolean');
  assert.ok(['main', 'bios', 'bank'].includes(stopped.state.memory.lowMapping));
  assert.deepEqual(stopped.memory.bytes, expectedBytes);
  const accumulatorBeforeFirst = stopped.state.registers.a;

  const stepped = await page.evaluate(async () => {
    const debuggerApi = window.X1PenAutomation.debugger;
    return [await debuggerApi.step(), await debuggerApi.step(), await debuggerApi.step()];
  });
  assert.equal(stepped[0].stopReason, 'step');
  assert.equal(stepped[0].registers.pc, programAddress + 1);
  assert.equal(stepped[0].registers.a, accumulatorBeforeFirst);
  assert.equal(stepped[1].registers.pc, programAddress + 2);
  assert.equal(stepped[1].registers.a, (accumulatorBeforeFirst + 1) & 0xFF);
  assert.equal(stepped[2].stopReason, 'step');
  assert.equal(stepped[2].registers.pc, programAddress);

  const resumedBreakpoint = await page.evaluate(async () => {
    const debuggerApi = window.X1PenAutomation.debugger;
    const before = debuggerApi.getState();
    const running = await debuggerApi.resume();
    const stoppedAgain = await debuggerApi.waitForPause({
      afterSequence: running.sequence,
      stopReason: 'breakpoint',
      address: 0x0100,
      timeoutMs: 5000,
    });
    return { before, stoppedAgain };
  });
  assert.notEqual(resumedBreakpoint.stoppedAgain.cycles, resumedBreakpoint.before.cycles);

  const manualState = await page.evaluate(async () => {
    const debuggerApi = window.X1PenAutomation.debugger;
    await debuggerApi.setBreakpoints([]);
    await debuggerApi.resume();
    await new Promise((resolve) => setTimeout(resolve, 30));
    return debuggerApi.pause();
  });
  assert.equal(manualState.runState, 'paused');
  assert.equal(manualState.stopReason, 'manual');
  assert.equal(manualState.breakpointCount, 0);

  const validation = await page.evaluate(async () => {
    const debuggerApi = window.X1PenAutomation.debugger;
    const errors = [];
    for (const operation of [
      () => debuggerApi.readMemory(0xFFFF, 2),
      () => debuggerApi.setBreakpoints([-1]),
      () => debuggerApi.waitForPause({ address: 0xFFFF, timeoutMs: 0 }),
    ]) {
      try {
        await operation();
        errors.push(null);
      } catch (error) {
        errors.push(error.message);
      }
    }
    const module = window.Module;
    const ptr = module._malloc(2);
    try {
      return {
        errors,
        rawInvalidRead: module._js_debug_read_memory(0xFFFF, ptr, 2),
      };
    } finally {
      module._free(ptr);
    }
  });
  assert.match(validation.errors[0], /64KB address space/);
  assert.match(validation.errors[1], /0 to 65535/);
  assert.match(validation.errors[2], /Timed out/);
  assert.equal(validation.rawInvalidRead, -1);

  const rerun = await page.evaluate(async () => {
    const api = window.X1PenAutomation;
    const before = api.debugger.getState();
    const runPromise = api.run();
    const pendingStatus = api.getStatus().capabilities.debugger.runPending;
    const breakpointPromise = api.debugger.setBreakpoints([0x2345]).then(
      () => null,
      (error) => ({ message: error.message, code: error.code }),
    );
    const controlErrors = [];
    for (const control of ['pause', 'resume', 'step']) {
      try {
        await api.debugger[control]();
        controlErrors.push(null);
      } catch (error) {
        controlErrors.push({ message: error.message, code: error.code });
      }
    }
    const result = await runPromise;
    const breakpointError = await breakpointPromise;
    const after = api.debugger.getState();
    let runningStepError = null;
    try {
      await api.debugger.step();
    } catch (error) {
      runningStepError = error.message;
    }
    const pausedAfterRun = await api.debugger.pause();
    const breakpointsAfterRun = await api.debugger.setBreakpoints([0x2345]);
    await api.debugger.setBreakpoints([]);
    await api.debugger.resume();
    return {
      before, result, pendingStatus, after, controlErrors, runningStepError,
      pausedAfterRun, breakpointError, breakpointsAfterRun,
    };
  });
  assert.equal(rerun.before.runState, 'paused');
  assert.equal(rerun.result.ok, true);
  assert.equal(rerun.pendingStatus, true);
  assert.equal(rerun.after.runState, 'running', 'Run must resume a paused debugger session');
  assert.deepEqual(rerun.controlErrors.map((error) => error.code), ['RUN_PENDING', 'RUN_PENDING', 'RUN_PENDING']);
  assert.ok(rerun.controlErrors.every((error) => /run setup is pending/.test(error.message)));
  assert.match(rerun.runningStepError, /requires the paused state/);
  assert.equal(rerun.pausedAfterRun.runState, 'paused');
  assert.equal(rerun.breakpointError.code, 'RUN_PENDING');
  assert.equal(rerun.breakpointsAfterRun.breakpointCount, 1);

  const manualRun = await page.evaluate(async () => {
    const api = window.X1PenAutomation;
    document.getElementById('btn-run').click();
    const pendingStatus = api.getStatus().capabilities.debugger.runPending;

    const controlErrors = [];
    for (const control of ['pause', 'resume', 'step']) {
      try {
        await api.debugger[control]();
        controlErrors.push(null);
      } catch (error) {
        controlErrors.push({ message: error.message, code: error.code });
      }
    }

    const deadline = Date.now() + 5000;
    let paused;
    while (!paused && Date.now() < deadline) {
      try {
        paused = await api.debugger.pause();
      } catch (error) {
        if (!/run setup is pending/.test(error.message)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    if (!paused) throw new Error('Manual Run did not finish setup');
    await api.debugger.resume();
    return { pendingStatus, controlErrors, paused };
  });
  assert.equal(manualRun.pendingStatus, true);
  assert.deepEqual(manualRun.controlErrors.map((error) => error.code), ['RUN_PENDING', 'RUN_PENDING', 'RUN_PENDING']);
  assert.ok(manualRun.controlErrors.every((error) => /run setup is pending/.test(error.message)));
  assert.equal(manualRun.paused.runState, 'paused');
});

test('embedded M8A data assembles and draws into graphics VRAM', { timeout: 60_000 }, async () => {
  const result = await page.evaluate(async () => {
    const api = window.X1PenAutomation;
    const planes = ['blue', 'red', 'green'];
    const readPlanes = () => Object.fromEntries(planes.map((plane) => [
      plane,
      api.debugger.readVram({
        region: 'graphics', bank: 0, plane, offset: 0, length: 1,
      }).bytes[0],
    ]));
    const original = readPlanes();
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    let observed = null;
    let validation = null;
    let run = null;

    await api.debugger.pause();
    await api.debugger.writeVram({
      region: 'graphics', bank: 0, plane: 'blue', offset: 0, bytes: [0x00],
    });
    await api.debugger.writeVram({
      region: 'graphics', bank: 0, plane: 'red', offset: 0, bytes: [0xA5],
    });
    await api.debugger.writeVram({
      region: 'graphics', bank: 0, plane: 'green', offset: 0, bytes: [0x5A],
    });
    await api.debugger.resume();

    try {
      const current = api.getProgram();
      await api.setProgram({
        sourceMode: 'slang',
        basic: '',
        asm: '',
        slang: [
          'ARRAY BYTE M8A_DATA[] = {',
          '  $4D,$38,$41,$00,$01,$01,$49,$49,$49,$49',
          '};',
          '',
          'MAIN() BEGIN',
          '  M8ALOAD(M8A_DATA,0,0);',
          '  LOOP VSYNC1();',
          'END;',
        ].join('\n'),
      }, current.revision, current.revisionEpoch);
      validation = await api.validate();
      if (!validation.ok) {
        throw new Error(`Embedded M8A validation failed: ${JSON.stringify(validation.diagnostics)}`);
      }
      run = await api.run();
      if (!run.ok) throw new Error(`Embedded M8A Run failed: ${JSON.stringify(run)}`);

      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        observed = readPlanes();
        if (observed.blue === 0xFF && observed.red === 0x00 && observed.green === 0x00) break;
        await sleep(25);
      }
      if (!observed || observed.blue !== 0xFF || observed.red !== 0x00 || observed.green !== 0x00) {
        throw new Error(`M8ALOAD did not produce the expected VRAM planes: ${JSON.stringify(observed)}`);
      }
      return { validation, run, observed };
    } finally {
      window.Module._js_xmil_reset();
      await sleep(50);
      await api.debugger.pause();
      for (const plane of planes) {
        await api.debugger.writeVram({
          region: 'graphics', bank: 0, plane, offset: 0, bytes: [original[plane]],
        });
      }
      await api.debugger.setBreakpoints([]);
      await api.debugger.resume();
    }
  });

  assert.equal(result.validation.ok, true);
  assert.equal(result.run.ok, true);
  assert.equal(result.run.sourceMode, 'slang');
  assert.deepEqual(result.observed, { blue: 0xFF, red: 0x00, green: 0x00 });
});

test('mounted FDD0 is forked once into a persistent project disk', { timeout: 90_000 }, async () => {
  const context = await browser.newContext();
  const projectPage = await context.newPage();
  try {
    await projectPage.goto(`${baseUrl}/x1pen.html`);
    await projectPage.evaluate(() => window.X1PenAutomation.ready());
    await projectPage.evaluate(async () => {
      const response = await fetch('fuzzybasic_boot.v2.d88');
      const bytes = await response.arrayBuffer();
      const entry = await window.XmilLibrary.addToLibrary(
        new File([bytes], 'OWNER.D88', { type: 'application/octet-stream' }),
      );
      const dataEntry = await window.XmilLibrary.addToLibrary(
        new File([bytes], 'DATA.D88', { type: 'application/octet-stream' }),
      );
      await window.XmilLibrary.mountFromLibrary(entry.key, 'drive0');
      await window.XmilLibrary.mountFromLibrary(dataEntry.key, 'drive1');
      const api = window.X1PenAutomation;
      const current = api.getProgram();
      await api.setProgram({
        sourceMode: 'basic+asm',
        basic: '10 PRINT "PROJECT DISK"\n20 END',
        asm: '',
        slang: '',
      }, current.revision, current.revisionEpoch);
    });

    const setupRequired = await projectPage.evaluate(() => window.X1PenAutomation.run());
    assert.equal(setupRequired.ok, false);
    assert.equal(setupRequired.code, 'PROJECT_DISK_SETUP_REQUIRED');
    assert.match(setupRequired.status, /X1Pen画面で一度RUNしてください/);
    assert.match(setupRequired.action, /作業用コピーの作成を承認/);

    const dialogMessages = [];
    projectPage.on('dialog', (dialog) => {
      dialogMessages.push(dialog.message());
      dialog.accept();
    });
    await projectPage.locator('#btn-run').click();
    await projectPage.waitForFunction(() => {
      const entry = window.XmilCore.getLibrary().find((candidate) => candidate.x1penProject);
      return entry && !window.X1PenAutomation.getStatus().capabilities.debugger.runPending;
    });
    assert.equal(dialogMessages.length, 1);
    assert.match(dialogMessages[0], /X1Pen用の作業ディスクを作成しますか/);
    assert.match(dialogMessages[0], /起動やプログラム実行は確認されません/);

    const first = await projectPage.evaluate(async () => {
      const library = window.XmilCore.getLibrary();
      const source = library.find((entry) => entry.name === 'OWNER.D88');
      const data = library.find((entry) => entry.name === 'DATA.D88');
      const project = library.find((entry) => entry.x1penProject);
      const slots = window.XmilCore.getSlotState();
      const bytes = await window.XmilStorage.read(project.key);
      const container = window.XmilDiskContainer.openContainer(bytes, project.name, 'fdd');
      const fs = window.XmilDiskFS.detectFilesystem(container);
      const auto = fs.readFile(fs.findByName('AUTOEXEC', 'BAT'));
      return {
        source,
        data,
        project,
        drive0: slots.drive0,
        drive1: slots.drive1,
        autorun: !!fs.findByName('AUTORUN', 'BAS'),
        autoexec: String.fromCharCode(...auto).split(String.fromCharCode(0x1a))[0],
      };
    });
    assert.ok(first.source);
    assert.ok(first.data);
    assert.equal(first.source.x1penProject, undefined);
    assert.match(first.project.name, /^OWNER-X1Pen(?:-\d+)?\.D88$/);
    assert.equal(first.project.sourceKey, first.source.key);
    assert.equal(first.project.projectMode, 'fuzzybasic');
    assert.equal(first.drive0, first.project.key);
    assert.equal(first.drive1, first.data.key);
    assert.equal(first.autorun, true);
    assert.match(first.autoexec, /(^|\r?\n)FZBASIC(\r?\n|$)/);

    const rerun = await projectPage.evaluate(() => window.X1PenAutomation.run());
    assert.equal(rerun.ok, true);
    assert.equal(rerun.projectDisk, true);
    assert.equal(rerun.projectDiskName, first.project.name);
    assert.equal(rerun.committed, true);
    assert.equal(rerun.poweredOn, true);
    assert.equal(rerun.bootVerified, false);
    assert.equal(rerun.executionVerified, false);
    assert.equal(rerun.verification, 'filesystem-only');
    assert.equal(rerun.status, 'プロジェクトディスクを起動しました');

    const drive1AfterRerun = await projectPage.evaluate(() => window.XmilCore.getSlotState().drive1);
    assert.equal(drive1AfterRerun, first.data.key);

    const projectsAfterRerun = await projectPage.evaluate(
      () => window.XmilCore.getLibrary().filter((entry) => entry.x1penProject).map((entry) => entry.name),
    );
    assert.deepEqual(projectsAfterRerun, [first.project.name], 'metadata must prevent a second project copy');

    for (const selectedModel of [2, 3]) {
      const modelRun = await projectPage.evaluate(async (model) => {
        window.XmilControls.setRomType(model);
        return {
          result: await window.X1PenAutomation.run(),
          activeModel: window.Module._js_get_rom_type(),
        };
      }, selectedModel);
      assert.equal(modelRun.result.ok, true);
      assert.equal(modelRun.result.verification, 'filesystem-only');
      assert.equal(modelRun.result.bootVerified, false);
      assert.equal(modelRun.result.executionVerified, false);
      assert.equal(modelRun.activeModel, selectedModel);
    }

    const rollback = await projectPage.evaluate(async () => {
      const api = window.X1PenAutomation;
      const project = window.XmilCore.getLibrary().find((entry) => entry.x1penProject);
      const original = await window.XmilStorage.read(project.key);
      const originalHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', original)))
        .map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const savedWrite = window.XmilStorage.write;
      let failed = false;
      window.XmilStorage.write = async function(key, bytes) {
        await savedWrite.call(this, key, bytes);
        if (key === project.key && !failed) {
          failed = true;
          throw new Error('forced post-write failure');
        }
      };
      let result;
      try {
        result = await api.run();
      } finally {
        window.XmilStorage.write = savedWrite;
      }
      const restored = await window.XmilStorage.read(project.key);
      const restoredHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', restored)))
        .map((byte) => byte.toString(16).padStart(2, '0')).join('');
      return {
        result,
        originalHash,
        restoredHash,
        drive0: window.XmilCore.getSlotState().drive0,
        projectKey: project.key,
      };
    });
    assert.equal(rollback.result.ok, false);
    assert.equal(rollback.result.rollbackFailed, false);
    assert.equal(rollback.restoredHash, rollback.originalHash);
    assert.equal(rollback.drive0, rollback.projectKey);
  } finally {
    await context.close();
  }
});

test('Share runs isolate ordinary and project disks from persistent state', { timeout: 180_000 }, async () => {
  for (const project of [false, true]) {
    const context = await browser.newContext();
    const ownerPage = await context.newPage();
    const shareId = project ? 'project-isolation' : 'ordinary-isolation';
    const dialogs = [];
    try {
      const keys = await seedX1PenPersistentDiskState(ownerPage, { project });
      await ownerPage.evaluate(async () => {
        window.Module._js_xmil_stop();
        await window.XmilCore.flushSlot('drive0');
        await window.XmilCore.flushSlot('drive1');
      });
      const baseline = await snapshotX1PenPersistence(ownerPage);

      await installShareRoute(context, shareId, {
        basic: '',
        asm: 'ORG 0100h\nRET',
        slang: null,
        meta: {
          model: 1,
          coldState: 'lsxdodgers_cold.v1.xmst',
          bootDisk: 'lsxdodgers_boot.v1.d88',
          runMode: 'lsx',
          sourceMode: 'asm',
        },
      });
      ownerPage.on('dialog', async (dialog) => {
        dialogs.push(`owner: ${dialog.message()}`);
        await dialog.dismiss();
      });
      const sharePage = await context.newPage();
      sharePage.on('dialog', async (dialog) => {
        dialogs.push(`share: ${dialog.message()}`);
        await dialog.dismiss();
      });
      await sharePage.goto(`${baseUrl}/x1pen.html?id=${shareId}`);
      await sharePage.evaluate(() => window.X1PenAutomation.ready());
      await sharePage.waitForFunction(() =>
        document.getElementById('x1pen-status').textContent === 'LSX-Dodgers mode' &&
        !window.X1PenAutomation.getStatus().capabilities.debugger.runPending,
      );
      await assertEphemeralShareDocument(sharePage);

      const shareRun = await sharePage.evaluate(() => {
        const slots = window.XmilCore.getSlotState();
        const vfsPath = window.XmilCore.getSlotVfsPath().drive0;
        const bytes = window.Module.FS.readFile(vfsPath);
        const container = window.XmilDiskContainer.openContainer(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          'share.d88',
          'fdd',
        );
        const fs = window.XmilDiskFS.detectFilesystem(container);
        return {
          program: window.X1PenAutomation.getProgram(),
          model: window.Module._js_get_rom_type(),
          drive0: slots.drive0,
          drive1: slots.drive1,
          filesystem: fs && fs.fsType,
          hasProgram: !!(fs && fs.findByName('PROG', 'COM')),
          hasLsxLoader: !!(fs && fs.findByName('LD', 'BIN')),
          hasFuzzyBasic: !!(fs && fs.findByName('FZBASIC', 'COM')),
        };
      });
      assert.equal(shareRun.program.sourceMode, 'asm');
      assert.equal(shareRun.program.asm, 'ORG 0100h\nRET');
      assert.equal(shareRun.model, 1);
      assert.equal(shareRun.drive0, '__x1pen_temp__');
      assert.equal(shareRun.drive1, null);
      assert.equal(shareRun.filesystem, 'LSX-Dodgers');
      assert.equal(shareRun.hasProgram, true);
      assert.equal(shareRun.hasLsxLoader, true);
      assert.equal(shareRun.hasFuzzyBasic, false);
      assert.deepEqual(await snapshotX1PenPersistence(sharePage), baseline);

      const refusedMount = await sharePage.evaluate(async ({ ownerKey }) => {
        const api = window.X1PenAutomation;
        const current = api.getProgram();
        await api.setProgram({ sourceMode: 'asm', asm: 'ORG 0100h\nNOP\nRET' },
          current.revision, current.revisionEpoch);
        return window.XmilLibrary.mountFromLibrary(ownerKey, 'drive1');
      }, { ownerKey: keys.ownerKey });
      assert.equal(refusedMount, null);
      await sharePage.locator('.editor-tab[data-tab="asm"]').click();
      await sharePage.locator('#asm-editor-container .cm-content').click();
      await sharePage.keyboard.press('End');
      await sharePage.keyboard.type('\n; TRANSIENT TYPING');
      const repeatedRun = await sharePage.evaluate(() => window.X1PenAutomation.run());
      assert.equal(repeatedRun.ok, true);
      assert.equal(await sharePage.evaluate(() => window.XmilCore.getSlotState().drive0), '__x1pen_temp__');
      await sharePage.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));

      assert.deepEqual(await snapshotX1PenPersistence(sharePage), baseline);
      const isolatedSlots = await sharePage.evaluate(() => window.XmilCore.getSlotState());
      assert.deepEqual(isolatedSlots, {
        drive0: '__x1pen_temp__', drive1: null, hdd0: null, hdd1: null, cmt: null,
        emm0: null, emm1: null, emm2: null, emm3: null, emm4: null,
        emm5: null, emm6: null, emm7: null, emm8: null, emm9: null,
      });
      assert.deepEqual(await ownerPage.evaluate(() => window.XmilCore.getSlotState()), {
        drive0: keys.ownerKey,
        drive1: keys.dataKey,
        hdd0: null, hdd1: null, cmt: null,
        emm0: null, emm1: null, emm2: null, emm3: null, emm4: null,
        emm5: null, emm6: null, emm7: null, emm8: null, emm9: null,
      });
      assert.deepEqual(await snapshotX1PenPersistence(ownerPage), baseline);
      assert.deepEqual(dialogs, [], 'Share must not trigger multi-tab or project-disk dialogs');
      await sharePage.close();

      await ownerPage.reload();
      await ownerPage.evaluate(() => window.X1PenAutomation.ready());
      const restored = await ownerPage.evaluate(() => ({
        program: window.X1PenAutomation.getProgram(),
        slots: window.XmilCore.getSlotState(),
      }));
      assert.equal(restored.program.basic, '10 PRINT "PERSISTENT ORIGINAL"\n20 END');
      assert.equal(restored.program.asm, '; PERSISTENT ASM');
      assert.equal(restored.slots.drive0, keys.ownerKey);
      assert.equal(restored.slots.drive1, keys.dataKey);
      assert.deepEqual(await snapshotX1PenPersistence(ownerPage), baseline);
    } finally {
      await context.close();
    }
  }
});

test('legacy Share payloads use an ephemeral FuzzyBASIC runtime', { timeout: 90_000 }, async () => {
  const context = await browser.newContext();
  const ownerPage = await context.newPage();
  try {
    await ownerPage.goto(`${baseUrl}/x1pen.html`);
    await ownerPage.evaluate(() => window.X1PenAutomation.ready());
    await ownerPage.evaluate(async () => {
      const api = window.X1PenAutomation;
      const current = api.getProgram();
      await api.setProgram({
        sourceMode: 'basic+asm',
        basic: '10 PRINT "NO MOUNT ORIGINAL"\n20 END',
        asm: '',
        slang: '',
      }, current.revision, current.revisionEpoch);
      window.Module._js_xmil_stop();
    });
    const baseline = await snapshotX1PenPersistence(ownerPage);
    await installShareRoute(context, 'legacy-isolation', {
      basic: '10 PRINT "LEGACY SHARE"\n20 END',
      asm: null,
      slang: null,
    });
    const sharePage = await context.newPage();
    await sharePage.goto(`${baseUrl}/x1pen.html?id=legacy-isolation`);
    await sharePage.evaluate(() => window.X1PenAutomation.ready());
    await sharePage.waitForFunction(() =>
      window.X1PenAutomation.getProgram().basic.includes('LEGACY SHARE') &&
      window.XmilCore.getSlotState().drive0 === '__x1pen_temp__' &&
      !window.X1PenAutomation.getStatus().capabilities.debugger.runPending,
    );
    await assertEphemeralShareDocument(sharePage);
    const result = await sharePage.evaluate(() => {
      const vfsPath = window.XmilCore.getSlotVfsPath().drive0;
      const bytes = window.Module.FS.readFile(vfsPath);
      const container = window.XmilDiskContainer.openContainer(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        'legacy-share.d88',
        'fdd',
      );
      const fs = window.XmilDiskFS.detectFilesystem(container);
      return {
        program: window.X1PenAutomation.getProgram(),
        slots: window.XmilCore.getSlotState(),
        model: window.Module._js_get_rom_type(),
        filesystem: fs && fs.fsType,
        hasAutorun: !!(fs && fs.findByName('AUTORUN', 'BAS')),
        hasFuzzyBasic: !!(fs && fs.findByName('FZBASIC', 'COM')),
      };
    });
    assert.equal(result.program.basic, '10 PRINT "LEGACY SHARE"\n20 END');
    assert.equal(result.slots.drive0, '__x1pen_temp__');
    assert.equal(result.slots.drive1, null);
    assert.equal(result.model, 1);
    assert.equal(result.filesystem, 'LSX-Dodgers');
    assert.equal(result.hasAutorun, true);
    assert.equal(result.hasFuzzyBasic, true);
    assert.deepEqual(await snapshotX1PenPersistence(sharePage), baseline);
  } finally {
    await context.close();
  }
});

test('failed Share links remain visibly ephemeral and cannot overwrite saved source', { timeout: 90_000 }, async () => {
  const context = await browser.newContext();
  const ownerPage = await context.newPage();
  try {
    const keys = await seedX1PenPersistentDiskState(ownerPage);
    await ownerPage.evaluate(() => window.Module._js_xmil_stop());
    const baseline = await snapshotX1PenPersistence(ownerPage);
    await installShareRoute(context, 'missing-share', null, 404);
    const sharePage = await context.newPage();
    await sharePage.goto(`${baseUrl}/x1pen.html?id=missing-share`);
    await sharePage.evaluate(() => window.X1PenAutomation.ready());
    await sharePage.waitForFunction(() =>
      document.getElementById('x1pen-status').textContent === 'Shared code not found',
    );
    await assertEphemeralShareDocument(sharePage);
    const initial = await sharePage.evaluate(() => ({
      program: window.X1PenAutomation.getProgram(),
      slots: window.XmilCore.getSlotState(),
    }));
    assert.equal(initial.program.basic, '');
    assert.equal(initial.program.asm, '');
    assert.equal(initial.program.slang, '');
    assert.equal(initial.slots.drive0, null);
    assert.equal(initial.slots.drive1, null);

    await sharePage.evaluate(async ({ ownerKey }) => {
      const api = window.X1PenAutomation;
      const current = api.getProgram();
      await api.setProgram({ sourceMode: 'basic+asm', basic: '10 PRINT "TRANSIENT"', asm: '', slang: '' },
        current.revision, current.revisionEpoch);
      await window.XmilLibrary.mountFromLibrary(ownerKey, 'drive0');
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
    }, { ownerKey: keys.ownerKey });
    assert.deepEqual(await snapshotX1PenPersistence(sharePage), baseline);
    assert.deepEqual(await snapshotX1PenPersistence(ownerPage), baseline);

    await installShareRoute(context, 'compile-failure', {
      basic: '',
      asm: 'THIS IS NOT VALID ASSEMBLY',
      slang: null,
      meta: {
        model: 1,
        coldState: 'lsxdodgers_cold.v1.xmst',
        bootDisk: 'lsxdodgers_boot.v1.d88',
        runMode: 'lsx',
        sourceMode: 'asm',
      },
    });
    const compileFailurePage = await context.newPage();
    await compileFailurePage.goto(`${baseUrl}/x1pen.html?id=compile-failure`);
    await compileFailurePage.evaluate(() => window.X1PenAutomation.ready());
    await compileFailurePage.waitForFunction(() =>
      document.getElementById('x1pen-status').textContent.startsWith('ASM error'),
    );
    await assertEphemeralShareDocument(compileFailurePage);
    assert.equal(await compileFailurePage.evaluate(() => window.XmilCore.getSlotState().drive0), null);
    assert.deepEqual(await snapshotX1PenPersistence(compileFailurePage), baseline);
  } finally {
    await context.close();
  }
});

test('both NMI buttons generate repeatable real NMI edges without resetting machine state', { timeout: 120_000 }, async () => {
  const counterAddress = 0x5200;
  const ramSentinelAddress = 0x5000;
  const vramSentinelOffset = 0x0012;
  const loopSource = [
    'ORG 0100h',
    'LD SP,6000h',
    'LD BC,1E00h',
    'XOR A',
    'OUT (C),A',
    'EI',
    'LD A,05Ah',
    'LD (5000h),A',
    'XOR A',
    'LD (5200h),A',
    'LOOP:',
    'LD A,(5100h)',
    'INC A',
    'LD (5100h),A',
    'JP LOOP',
  ].join('\n');

  const setup = await page.evaluate(async ({ source, counter }) => {
    const api = window.X1PenAutomation;
    await api.debugger.setBreakpoints([]);
    await api.setProgram({ sourceMode: 'asm', asm: source });
    const run = await api.run();
    const handler = window.X1PenZ80Asm.assemble([
      'ORG 0066h',
      `LD A,(${counter.toString(16)}h)`,
      'INC A',
      `LD (${counter.toString(16)}h),A`,
      'RETN',
    ].join('\n'));
    if (handler.errors.length) throw new Error(JSON.stringify(handler.errors));
    return { run, handler: Array.from(handler.bytes) };
  }, { source: loopSource, counter: counterAddress });
  assert.equal(setup.run.ok, true);

  await page.waitForFunction(({ sentinel, counter }) => {
    const api = window.X1PenAutomation;
    const state = api.debugger.getState();
    return state.memory.lowMapping === 'main' &&
      api.debugger.readMemory(sentinel, 1).bytes[0] === 0x5A &&
      api.debugger.readMemory(counter, 1).bytes[0] === 0;
  }, { sentinel: ramSentinelAddress, counter: counterAddress });

  const injectHandler = () => page.evaluate(async ({ handler, vramOffset }) => {
    const api = window.X1PenAutomation;
    const paused = await api.debugger.pause();
    const module = window.Module;
    const ram = new Uint8Array(module.wasmMemory.buffer, module._js_get_main_ram(), 0x10000);
    ram.set(handler, 0x0066);
    await api.debugger.writeVram({
      region: 'graphics', bank: 'access', plane: 'blue', offset: vramOffset, bytes: [0xA5],
    });
    return {
      paused,
      vector: api.debugger.readMemory(0x0066, handler.length).bytes,
      mapping: api.debugger.getState().memory.lowMapping,
    };
  }, { handler: setup.handler, vramOffset: vramSentinelOffset });

  const verifyEntry = (state, expectedCounter) => {
    assert.equal(state.runState, 'paused');
    assert.equal(state.stopReason, 'breakpoint');
    assert.equal(state.registers.pc, 0x0066);
    assert.equal(state.registers.sp, 0x5FFE);
    assert.equal(state.registers.iff1, false);
    assert.equal(state.registers.iff2, true);
    assert.equal(state.counterBeforeHandler, expectedCounter);
    assert.ok(state.returnAddress >= 0x0100 && state.returnAddress < 0x0120,
      `NMI return address must be in the main loop, got ${state.returnAddress.toString(16)}`);
  };

  const enterFromClick = (buttonId, whilePaused) => page.evaluate(async ({ button, paused, counter }) => {
    const api = window.X1PenAutomation;
    const debuggerApi = api.debugger;
    await debuggerApi.setBreakpoints([0x0066]);
    if (paused) {
      const beforeClick = debuggerApi.getState();
      document.getElementById(button).click();
      const queued = debuggerApi.getState();
      if (queued.cycles !== beforeClick.cycles || queued.runState !== 'paused') {
        throw new Error('paused NMI request must not execute or resume the CPU');
      }
    }
    const running = await debuggerApi.resume();
    if (!paused) document.getElementById(button).click();
    const state = await debuggerApi.waitForPause({
      afterSequence: running.sequence,
      stopReason: 'breakpoint',
      address: 0x0066,
      timeoutMs: 5000,
    });
    const stack = debuggerApi.readMemory(state.registers.sp, 2).bytes;
    return {
      ...state,
      returnAddress: stack[0] | (stack[1] << 8),
      counterBeforeHandler: debuggerApi.readMemory(counter, 1).bytes[0],
    };
  }, { button: buttonId, paused: whilePaused, counter: counterAddress });

  const finishHandler = (expectedCounter) => page.evaluate(async ({ counter, expected, ramSentinel, vramOffset }) => {
    const api = window.X1PenAutomation;
    await api.debugger.setBreakpoints([]);
    await api.debugger.resume();
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      if (api.debugger.readMemory(counter, 1).bytes[0] === expected) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const paused = await api.debugger.pause();
    return {
      paused,
      counter: api.debugger.readMemory(counter, 1).bytes[0],
      ram: api.debugger.readMemory(ramSentinel, 1).bytes[0],
      vram: api.debugger.readVram({
        region: 'graphics', bank: 'access', plane: 'blue', offset: vramOffset, length: 1,
      }).bytes[0],
    };
  }, {
    counter: counterAddress,
    expected: expectedCounter,
    ramSentinel: ramSentinelAddress,
    vramOffset: vramSentinelOffset,
  });

  const firstInjection = await injectHandler();
  assert.equal(firstInjection.mapping, 'main');
  assert.deepEqual(firstInjection.vector, setup.handler);
  const x1penEntry = await enterFromClick('ec-nmi-reset', false);
  verifyEntry(x1penEntry, 0);
  const afterX1Pen = await finishHandler(1);
  assert.equal(afterX1Pen.counter, 1);
  assert.equal(afterX1Pen.ram, 0x5A);
  assert.equal(afterX1Pen.vram, 0xA5);
  assert.equal(afterX1Pen.paused.registers.iff1, true, 'RETN must restore IFF1 from IFF2');

  const secondInjection = await injectHandler();
  assert.equal(secondInjection.mapping, 'main');
  assert.deepEqual(secondInjection.vector, setup.handler);
  const semanticEntry = await page.evaluate(async ({ counter }) => {
    const api = window.X1PenAutomation;
    await api.debugger.setBreakpoints([0x0066]);
    const before = api.debugger.getState();
    window.XmilControls.nmi();
    const queued = api.debugger.getState();
    if (queued.cycles !== before.cycles || queued.runState !== 'paused') {
      throw new Error('paused NMI request must not execute or resume the CPU');
    }
    const running = await api.debugger.resume();
    const state = await api.debugger.waitForPause({
      afterSequence: running.sequence, stopReason: 'breakpoint', address: 0x0066, timeoutMs: 5000,
    });
    const stack = api.debugger.readMemory(state.registers.sp, 2).bytes;
    return {
      ...state,
      returnAddress: stack[0] | (stack[1] << 8),
      counterBeforeHandler: api.debugger.readMemory(counter, 1).bytes[0],
    };
  }, { counter: counterAddress });
  verifyEntry(semanticEntry, 1);
  const afterSemantic = await finishHandler(2);
  assert.equal(afterSemantic.counter, 2);
  assert.equal(afterSemantic.ram, 0x5A);
  assert.equal(afterSemantic.vram, 0xA5);

  const stoppedEntry = await page.evaluate(async ({ counter }) => {
    const api = window.X1PenAutomation;
    await api.debugger.setBreakpoints([0x0066]);
    await api.debugger.resume();
    window.Module._js_xmil_stop();
    const stopped = api.debugger.getState();
    window.XmilControls.nmiReset();
    window.XmilControls.nmiReset();
    const queued = api.debugger.getState();
    if (queued.cycles !== stopped.cycles || queued.emulatorRunning) {
      throw new Error('stopped NMI requests must coalesce without starting the CPU');
    }
    window.Module._js_xmil_start();
    const state = await api.debugger.waitForPause({
      afterSequence: queued.sequence,
      stopReason: 'breakpoint',
      address: 0x0066,
      timeoutMs: 5000,
    });
    return { state, counter: api.debugger.readMemory(counter, 1).bytes[0] };
  }, { counter: counterAddress });
  assert.equal(stoppedEntry.counter, 2, 'coalesced request pauses before one handler execution');
  assert.equal(stoppedEntry.state.registers.pc, 0x0066);
  const afterStopped = await finishHandler(3);
  assert.equal(afterStopped.counter, 3, 'two stopped requests coalesce into one NMI edge');

  const labels = await page.evaluate(() => ({
    x1penText: document.getElementById('ec-nmi-reset').textContent.trim(),
    x1penTitle: document.getElementById('ec-nmi-reset').title,
    semanticControl: typeof window.XmilControls.nmi,
    compatibilityControl: typeof window.XmilControls.nmiReset,
  }));
  const physicalPage = await browser.newPage();
  let physicalControl;
  try {
    physicalPage.on('dialog', (dialog) => dialog.accept());
    await physicalPage.goto(`${baseUrl}/xmillennium.html`);
    await physicalPage.waitForFunction(() => window.Module &&
      typeof window.Module._js_xmil_nmi === 'function' &&
      typeof window.XmilControls?.nmi === 'function' &&
      !document.getElementById('main-content')?.classList.contains('hidden'));
    physicalControl = await physicalPage.evaluate(() => {
      const original = window.Module._js_xmil_nmi;
      let calls = 0;
      window.Module._js_xmil_nmi = () => {
        calls += 1;
        return original();
      };
      try {
        const button = document.getElementById('ctrl-nmi');
        button.click();
        return { calls, title: button.title };
      } finally {
        window.Module._js_xmil_nmi = original;
      }
    });
  } finally {
    await physicalPage.close();
  }
  assert.equal(labels.x1penText, 'NMI');
  assert.match(labels.x1penTitle, /non-maskable interrupt/);
  assert.equal(physicalControl.calls, 1, 'physical NMI button must invoke the shared real-NMI handler');
  assert.match(physicalControl.title, /non-maskable interrupt/);
  assert.equal(labels.semanticControl, 'function');
  assert.equal(labels.compatibilityControl, 'function');

  const haltSource = [
    'ORG 0100h',
    'LD SP,6000h',
    'LD BC,1E00h',
    'XOR A',
    'OUT (C),A',
    'EI',
    'HALT',
    'AFTER_HALT:',
    'LD A,077h',
    'LD (5300h),A',
    'HALT_LOOP:',
    'JP HALT_LOOP',
  ].join('\n');
  const haltSetup = await page.evaluate(async ({ source, handler }) => {
    const api = window.X1PenAutomation;
    await api.debugger.setBreakpoints([]);
    await api.setProgram({ sourceMode: 'asm', asm: source });
    const assembled = window.X1PenZ80Asm.assemble(source);
    const expectedReturn = assembled.symbols['NAME_SPACE_DEFAULT.AFTER_HALT'];
    const run = await api.run();
    const deadline = performance.now() + 10_000;
    while (performance.now() < deadline) {
      const state = api.debugger.getState();
      if (state.registers.sp === 0x6000 && state.registers.pc === expectedReturn - 1) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await api.debugger.pause();
    const preNmiState = api.debugger.getState();
    if (preNmiState.registers.sp !== 0x6000 || preNmiState.registers.pc !== expectedReturn - 1) {
      throw new Error(`HALT precondition was not reached: ${JSON.stringify(preNmiState)}`);
    }
    const module = window.Module;
    new Uint8Array(module.wasmMemory.buffer, module._js_get_main_ram(), 0x10000).set(handler, 0x0066);
    const precondition = {
      mapping: api.debugger.getState().memory.lowMapping,
      vector: api.debugger.readMemory(0x0066, handler.length).bytes,
    };
    await api.debugger.setBreakpoints([0x0066]);
    const running = await api.debugger.resume();
    window.XmilControls.nmi();
    const state = await api.debugger.waitForPause({
      afterSequence: running.sequence, stopReason: 'breakpoint', address: 0x0066, timeoutMs: 5000,
    });
    const stack = api.debugger.readMemory(state.registers.sp, 2).bytes;
    return {
      run,
      state,
      preNmiState,
      expectedReturn,
      returnAddress: stack[0] | (stack[1] << 8),
      ...precondition,
    };
  }, { source: haltSource, handler: setup.handler });
  assert.equal(haltSetup.run.ok, true);
  assert.equal(haltSetup.mapping, 'main');
  assert.deepEqual(haltSetup.vector, setup.handler);
  assert.equal(haltSetup.state.registers.sp, 0x5FFE,
    `NMI from HALT must use the configured stack: ${JSON.stringify(haltSetup)}`);
  assert.equal(haltSetup.returnAddress, haltSetup.expectedReturn, 'NMI must resume at HALT+1');
  await page.evaluate(async () => {
    const api = window.X1PenAutomation;
    await api.debugger.setBreakpoints([]);
    await api.debugger.resume();
  });
  await page.waitForFunction(() => window.X1PenAutomation.debugger.readMemory(0x5300, 1).bytes[0] === 0x77);

  const resetCancellation = await page.evaluate(async ({ counter, handler }) => {
    const api = window.X1PenAutomation;
    await api.debugger.pause();
    const module = window.Module;
    const ram = new Uint8Array(module.wasmMemory.buffer, module._js_get_main_ram(), 0x10000);
    ram.set(handler, 0x0066);
    ram[counter] = 0;
    window.XmilControls.nmi();
    await window.XmilControls.iplReset();
    await api.debugger.setBreakpoints([]);
    await api.debugger.resume();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await api.debugger.pause();
    return ram[counter];
  }, { counter: counterAddress, handler: setup.handler });
  assert.equal(resetCancellation, 0, 'IPL reset must cancel a queued NMI');
});
