import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { invokeX1PenInPage } from '../extension/page-automation.mjs';
import { createUpdateCoordinator } from '../extension/update-coordinator.mjs';
import {
  CONNECTOR_FEATURES,
  allComponentsAdvertiseFeature,
  assertMcpProtocolSupported,
  createConnectorDescriptor,
  normalizeMcpServerDescriptor,
  normalizeX1PenDescriptor,
  serializeExtensionError,
} from '../extension/compatibility.mjs';
import { FEATURE_IDS, MCP_FEATURES } from '../mcp/x1pen-compatibility.mjs';

afterEach(() => {
  delete globalThis.window;
});

function createAutomationApi() {
  const locks = [];
  const calls = [];
  const timeline = [];
  let pendingReads = 2;
  let pauseAttempts = 0;
  let pc = 0x0100;
  const state = (overrides = {}) => ({
    version: 1,
    sequence: 10,
    runState: 'paused',
    stopReason: 'manual',
    registers: { pc },
    ...overrides,
  });
  const api = {
    version: 2,
    ready: async () => ({ ready: true }),
    getStatus: () => ({
      x1pen: { version: '0.9.0', features: ['automation.core', 'input.keyboard', 'input.pad', 'debugger.cpu', 'debugger.vram'] },
      capabilities: {
        debugger: { available: true, runPending: pendingReads-- > 0, vram: { available: true } },
      },
    }),
    getProgram: () => ({ revision: 1 }),
    setProgram: async (program, expectedRevision, expectedRevisionEpoch, transport) => {
      calls.push({ setProgram: { program, expectedRevision, expectedRevisionEpoch, transport } });
      return { ...program, revision: expectedRevision + 1, revisionEpoch: expectedRevisionEpoch };
    },
    run: async (options) => {
      calls.push({ run: options });
      return { ok: false, code: 'RUN_IN_PROGRESS', retryable: true, retryAfterMs: 500 };
    },
    recoverStalled: (confirmDataLoss) => ({
      ok: confirmDataLoss,
      code: confirmDataLoss ? 'RECOVERY_ACCEPTED' : 'RECOVERY_CONFIRM_REQUIRED',
    }),
    sendKey: async (code, durationMs) => {
      calls.push({ sendKey: { code, durationMs } });
      return { ok: true, code, durationMs };
    },
    setPad: async (port, bits) => {
      calls.push({ setPad: { port, bits } });
      return { ok: true, port, bits };
    },
    releasePads: () => {
      calls.push('releasePads');
      return { ok: true, released: true, bits: [255, 255] };
    },
    setInteractionLocked: (locked, label) => {
      locks.push({ locked, label });
      timeline.push(locked ? 'lock:on' : 'lock:off');
    },
    debugger: {
      getState: () => state(),
      pause: async () => {
        calls.push('pause');
        if (pauseAttempts++ === 0) {
          const error = new Error('run pending');
          error.code = 'RUN_PENDING';
          throw error;
        }
        timeline.push('pause:done');
        return state();
      },
      resume: async () => state({ sequence: 11, runState: 'running', stopReason: 'none' }),
      step: async () => {
        calls.push('step');
        pc++;
        return state({ sequence: 10 + calls.filter((call) => call === 'step').length, stopReason: 'step' });
      },
      setBreakpoints: async (addresses) => state({ breakpointCount: new Set(addresses).size }),
      readMemory: (address, length) => ({ address, length, bytes: Array(length).fill(0xAA) }),
      getVideoState: () => ({ model: 'x1', displayBank: 0, accessBank: 0 }),
      readVram: (options) => ({ ...options, bank: 0, bytes: [0x12, 0x34] }),
      writeVram: async (options) => {
        timeline.push('vram-write:done');
        return { ...options, bank: 0, bytesWritten: options.bytes.length, redrawPending: true };
      },
      waitForPause: async (options) => ({ ...state(), options }),
    },
  };
  return { api, calls, locks, timeline };
}

