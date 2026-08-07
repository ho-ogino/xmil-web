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
  assert.equal(ready.capabilities.debugger.available, true);
  assert.equal(ready.capabilities.debugger.version, 2);
  assert.equal(ready.capabilities.debugger.addressSpaceSize, 0x10000);
  assert.equal(ready.capabilities.debugger.maxReadLength, 4096);
  assert.equal(ready.capabilities.debugger.runPending, false);
  assert.equal(ready.capabilities.debugger.vram.available, true);
  assert.deepEqual(ready.capabilities.debugger.vram.regions, ['text', 'attribute', 'kanji', 'graphics']);

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
      };
    } finally {
      module._js_debug_read_vram = saved;
    }
  });
  assert.deepEqual(unavailableVramCapability, { debugger: true, vram: false });

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
    const result = await page.evaluate(() => window.X1PenAutomation.run());
    assert.equal(result.ok, true);
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
    const breakpointPromise = api.debugger.setBreakpoints([0x2345]);
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
    const queuedBreakpoints = await breakpointPromise;
    const after = api.debugger.getState();
    let runningStepError = null;
    try {
      await api.debugger.step();
    } catch (error) {
      runningStepError = error.message;
    }
    const pausedAfterRun = await api.debugger.pause();
    await api.debugger.setBreakpoints([]);
    await api.debugger.resume();
    return { before, result, pendingStatus, after, controlErrors, runningStepError, pausedAfterRun, queuedBreakpoints };
  });
  assert.equal(rerun.before.runState, 'paused');
  assert.equal(rerun.result.ok, true);
  assert.equal(rerun.pendingStatus, true);
  assert.equal(rerun.after.runState, 'running', 'Run must resume a paused debugger session');
  assert.deepEqual(rerun.controlErrors.map((error) => error.code), ['RUN_PENDING', 'RUN_PENDING', 'RUN_PENDING']);
  assert.ok(rerun.controlErrors.every((error) => /run setup is pending/.test(error.message)));
  assert.match(rerun.runningStepError, /requires the paused state/);
  assert.equal(rerun.pausedAfterRun.runState, 'paused');
  assert.equal(rerun.queuedBreakpoints.breakpointCount, 1);

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
