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
  assert.equal(await page.evaluate(() => window.X1PenAutomation.version), 2);

  const program = {
    sourceMode: 'basic+asm',
    basic: '10 PRINT "MCP READY"',
    asm: '',
    slang: '',
  };
  const loaded = await page.evaluate((value) => {
    const current = window.X1PenAutomation.getProgram();
    return window.X1PenAutomation.setProgram(value, current.revision);
  }, program);
  assert.equal(loaded.basic, program.basic);
  assert.equal(loaded.sourceMode, program.sourceMode);
  assert.equal(loaded.revision, 1);
  assert.equal(typeof loaded.instanceId, 'string');

  const validation = await page.evaluate(() => window.X1PenAutomation.validate());
  assert.equal(validation.ok, true);
  assert.ok(validation.output.basicBytes > 0);

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
  assert.equal(programs.final.basic, '');
  assert.equal(programs.final.asm, '');
  assert.equal(programs.final.slang, 'main() BEGIN\nEND;');
  assert.equal(programs.final.sourceMode, 'slang');
  assert.ok(programs.final.revision > programs.results[0].revision);
});

test('revision conflicts prevent stale AI updates', async () => {
  const result = await page.evaluate(async () => {
    const stale = window.X1PenAutomation.getProgram().revision;
    await window.X1PenAutomation.setProgram({ sourceMode: 'basic+asm', basic: '10 PRINT "HUMAN"' });
    try {
      await window.X1PenAutomation.setProgram({ sourceMode: 'basic+asm', basic: '10 PRINT "AI"' }, stale);
      return null;
    } catch (error) {
      return error.message;
    }
  });
  assert.match(result, /Revision conflict/);
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

test('Z80 debugger pauses, steps, resumes, and reads mapped memory', { timeout: 60_000 }, async () => {
  const programAddress = 0x0100;
  const expectedBytes = [0x00, 0x3C, 0xC3, 0x00, 0x01]; // NOP; INC A; JP 0100h

  const initial = await page.evaluate(async () => {
    const module = window.Module;
    if (module._js_debug_replace_breakpoints(0, 0) !== 1) {
      throw new Error('failed to clear breakpoints');
    }

    await window.X1PenAutomation.setProgram({
      sourceMode: 'asm',
      asm: 'ORG 0100h\nNOP\nINC A\nJP 0100h',
    });
    return window.X1PenAutomation.run();
  });
  assert.equal(initial.ok, true);

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
  }, { address: programAddress, bytes: expectedBytes });

  const breakpointAddress = await page.evaluate(() => {
    const module = window.Module;
    module._js_debug_pause();
    const statePtr = module._malloc(31 * 4);
    try {
      module._js_debug_get_state(statePtr, 31);
      return new Uint32Array(module.wasmMemory.buffer, statePtr, 31)[14];
    } finally {
      module._free(statePtr);
    }
  });
  assert.ok(
    breakpointAddress >= programAddress && breakpointAddress <= programAddress + 2,
    `program counter should be in the test loop, got ${breakpointAddress.toString(16)}h`,
  );

  await page.evaluate((address) => {
    const module = window.Module;
    const ptr = module._malloc(2);
    try {
      new Uint16Array(module.wasmMemory.buffer, ptr, 1)[0] = address;
      if (module._js_debug_replace_breakpoints(ptr, 1) !== 1) {
        throw new Error('failed to set breakpoint');
      }
    } finally {
      module._free(ptr);
    }
    module._js_debug_resume();
  }, breakpointAddress);

  await page.waitForFunction((address) => {
    const module = window.Module;
    const ptr = module._malloc(31 * 4);
    try {
      const result = module._js_debug_get_state(ptr, 31);
      if (result !== 31) return false;
      const state = new Uint32Array(module.wasmMemory.buffer, ptr, 31);
      return state[3] === 1 && state[4] === 2 && state[14] === address;
    } finally {
      module._free(ptr);
    }
  }, breakpointAddress);

  const stopped = await page.evaluate(({ address, length }) => {
    const module = window.Module;
    const statePtr = module._malloc(31 * 4);
    const memoryPtr = module._malloc(length);
    try {
      const stateResult = module._js_debug_get_state(statePtr, 31);
      const memoryResult = module._js_debug_read_memory(address, memoryPtr, length);
      return {
        stateResult,
        state: Array.from(new Uint32Array(module.wasmMemory.buffer, statePtr, 31)),
        memoryResult,
        memory: Array.from(new Uint8Array(module.wasmMemory.buffer, memoryPtr, length)),
        invalidRead: module._js_debug_read_memory(0xFFFF, memoryPtr, 2),
      };
    } finally {
      module._free(memoryPtr);
      module._free(statePtr);
    }
  }, { address: programAddress, length: expectedBytes.length });

  assert.equal(stopped.stateResult, 31);
  assert.equal(stopped.state[0], 1, 'debug state ABI version');
  assert.equal(stopped.state[3], 1, 'paused');
  assert.equal(stopped.state[4], 2, 'breakpoint stop');
  assert.equal(stopped.state[5], breakpointAddress);
  assert.equal(stopped.state[6], 1);
  assert.equal(stopped.state[14], breakpointAddress);
  assert.deepEqual(stopped.memory, expectedBytes);
  assert.equal(stopped.memoryResult, expectedBytes.length);
  assert.equal(stopped.invalidRead, -1);
  const accumulatorBeforeFirst = stopped.state[8] >>> 8;

  const afterFirstStep = await page.evaluate(() => {
    const module = window.Module;
    if (module._js_debug_step() !== 1) throw new Error('step failed');
    const ptr = module._malloc(31 * 4);
    try {
      module._js_debug_get_state(ptr, 31);
      return Array.from(new Uint32Array(module.wasmMemory.buffer, ptr, 31));
    } finally {
      module._free(ptr);
    }
  });
  assert.equal(afterFirstStep[4], 3, 'single-step stop');
  const expectedAfterFirst = breakpointAddress === programAddress + 2
    ? programAddress
    : breakpointAddress + 1;
  assert.equal(afterFirstStep[14], expectedAfterFirst);
  const accumulatorAfterFirst = afterFirstStep[8] >>> 8;
  assert.equal(
    accumulatorAfterFirst,
    (accumulatorBeforeFirst + Number(breakpointAddress === programAddress + 1)) & 0xFF,
  );

  const afterSecondStep = await page.evaluate(() => {
    const module = window.Module;
    module._js_debug_step();
    const ptr = module._malloc(31 * 4);
    try {
      module._js_debug_get_state(ptr, 31);
      return Array.from(new Uint32Array(module.wasmMemory.buffer, ptr, 31));
    } finally {
      module._free(ptr);
    }
  });
  const expectedAfterSecond = expectedAfterFirst === programAddress + 2
    ? programAddress
    : expectedAfterFirst + 1;
  assert.equal(afterSecondStep[14], expectedAfterSecond);
  assert.equal(
    afterSecondStep[8] >>> 8,
    (accumulatorAfterFirst + Number(expectedAfterFirst === programAddress + 1)) & 0xFF,
  );

  const sequenceBeforeResume = afterSecondStep[2];
  await page.evaluate(() => window.Module._js_debug_resume());
  await page.waitForFunction(({ address, sequence }) => {
    const module = window.Module;
    const ptr = module._malloc(31 * 4);
    try {
      module._js_debug_get_state(ptr, 31);
      const state = new Uint32Array(module.wasmMemory.buffer, ptr, 31);
      return state[2] > sequence && state[4] === 2 && state[14] === address;
    } finally {
      module._free(ptr);
    }
  }, { address: breakpointAddress, sequence: sequenceBeforeResume });

  const manualStop = await page.evaluate(async () => {
    const module = window.Module;
    module._js_debug_replace_breakpoints(0, 0);
    module._js_debug_resume();
    await new Promise((resolve) => setTimeout(resolve, 30));
    module._js_debug_pause();
    const ptr = module._malloc(31 * 4);
    try {
      module._js_debug_get_state(ptr, 31);
      return Array.from(new Uint32Array(module.wasmMemory.buffer, ptr, 31));
    } finally {
      module._free(ptr);
    }
  });
  assert.equal(manualStop[3], 1);
  assert.equal(manualStop[4], 1);
  assert.equal(manualStop[6], 0);

  await page.evaluate(() => window.Module._js_debug_resume());
});
