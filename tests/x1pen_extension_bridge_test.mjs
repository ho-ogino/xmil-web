import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { invokeX1PenInPage } from '../extension/page-automation.mjs';

afterEach(() => {
  delete globalThis.window;
});

function createAutomationApi() {
  const locks = [];
  const calls = [];
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
      capabilities: {
        debugger: { available: true, runPending: pendingReads-- > 0 },
      },
    }),
    getProgram: () => ({ revision: 1 }),
    setInteractionLocked: (locked, label) => locks.push({ locked, label }),
    debugger: {
      getState: () => state(),
      pause: async () => {
        calls.push('pause');
        if (pauseAttempts++ === 0) {
          const error = new Error('run pending');
          error.code = 'RUN_PENDING';
          throw error;
        }
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
      waitForPause: async (options) => ({ ...state(), options }),
    },
  };
  return { api, calls, locks };
}

test('page bridge allowlists debugger operations and retries Run setup races', async () => {
  const { api, calls, locks } = createAutomationApi();
  globalThis.window = { X1PenAutomation: api };

  assert.deepEqual(await invokeX1PenInPage('getProgram', {}), { revision: 1 });
  const paused = await invokeX1PenInPage('debuggerPause', {});
  assert.equal(paused.runState, 'paused');
  assert.deepEqual(calls.filter((call) => call === 'pause'), ['pause', 'pause']);
  assert.deepEqual(locks.slice(-2), [
    { locked: true, label: 'AI is pausing the debugger...' },
    { locked: false, label: undefined },
  ]);

  const stepped = await invokeX1PenInPage('debuggerStep', { count: 3 });
  assert.equal(stepped.stepsExecuted, 3);
  assert.equal(stepped.registers.pc, 0x0103);
  assert.equal(calls.filter((call) => call === 'step').length, 3);

  const breakpoints = await invokeX1PenInPage('debuggerSetBreakpoints', { addresses: [0x100, 0x120] });
  assert.equal(breakpoints.breakpointCount, 2);
  const memory = await invokeX1PenInPage('debuggerReadMemory', { address: 0x200, length: 4 });
  assert.deepEqual(memory.bytes, [0xAA, 0xAA, 0xAA, 0xAA]);
  const waited = await invokeX1PenInPage('debuggerWaitForPause', { stopReason: 'breakpoint' });
  assert.deepEqual(waited.options, { stopReason: 'breakpoint' });

  await assert.rejects(invokeX1PenInPage('debuggerStep', { count: 101 }), /integer from 1 to 100/);
  await assert.rejects(invokeX1PenInPage('evaluateJavaScript', {}), /Unsupported X1Pen method/);
});

test('page bridge rejects debugger calls when capability is unavailable', async () => {
  const { api } = createAutomationApi();
  api.getStatus = () => ({ capabilities: { debugger: { available: false, runPending: false } } });
  globalThis.window = { X1PenAutomation: api };
  await assert.rejects(invokeX1PenInPage('debuggerGetState', {}), /does not provide the debugger API/);
});