test('page bridge allowlists debugger operations and retries Run setup races', async () => {
  const { api, calls, locks, timeline } = createAutomationApi();
  globalThis.window = { X1PenAutomation: api };

  assert.deepEqual(await invokeX1PenInPage('getProgram', {}), { revision: 1 });
  const updated = await invokeX1PenInPage('setProgram', {
    program: { sourceMode: 'basic+asm', basic: '10 END' },
    expectedRevision: 1,
    expectedRevisionEpoch: 'epoch-a',
  });
  assert.equal(updated.revisionEpoch, 'epoch-a');
  assert.deepEqual(calls.at(-1), {
    setProgram: {
      program: { sourceMode: 'basic+asm', basic: '10 END' },
      expectedRevision: 1,
      expectedRevisionEpoch: 'epoch-a',
      transport: { requireRevisionEpoch: false },
    },
  });
  await invokeX1PenInPage('setProgram', {
    program: { sourceMode: 'basic+asm', basic: '20 END' },
    expectedRevision: 2,
    expectedRevisionEpoch: 'epoch-b',
    transport: { requireRevisionEpoch: true },
  });
  assert.equal(calls.at(-1).setProgram.transport.requireRevisionEpoch, true);
  const paused = await invokeX1PenInPage('debuggerPause', {});
  assert.equal(paused.runState, 'paused');
  assert.deepEqual(calls.filter((call) => call === 'pause'), ['pause', 'pause']);
  assert.deepEqual(locks.slice(-2), [
    { locked: true, label: 'AI is pausing the debugger...' },
    { locked: false, label: undefined },
  ]);
  assert.deepEqual(timeline.slice(-3), ['lock:on', 'pause:done', 'lock:off']);

  const stepped = await invokeX1PenInPage('debuggerStep', { count: 3 });
  assert.equal(stepped.stepsExecuted, 3);
  assert.equal(stepped.registers.pc, 0x0103);
  assert.equal(calls.filter((call) => call === 'step').length, 3);

  let failingStep = 0;
  api.debugger.step = async () => {
    if (++failingStep === 3) throw new Error('CPU step failed');
    return { runState: 'paused' };
  };
  await assert.rejects(
    invokeX1PenInPage('debuggerStep', { count: 5 }),
    /failed after 2 of 5 instructions: CPU step failed/,
  );

  const breakpoints = await invokeX1PenInPage('debuggerSetBreakpoints', { addresses: [0x100, 0x120] });
  assert.equal(breakpoints.breakpointCount, 2);
  const memory = await invokeX1PenInPage('debuggerReadMemory', { address: 0x200, length: 4 });
  assert.deepEqual(memory.bytes, [0xAA, 0xAA, 0xAA, 0xAA]);
  const video = await invokeX1PenInPage('debuggerGetVideoState', {});
  assert.equal(video.model, 'x1');
  const vram = await invokeX1PenInPage('debuggerReadVram', {
    region: 'graphics', bank: 'access', plane: 'blue', offset: 0, length: 2,
  });
  assert.deepEqual(vram.bytes, [0x12, 0x34]);
  const written = await invokeX1PenInPage('debuggerWriteVram', {
    region: 'graphics', bank: 'access', plane: 'blue', offset: 0, bytes: [0x56],
  });
  assert.equal(written.bytesWritten, 1);
  assert.deepEqual(timeline.slice(-3), ['lock:on', 'vram-write:done', 'lock:off']);
  const waited = await invokeX1PenInPage('debuggerWaitForPause', { stopReason: 'breakpoint' });
  assert.deepEqual(waited.options, { stopReason: 'breakpoint' });

  await assert.rejects(invokeX1PenInPage('debuggerStep', { count: 101 }), /integer from 1 to 100/);
  await assert.rejects(invokeX1PenInPage('evaluateJavaScript', {}), /Unsupported X1Pen method/);
});

test('page bridge preserves Run admission results and routes guarded recovery', async () => {
  const { api, calls, locks } = createAutomationApi();
  globalThis.window = { X1PenAutomation: api };

  const started = Date.now();
  const busy = await invokeX1PenInPage('run', { waitMs: 200, queueTimeoutMs: 15000 });
  assert.equal(busy.code, 'RUN_IN_PROGRESS');
  assert.ok(Date.now() - started < 150, 'admission failure must skip waitMs');
  assert.deepEqual(calls.at(-1), { run: { origin: 'mcp', queueTimeoutMs: 15000 } });
  assert.deepEqual(locks.slice(-2), [
    { locked: true, label: 'AI is running the program...' },
    { locked: false, label: undefined },
  ]);

  assert.deepEqual(await invokeX1PenInPage('recoverStalled', { confirmDataLoss: false }), {
    ok: false, code: 'RECOVERY_CONFIRM_REQUIRED',
  });
  assert.deepEqual(await invokeX1PenInPage('recoverStalled', { confirmDataLoss: true }), {
    ok: true, code: 'RECOVERY_ACCEPTED',
  });
});

test('page bridge allowlists keyboard input and requires its advertised capability', async () => {
  const { api, calls, locks } = createAutomationApi();
  globalThis.window = { X1PenAutomation: api };
  assert.deepEqual(await invokeX1PenInPage('sendKey', { code: 0x41, durationMs: 120 }), {
    ok: true, code: 0x41, durationMs: 120,
  });
  assert.deepEqual(calls.at(-1), { sendKey: { code: 0x41, durationMs: 120 } });
  assert.deepEqual(locks.slice(-2), [
    { locked: true, label: 'AI is sending keyboard input...' },
    { locked: false, label: undefined },
  ]);

  api.getStatus = () => ({ x1pen: { version: '0.9.0', features: ['automation.core'] } });
  await assert.rejects(
    invokeX1PenInPage('sendKey', { code: 0x41, durationMs: 80 }),
    (error) => error.code === 'FEATURE_UNAVAILABLE' && error.feature === 'input.keyboard',
  );
});

test('page bridge allowlists pad input and exposes cleanup without arbitrary routes', async () => {
  const { api, calls, locks } = createAutomationApi();
  globalThis.window = { X1PenAutomation: api };
  assert.deepEqual(await invokeX1PenInPage('setPad', { port: 1, bits: 0xFE }), {
    ok: true, port: 1, bits: 0xFE,
  });
  assert.deepEqual(calls.at(-1), { setPad: { port: 1, bits: 0xFE } });
  assert.deepEqual(locks.slice(-2), [
    { locked: true, label: 'AI is setting controller input...' },
    { locked: false, label: undefined },
  ]);
  assert.deepEqual(await invokeX1PenInPage('releasePads', {}), {
    ok: true, released: true, bits: [255, 255],
  });
  assert.equal(calls.at(-1), 'releasePads');

  api.getStatus = () => ({ x1pen: { version: '0.9.0', features: ['automation.core'] } });
  await assert.rejects(
    invokeX1PenInPage('setPad', { port: 1, bits: 0xFE }),
    (error) => error.code === 'FEATURE_UNAVAILABLE' && error.feature === 'input.pad',
  );
});

test('page bridge rejects debugger calls when capability is unavailable', async () => {
  const { api } = createAutomationApi();
  api.getStatus = () => ({ capabilities: { debugger: { available: false, runPending: false } } });
  globalThis.window = { X1PenAutomation: api };
  await assert.rejects(invokeX1PenInPage('debuggerGetState', {}), /does not provide the debugger API/);
});

test('page bridge rejects VRAM calls when its capability is unavailable', async () => {
  const { api } = createAutomationApi();
  api.getStatus = () => ({
    capabilities: { debugger: { available: true, runPending: false, vram: { available: false } } },
  });
  globalThis.window = { X1PenAutomation: api };
  await assert.rejects(
    invokeX1PenInPage('debuggerReadVram', { region: 'text', offset: 0, length: 1 }),
    /does not provide the VRAM debugger API/,
  );
});

test('page bridge treats advertised features as authoritative', async () => {
  const { api } = createAutomationApi();
  api.getStatus = () => ({
    x1pen: { features: ['automation.core', 'screen.capture', 'debugger.cpu'] },
    capabilities: { debugger: { available: true, runPending: false, vram: { available: true } } },
  });
  globalThis.window = { X1PenAutomation: api };
  await assert.rejects(
    invokeX1PenInPage('debuggerReadVram', { region: 'text', offset: 0, length: 1 }),
    (error) => error.code === 'FEATURE_UNAVAILABLE' && error.component === 'x1pen' &&
      error.feature === 'debugger.vram',
  );
});

test('connector compatibility metadata is bounded and preserves legacy fallbacks', () => {
  assert.deepEqual(createConnectorDescriptor('1.3.0'), {
    name: 'x1pen-connector',
    version: '1.3.0',
    protocolVersion: 2,
    features: [...CONNECTOR_FEATURES],
  });
  assert.deepEqual(normalizeX1PenDescriptor({
    x1pen: {
      version: '0.8.0', automationApiVersion: 2,
      features: ['automation.core', 'debugger.vram', 'invalid feature', 'debugger.vram'],
    },
  }), {
    name: 'x1pen', version: '0.8.0', automationApiVersion: 2,
    features: ['automation.core', 'debugger.vram'],
  });
  assert.deepEqual(normalizeX1PenDescriptor({
    capabilities: { debugger: { available: true, vram: { available: false } } },
  }).features, ['automation.core', 'screen.capture', 'debugger.cpu']);
  assert.deepEqual(normalizeMcpServerDescriptor({ type: 'paired', protocolVersion: 1 }), {
    name: 'x1pen-mcp', version: null, protocolVersion: 1, features: [],
  });
  assert.doesNotThrow(() => assertMcpProtocolSupported({ protocolVersion: 2 }));
  assert.throws(
    () => assertMcpProtocolSupported({ protocolVersion: 3, version: '3.0.0' }),
    (error) => error.code === 'BRIDGE_PROTOCOL_UNSUPPORTED' && error.component === 'mcp',
  );
});

test('feature IDs match across X1Pen, Connector and MCP', () => {
  const source = readFileSync(new URL('../html/x1pen.js', import.meta.url), 'utf8');
  const featureFunction = source.match(
    /function getAutomationFeatures\(\) \{([\s\S]*?)\n    \}/,
  );
  assert.ok(featureFunction, 'getAutomationFeatures implementation was not found');

  const x1penFeatures = Array.from(
    featureFunction[1].matchAll(/['"]([a-z][a-z0-9.-]+)['"]/g),
    (match) => match[1],
  );
  const expected = [...FEATURE_IDS].sort();
  assert.deepEqual([...new Set(x1penFeatures)].sort(), expected);
  assert.deepEqual([...CONNECTOR_FEATURES].sort(), expected);
  assert.deepEqual([...MCP_FEATURES].sort(), expected);
});

test('revision epoch transport is required only when every component advertises source sync', () => {
  const current = { features: ['automation.core', 'automation.source-sync'] };
  const legacy = { features: ['automation.core'] };
  assert.equal(allComponentsAdvertiseFeature('automation.source-sync', current, current, current), true);
  assert.equal(allComponentsAdvertiseFeature('automation.source-sync', legacy, current, current), false);
  assert.equal(allComponentsAdvertiseFeature('automation.source-sync', current, legacy, current), false);
  assert.equal(allComponentsAdvertiseFeature('automation.source-sync', current, current, legacy), false);
  assert.equal(allComponentsAdvertiseFeature('automation.source-sync', current, null, current), false);
});

test('connector serializes machine-readable errors without copying arbitrary fields', () => {
  const error = new Error('Update X1Pen');
  Object.assign(error, {
    code: 'X1PEN_UPDATE_REQUIRED', component: 'x1pen', feature: 'debugger.vram',
    requiredVersion: '0.8.0', action: 'Reload X1Pen', secret: 'discard',
    expectedRevision: 3, currentRevision: 4,
    expectedRevisionEpoch: 'epoch-a', currentRevisionEpoch: 'epoch-b',
    instanceId: 'tab-a', metadataAvailable: true,
  });
  assert.deepEqual(serializeExtensionError(error), {
    message: 'Update X1Pen', code: 'X1PEN_UPDATE_REQUIRED', component: 'x1pen',
    feature: 'debugger.vram', requiredVersion: '0.8.0', action: 'Reload X1Pen',
    expectedRevision: 3, currentRevision: 4,
    expectedRevisionEpoch: 'epoch-a', currentRevisionEpoch: 'epoch-b',
    instanceId: 'tab-a', metadataAvailable: true,
  });
});

test('connector bounds structured error strings and drops invalid revision fields', () => {
  const error = new Error('M'.repeat(2_000));
  Object.assign(error, {
    code: 'C'.repeat(200), action: 'A'.repeat(1_000),
    expectedRevision: -1, currentRevision: Number.POSITIVE_INFINITY,
    expectedRevisionEpoch: 'E'.repeat(200),
  });
  const serialized = serializeExtensionError(error);
  assert.equal(serialized.message.length, 1_024);
  assert.equal(serialized.code.length, 128);
  assert.equal(serialized.action.length, 512);
  assert.equal(serialized.expectedRevision, undefined);
  assert.equal(serialized.currentRevision, undefined);
  assert.equal(serialized.expectedRevisionEpoch, undefined);
});

test('extension update waits for active operations before disconnecting and reloading', async () => {
  const scheduled = [];
  const timeline = [];
  let finishOperation;
  const operationGate = new Promise((resolve) => { finishOperation = resolve; });
  const coordinator = createUpdateCoordinator({
    prepare: async () => { timeline.push('prepare'); },
    reload: () => { timeline.push('reload'); },
    schedule: (callback) => scheduled.push(callback),
  });

  const operation = coordinator.run(async () => {
    timeline.push('operation:start');
    await operationGate;
    timeline.push('operation:end');
  });
  coordinator.requestUpdate();
  coordinator.requestUpdate();
  assert.equal(coordinator.isUpdatePending(), true);
  assert.equal(scheduled.length, 1);

  await scheduled.shift()();
  assert.deepEqual(timeline, ['operation:start']);

  finishOperation();
  await operation;
  assert.equal(scheduled.length, 1);
  await scheduled.shift()();
  assert.deepEqual(timeline, ['operation:start', 'operation:end', 'prepare', 'reload']);
});

test('extension update reloads even when disconnect cleanup fails', async () => {
  const scheduled = [];
  const errors = [];
  let reloads = 0;
  const coordinator = createUpdateCoordinator({
    prepare: async () => { throw new Error('disconnect failed'); },
    reload: () => { reloads++; },
    schedule: (callback) => scheduled.push(callback),
    onError: (error) => errors.push(error.message),
  });

  coordinator.requestUpdate();
  await scheduled.shift()();
  assert.deepEqual(errors, ['disconnect failed']);
  assert.equal(reloads, 1);
});
