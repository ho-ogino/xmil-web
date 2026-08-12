import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertMethodCompatible,
  createMcpDescriptor,
  evaluateCompatibility,
  normalizeConnectorPair,
  normalizeX1PenDescriptor,
} from '../mcp/x1pen-compatibility.mjs';
import { createX1PenMcpServer, parseAllowedSourceRootArgs } from '../mcp/x1pen-server.mjs';

const initialProgram = {
  sourceMode: 'basic+asm',
  basic: '10 PRINT "MCP"\n20 END',
  asm: '',
  slang: '',
  revision: 3,
  revisionEpoch: 'epoch-a',
  instanceId: 'tab-a',
};
const calls = [];
let currentProgram;
let debuggerState;
let compatibilityFailure;
let runResponse;
let recoveryResponse;
let compatibilityComponents;
let stripRevisionEpoch;
let getProgramCount;
let beforeGetProgram;
let selectedSessionId;
let sourceRoot;

const FULL_FEATURES = [
  'automation.core', 'automation.run-recovery', 'automation.source-sync',
  'screen.capture', 'input.keyboard', 'input.pad', 'debugger.cpu', 'debugger.vram',
];

function configureCompatibility({ connectorSourceSync = true, x1penSourceSync = true } = {}) {
  compatibilityComponents = {
    mcp: createMcpDescriptor('2.7.0'),
    connector: normalizeConnectorPair({
      extensionVersion: connectorSourceSync ? '1.3.0' : '1.2.0',
      connector: {
        name: 'x1pen-connector', version: connectorSourceSync ? '1.3.0' : '1.2.0',
        protocolVersion: 2,
        features: FULL_FEATURES.filter((feature) => connectorSourceSync || feature !== 'automation.source-sync'),
      },
    }),
    x1pen: normalizeX1PenDescriptor({
      version: x1penSourceSync ? '0.8.1' : '0.8.0', automationApiVersion: 2,
      features: FULL_FEATURES.filter((feature) => x1penSourceSync || feature !== 'automation.source-sync'),
    }),
  };
  stripRevisionEpoch = !connectorSourceSync;
}

const initialDebuggerState = {
  version: 1,
  sequence: 10,
  runState: 'paused',
  runStateCode: 1,
  stopReason: 'manual',
  stopReasonCode: 1,
  stopAddress: 0x0100,
  breakpointCount: 0,
  emulatorRunning: true,
  registers: { pc: 0x0100, sp: 0xF000, af: 0, bc: 0, de: 0, hl: 0 },
  cycles: 1234,
  memory: { lowMapping: 'main', lowMappingCode: 0, lowBank: null },
};

function clone(value) {
  return structuredClone(value);
}

function normalizeProgram(program) {
  const normalized = {
    sourceMode: program.sourceMode,
    basic: program.basic || '',
    asm: program.asm || '',
    slang: program.slang || '',
  };
  if (normalized.sourceMode === 'slang') {
    normalized.basic = '';
    normalized.asm = '';
  } else if (normalized.sourceMode === 'asm') {
    normalized.basic = '';
    normalized.slang = '';
  } else {
    normalized.slang = '';
  }
  return normalized;
}

const fakeBridge = {
  commandTimeoutMs: 40_000,
  connectionInfo() {
    return {
      port: 43110, pairingCode: '123456', extensionConnected: true,
      components: {
        mcp: { name: 'x1pen-mcp', version: '2.7.0' },
        connector: { name: 'x1pen-connector', version: '1.3.0' },
      },
    };
  },
  listSessions() {
    return [{ sessionId: 'tab-a', title: 'X1Pen', selected: true, x1pen: { version: '0.8.0' } }];
  },
  resolveSession(sessionId) { return sessionId || selectedSessionId; },
  async selectSession(sessionId, options) { return { sessionId, force: options?.force === true }; },
  getSessionCompatibility() {
    const capabilities = evaluateCompatibility({ ...compatibilityComponents, connected: true });
    return {
      components: compatibilityComponents,
      capabilities,
    };
  },
  async sendCommand(method, params, sessionId) {
    const compatibility = this.getSessionCompatibility();
    assertMethodCompatible(method, compatibility.capabilities, compatibility.components);
    calls.push({ method, params: clone(params), sessionId });
    if (compatibilityFailure && method === compatibilityFailure.method) {
      compatibilityFailure.beforeThrow?.();
      throw compatibilityFailure.error;
    }
    if (method === 'getProgram') {
      getProgramCount++;
      beforeGetProgram?.(getProgramCount);
      return clone(currentProgram);
    }
    if (method === 'setProgram') {
      const pageSupportsEpoch = compatibilityComponents.x1pen.features.includes('automation.source-sync');
      const transportedEpoch = stripRevisionEpoch || !pageSupportsEpoch
        ? undefined
        : params.expectedRevisionEpoch;
      if (transportedEpoch !== undefined && transportedEpoch !== currentProgram.revisionEpoch) {
        const error = new Error('Revision epoch conflict');
        Object.assign(error, {
          code: 'REVISION_EPOCH_MISMATCH', component: 'x1pen',
          expectedRevision: params.expectedRevision,
          expectedRevisionEpoch: transportedEpoch,
          currentRevision: currentProgram.revision,
          currentRevisionEpoch: currentProgram.revisionEpoch,
          instanceId: currentProgram.instanceId,
        });
        throw error;
      }
      if (params.expectedRevision !== currentProgram.revision) {
        const error = new Error(`Revision conflict: expected ${params.expectedRevision}, current ${currentProgram.revision}`);
        Object.assign(error, {
          code: 'REVISION_MISMATCH', component: 'x1pen',
          expectedRevision: params.expectedRevision, currentRevision: currentProgram.revision,
          currentRevisionEpoch: currentProgram.revisionEpoch, instanceId: currentProgram.instanceId,
        });
        throw error;
      }
      currentProgram = {
        ...normalizeProgram(params.program),
        revision: currentProgram.revision + 1,
        revisionEpoch: currentProgram.revisionEpoch,
        instanceId: currentProgram.instanceId,
        guardedWritesReloadSafe: transportedEpoch !== undefined,
      };
      return clone(currentProgram);
    }
    if (method === 'validate') return { ok: true, diagnostics: [] };
    if (method === 'run') return clone(runResponse);
    if (method === 'recoverStalled') return clone(recoveryResponse);
    if (method === 'getStatus') {
      return {
        ready: true,
        activeLanguageProfile: { language: 'fuzzybasic', id: 'x1pen-fuzzybasic-1.2L' },
        languageProfiles: {
          fuzzybasic: { id: 'x1pen-fuzzybasic-1.2L' },
          slang: { id: 'x1pen-slang-c9e8f53-lsx' },
        },
      };
    }
    if (method === 'captureScreen') return `data:image/png;base64,${Buffer.from('png').toString('base64')}`;
    if (method === 'debuggerGetState') return clone(debuggerState);
    if (method === 'debuggerPause') {
      debuggerState = { ...debuggerState, sequence: debuggerState.sequence + 1, runState: 'paused', stopReason: 'manual' };
      return clone(debuggerState);
    }
    if (method === 'debuggerResume') {
      debuggerState = { ...debuggerState, sequence: debuggerState.sequence + 1, runState: 'running', stopReason: 'none' };
      return clone(debuggerState);
    }
    if (method === 'debuggerStep') {
      debuggerState = {
        ...debuggerState,
        sequence: debuggerState.sequence + params.count,
        runState: 'paused',
        stopReason: 'step',
        registers: { ...debuggerState.registers, pc: debuggerState.registers.pc + params.count },
      };
      return { ...clone(debuggerState), stepsExecuted: params.count };
    }
    if (method === 'debuggerSetBreakpoints') {
      debuggerState = { ...debuggerState, breakpointCount: new Set(params.addresses).size };
      return clone(debuggerState);
    }
    if (method === 'debuggerReadMemory') {
      return {
        address: params.address,
        length: params.length,
        bytes: Array.from({ length: params.length }, (_, index) => (params.address + index) & 0xFF),
      };
    }
    if (method === 'debuggerGetVideoState') {
      return {
        version: 1, model: 'x1', romType: 1, displayBank: 0, accessBank: 0,
        text: { columns: 80, rows: 25, regionSize: 0x0800, kanjiAvailable: false },
        graphics: { width: 640, height: 200, banks: 1, planes: ['blue', 'red', 'green'], planeSize: 0x4000 },
      };
    }
    if (method === 'debuggerReadVram') {
      return {
        ...params,
        bankSelector: params.bank,
        bank: params.bank === 'access' || params.bank === 'display' ? 0 : params.bank,
        bytes: Array.from({ length: params.length }, (_, index) => (params.offset + 0xAB + index) & 0xFF),
      };
    }
    if (method === 'debuggerWriteVram') {
      return {
        ...params,
        bankSelector: params.bank,
        bank: params.bank === 'access' || params.bank === 'display' ? 0 : params.bank,
        length: params.bytes.length,
        bytesWritten: params.bytes.length,
        redrawPending: params.bytes.some((byte) => byte !== 0),
      };
    }
    if (method === 'debuggerWaitForPause') return clone(debuggerState);
    return { ok: true };
  },
  async close() {},
};

function jsonContent(result) {
  const item = result.content.find((entry) => entry.type === 'text');
  return JSON.parse(item.text);
}

let server;
let client;

before(async () => {
  sourceRoot = await mkdtemp(join(tmpdir(), 'x1pen-mcp-source-'));
  ({ server } = createX1PenMcpServer({ bridge: fakeBridge, allowedSourceRoots: [sourceRoot] }));
  client = new Client({ name: 'x1pen-mcp-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

beforeEach(() => {
  calls.length = 0;
  currentProgram = clone(initialProgram);
  debuggerState = clone(initialDebuggerState);
  compatibilityFailure = null;
  runResponse = { ok: true, status: 'Ready', revision: 3 };
  recoveryResponse = { ok: false, code: 'RECOVERY_CONFIRM_REQUIRED', status: 'Data loss warning' };
  configureCompatibility();
  getProgramCount = 0;
  beforeGetProgram = null;
  selectedSessionId = 'tab-a';
});

after(async () => {
  if (client) await client.close();
  if (server) await server.close();
  await rm(sourceRoot, { recursive: true, force: true });
});

test('server exposes context-efficient source tools', async () => {
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
    'x1pen_apply_edits',
    'x1pen_capture_screen',
    'x1pen_connection_info',
    'x1pen_debug_get_state',
    'x1pen_debug_get_video_state',
    'x1pen_debug_pause',
    'x1pen_debug_read_memory',
    'x1pen_debug_read_vram',
    'x1pen_debug_resume',
    'x1pen_debug_set_breakpoints',
    'x1pen_debug_step',
    'x1pen_debug_wait_for_pause',
    'x1pen_debug_write_vram',
    'x1pen_diff_source',
    'x1pen_get_language_profile',
    'x1pen_get_program',
    'x1pen_get_reference',
    'x1pen_get_source',
    'x1pen_get_status',
    'x1pen_list_sessions',
    'x1pen_recover_stalled',
    'x1pen_run',
    'x1pen_search_reference',
    'x1pen_search_source',
    'x1pen_select_session',
    'x1pen_send_key',
    'x1pen_set_pad',
    'x1pen_set_program',
    'x1pen_set_source_file',
    'x1pen_stop',
    'x1pen_validate',
  ]);
  const descriptions = Object.fromEntries(tools.tools.map((tool) => [tool.name, tool.description]));
  assert.match(descriptions.x1pen_set_program, /inactive for sourceMode are cleared even when supplied/);
  assert.match(descriptions.x1pen_set_source_file, /local UTF-8 file/);
  assert.match(descriptions.x1pen_validate, /temporary compilation output/);
  assert.match(descriptions.x1pen_validate, /does not store generated ASM/);
});

test('allowed source roots accept repeatable CLI forms and reject missing values', () => {
  assert.deepEqual(parseAllowedSourceRootArgs([
    '--allow-source-root', '/one', '--allow-source-root=/two', '--version',
  ]), ['/one', '/two']);
  assert.throws(
    () => parseAllowedSourceRootArgs(['--allow-source-root']),
    /requires a directory path/,
  );
  assert.throws(
    () => parseAllowedSourceRootArgs(['--allow-source-root=']),
    /requires a directory path/,
  );
});

test('set_source_file defaults to deny when no source root is configured', async () => {
  const { server: deniedServer } = createX1PenMcpServer({ bridge: fakeBridge });
  const deniedClient = new Client({ name: 'x1pen-mcp-denied-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await deniedServer.connect(serverTransport);
  await deniedClient.connect(clientTransport);
  try {
    const result = await deniedClient.callTool({
      name: 'x1pen_set_source_file',
      arguments: {
        path: join(sourceRoot, 'program.bas'),
        section: 'basic',
        expectedRevision: 3,
        expectedRevisionEpoch: 'epoch-a',
      },
    });
    assert.equal(result.isError, true);
    assert.equal(jsonContent(result).error.code, 'SOURCE_ROOT_NOT_CONFIGURED');
    assert.equal(calls.some((call) => call.method === 'getProgram'), false);
  } finally {
    await deniedClient.close();
    await deniedServer.close();
  }
});

test('set_source_file replaces one authoring section without returning path or content', async () => {
  currentProgram.asm = 'ORG $100\nRET';
  const path = join(sourceRoot, 'program.bas');
  const source = '10 PRINT "LOCAL FILE"\n20 END\n';
  await writeFile(path, source);
  const result = jsonContent(await client.callTool({
    name: 'x1pen_set_source_file',
    arguments: {
      path,
      section: 'basic',
      expectedRevision: 3,
      expectedRevisionEpoch: 'epoch-a',
      sessionId: 'tab-a',
    },
  }));
  assert.equal(result.changed, true);
  assert.equal(result.section, 'basic');
  assert.equal(result.byteCount, Buffer.byteLength(source));
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.revision, 4);
  assert.equal(result.basic, undefined);
  assert.equal(result.path, undefined);
  assert.equal(JSON.stringify(result).includes(source), false);
  assert.equal(JSON.stringify(result).includes(sourceRoot), false);
  assert.equal(currentProgram.basic, source);
  assert.equal(currentProgram.asm, 'ORG $100\nRET');
  assert.equal(calls.at(-1).method, 'setProgram');
  assert.equal(calls.at(-1).sessionId, 'tab-a');
});

test('set_source_file reports raw file metadata while storing normalized source text', async () => {
  const path = join(sourceRoot, 'windows.bas');
  const raw = Buffer.concat([
    Buffer.from([0xEF, 0xBB, 0xBF]),
    Buffer.from('10 PRINT "WINDOWS"\r\n20 END\r'),
  ]);
  await writeFile(path, raw);
  const result = jsonContent(await client.callTool({
    name: 'x1pen_set_source_file',
    arguments: {
      path, section: 'basic', expectedRevision: 3, expectedRevisionEpoch: 'epoch-a',
    },
  }));
  assert.equal(result.byteCount, raw.byteLength);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  assert.equal(currentProgram.basic, '10 PRINT "WINDOWS"\n20 END\n');
  assert.equal(result.sections.basic.byteCount, Buffer.byteLength(currentProgram.basic));
});

test('set_source_file handles unchanged, SLANG generated ASM and a representative 63 KiB source', async () => {
  const unchangedPath = join(sourceRoot, 'unchanged.bas');
  await writeFile(unchangedPath, currentProgram.basic);
  let result = jsonContent(await client.callTool({
    name: 'x1pen_set_source_file',
    arguments: {
      path: unchangedPath, section: 'basic', expectedRevision: 3, expectedRevisionEpoch: 'epoch-a',
    },
  }));
  assert.equal(result.changed, false);
  assert.equal(calls.some((call) => call.method === 'setProgram'), false);

  calls.length = 0;
  currentProgram = {
    sourceMode: 'slang', basic: '', asm: 'generated asm', slang: 'MAIN() BEGIN\nEND;', revision: 3,
    revisionEpoch: 'epoch-a', instanceId: 'tab-a',
  };
  const slangPath = join(sourceRoot, 'program.slang');
  await writeFile(slangPath, 'MAIN() BEGIN\n  PRINT("FILE");\nEND;\n');
  result = jsonContent(await client.callTool({
    name: 'x1pen_set_source_file',
    arguments: {
      path: slangPath, section: 'slang', expectedRevision: 3, expectedRevisionEpoch: 'epoch-a',
    },
  }));
  assert.equal(result.changed, true);
  assert.equal(result.generatedAsmCleared, true);
  assert.equal(currentProgram.asm, '');

  calls.length = 0;
  currentProgram = clone(initialProgram);
  const largeSource = `10 REM ${'A'.repeat((63 * 1024) - 11)}\n20 END\n`;
  const largePath = join(sourceRoot, 'large.bas');
  await writeFile(largePath, largeSource);
  result = jsonContent(await client.callTool({
    name: 'x1pen_set_source_file',
    arguments: {
      path: largePath, section: 'basic', expectedRevision: 3, expectedRevisionEpoch: 'epoch-a',
    },
  }));
  assert.equal(result.changed, true);
  assert.equal(result.byteCount, Buffer.byteLength(largeSource));
  assert.equal(currentProgram.basic, largeSource);
});

test('set_source_file pins the session and rejects a program change during the file read window', async () => {
  const path = join(sourceRoot, 'racy.bas');
  await writeFile(path, '10 PRINT "RACE"\n20 END\n');
  getProgramCount = 0;
  beforeGetProgram = (count) => {
    if (count === 2) {
      selectedSessionId = 'tab-b';
      currentProgram.revision = 4;
      currentProgram.basic = '10 PRINT "CONCURRENT"\n20 END';
    }
  };
  const result = await client.callTool({
    name: 'x1pen_set_source_file',
    arguments: {
      path, section: 'basic', expectedRevision: 3, expectedRevisionEpoch: 'epoch-a',
    },
  });
  assert.equal(result.isError, true);
  assert.equal(jsonContent(result).error.code, 'REVISION_MISMATCH');
  assert.equal(calls.some((call) => call.method === 'setProgram'), false);
  assert.ok(calls.every((call) => call.sessionId === 'tab-a'));
  assert.equal(currentProgram.basic, '10 PRINT "CONCURRENT"\n20 END');
});

test('send_key routes an allowlisted VK with a bounded hold duration', async () => {
  const sent = await client.callTool({
    name: 'x1pen_send_key',
    arguments: { sessionId: 'tab-a', code: 0x41, durationMs: 120 },
  });
  assert.deepEqual(jsonContent(sent), { ok: true });
  assert.deepEqual(calls.at(-1), {
    method: 'sendKey', params: { code: 0x41, durationMs: 120 }, sessionId: 'tab-a',
  });

  const rejected = await client.callTool({
    name: 'x1pen_send_key',
    arguments: { code: 0x10, durationMs: 80 },
  });
  assert.equal(rejected.isError, true);
  assert.equal(calls.some((call) => call.method === 'sendKey' && call.params.code === 0x10), false);
});

test('set_pad routes an active-low raw byte and validates both bounds', async () => {
  const sent = await client.callTool({
    name: 'x1pen_set_pad',
    arguments: { sessionId: 'tab-a', port: 2, bits: 0xBF },
  });
  assert.deepEqual(jsonContent(sent), { ok: true });
  assert.deepEqual(calls.at(-1), {
    method: 'setPad', params: { port: 2, bits: 0xBF }, sessionId: 'tab-a',
  });

  for (const argumentsValue of [{ port: 0, bits: 255 }, { port: 1, bits: 256 }]) {
    const rejected = await client.callTool({
      name: 'x1pen_set_pad',
      arguments: argumentsValue,
    });
    assert.equal(rejected.isError, true);
  }
  assert.equal(calls.filter((call) => call.method === 'setPad').length, 1);
});

test('Run admission and stalled recovery remain ordinary MCP content', async () => {
  runResponse = {
    ok: false,
    code: 'RUN_IN_PROGRESS',
    status: 'Run setup is already in progress',
    retryable: true,
    retryAfterMs: 500,
    activeOrigin: 'ui',
  };
  const run = await client.callTool({ name: 'x1pen_run', arguments: { waitMs: 500 } });
  assert.equal(run.isError, undefined);
  assert.deepEqual(jsonContent(run), runResponse);
  assert.deepEqual(calls.at(-1).params, { waitMs: 500, queueTimeoutMs: 10_000 });

  const preview = await client.callTool({ name: 'x1pen_recover_stalled', arguments: {} });
  assert.equal(preview.isError, undefined);
  assert.equal(jsonContent(preview).code, 'RECOVERY_CONFIRM_REQUIRED');
  assert.deepEqual(calls.at(-1).params, { confirmDataLoss: false });

  recoveryResponse = { ok: true, code: 'RECOVERY_ACCEPTED', reloadRequired: true };
  const accepted = await client.callTool({
    name: 'x1pen_recover_stalled', arguments: { confirmDataLoss: true },
  });
  assert.equal(accepted.isError, undefined);
  assert.equal(jsonContent(accepted).code, 'RECOVERY_ACCEPTED');
});

test('connection and status tools report all component versions and effective capabilities', async () => {
  const connection = jsonContent(await client.callTool({ name: 'x1pen_connection_info', arguments: {} }));
  assert.equal(connection.components.mcp.version, '2.7.0');
  assert.equal(connection.components.connector.version, '1.3.0');

  const sessions = jsonContent(await client.callTool({ name: 'x1pen_list_sessions', arguments: {} }));
  assert.equal(sessions.sessions[0].x1pen.version, '0.8.0');

  const status = jsonContent(await client.callTool({ name: 'x1pen_get_status', arguments: {} }));
  assert.equal(status.compatibility.components.x1pen.version, '0.8.1');
  assert.equal(status.compatibility.capabilities['debugger.vram'].available, true);
});

test('machine-readable compatibility failures survive the MCP tool boundary', async () => {
  const error = new Error('debugger.vram requires X1Pen Connector 1.2.0 or later');
  Object.assign(error, {
    code: 'CONNECTOR_UPDATE_REQUIRED', component: 'connector', feature: 'debugger.vram',
    currentVersion: '1.1.1', requiredVersion: '1.2.0', action: 'Update X1Pen Connector and reconnect this tab.',
  });
  compatibilityFailure = { method: 'debuggerReadVram', error };
  const result = await client.callTool({
    name: 'x1pen_debug_read_vram',
    arguments: { region: 'text', offset: 0, length: 1 },
  });
  assert.equal(result.isError, true);
  const details = jsonContent(result).error;
  assert.equal(details.code, 'CONNECTOR_UPDATE_REQUIRED');
  assert.equal(details.component, 'connector');
  assert.equal(details.feature, 'debugger.vram');
  assert.equal(details.currentVersion, '1.1.1');
  assert.equal(details.requiredVersion, '1.2.0');
});

test('language reference tools search compact results and fetch selected details', async () => {
  const searchResult = await client.callTool({
    name: 'x1pen_search_reference',
    arguments: { language: 'slang', query: 'TILE_SET_SCROLL' },
  });
  const search = jsonContent(searchResult);
  assert.ok(search.totalMatches >= 1);
  assert.equal(search.matches[0].id, 'slang.include.tile-sprite');
  assert.equal(search.matches[0].syntax, undefined);

  const detailResult = await client.callTool({
    name: 'x1pen_get_reference',
    arguments: { ids: [search.matches[0].id] },
  });
  const detail = jsonContent(detailResult);
  assert.equal(detail.entries[0].id, 'slang.include.tile-sprite');
  assert.ok(detail.entries[0].syntax.some((line) => line.includes('TILE_SET_SCROLL')));
  assert.equal(detail.truncated, false);

  const symbolResult = await client.callTool({
    name: 'x1pen_search_reference',
    arguments: { language: 'slang', query: '!=' },
  });
  const symbolSearch = jsonContent(symbolResult);
  assert.equal(symbolSearch.matchMode, 'symbol');
  assert.equal(symbolSearch.matches[0].id, 'slang.expressions.operators');

  const hardwareResult = await client.callTool({
    name: 'x1pen_search_reference',
    arguments: { language: 'x1', query: 'I/O空間 VRAM' },
  });
  assert.equal(jsonContent(hardwareResult).matches[0].id, 'x1.architecture.address-spaces');

  const assemblerResult = await client.callTool({
    name: 'x1pen_search_reference',
    arguments: { language: 'z80asm', query: 'MACRO ENDM' },
  });
  assert.equal(jsonContent(assemblerResult).matches[0].id, 'z80asm.macros');
});

test('language profile reports bundled data and connected X1Pen compatibility', async () => {
  const result = await client.callTool({ name: 'x1pen_get_language_profile', arguments: {} });
  const profile = jsonContent(result);
  assert.equal(profile.schemaVersion, 2);
  assert.equal(profile.profiles.length, 4);
  assert.equal(profile.active.id, 'x1pen-fuzzybasic-1.2L');
  assert.equal(profile.profiles[0].environment, 'SHARP X1 / LSX-Dodgers');
  assert.equal(profile.reportedProfiles.slang.id, 'x1pen-slang-c9e8f53-lsx');
  assert.equal(profile.defaultProfiles.x1, 'x1-hardware-xmillennium-web');
  assert.equal(profile.defaultProfiles.z80asm, 'x1pen-z80asm-current');
  assert.equal(profile.compatible, true);
  assert.equal(calls.at(-1).method, 'getStatus');
});

test('get_program defaults to metadata only and excludes generated ASM', async () => {
  const generatedAsm = Array.from({ length: 20_000 }, (_, index) => `L${index}: NOP`).join('\n');
  currentProgram = {
    sourceMode: 'slang',
    basic: '',
    asm: generatedAsm,
    slang: 'main() BEGIN\n  PRINT("MCP");\nEND;',
    revision: 8,
    revisionEpoch: 'epoch-a',
    instanceId: 'tab-a',
  };

  const defaultResult = await client.callTool({ name: 'x1pen_get_program', arguments: {} });
  const selected = jsonContent(defaultResult);
  assert.equal(selected.slang, undefined);
  assert.equal(selected.asm, undefined);
  assert.deepEqual(selected.includedFields, []);
  assert.equal(selected.sections.asm.generated, true);
  assert.equal(selected.revisionEpoch, 'epoch-a');
  assert.equal(selected.guardedWritesReloadSafe, true);
  assert.equal(selected.writeGuard, 'revision-epoch');
  assert.match(selected.authoringHash, /^sha256-authoring-v1:[0-9a-f]{64}$/);
  assert.match(selected.sections.slang.contentHash, /^sha256-utf8-v1:[0-9a-f]{64}$/);
  assert.match(selected.sections.asm.generatedContentHash, /^sha256-utf8-v1:[0-9a-f]{64}$/);
  assert.equal(selected.sections.asm.lineCount, 20_000);
  assert.ok(defaultResult.content[0].text.length < 1_500, 'metadata-only response must stay bounded even with huge generated ASM');
  assert.equal(defaultResult.structuredContent, undefined);

  const slangResult = await client.callTool({
    name: 'x1pen_get_program',
    arguments: { fields: ['slang'] },
  });
  assert.equal(jsonContent(slangResult).slang, currentProgram.slang);

  const omittedResult = await client.callTool({
    name: 'x1pen_get_program',
    arguments: { fields: ['asm'] },
  });
  const omitted = jsonContent(omittedResult);
  assert.equal(omitted.asm, undefined);
  assert.equal(omitted.omittedFields[0].field, 'asm');

  const generatedResult = await client.callTool({
    name: 'x1pen_get_program',
    arguments: { fields: ['asm'], includeGeneratedAsm: true },
  });
  assert.equal(generatedResult.isError, true);
  assert.equal(jsonContent(generatedResult).error.code, 'SOURCE_LIMIT_EXCEEDED');

  const deliberateResult = await client.callTool({
    name: 'x1pen_get_program',
    arguments: { fields: ['asm'], includeGeneratedAsm: true, maxCharacters: 512 * 1024 },
  });
  assert.equal(jsonContent(deliberateResult).asm, generatedAsm);
});

test('get_source returns a bounded line range and protects generated ASM', async () => {
  currentProgram.basic = Array.from({ length: 20 }, (_, index) => `${(index + 1) * 10} PRINT ${index + 1}`).join('\n');
  const result = await client.callTool({
    name: 'x1pen_get_source',
    arguments: { section: 'basic', startLine: 5, lineCount: 3 },
  });
  const range = jsonContent(result);
  assert.equal(range.startLine, 5);
  assert.equal(range.endLine, 7);
  assert.equal(range.totalLines, 20);
  assert.equal(range.text, '50 PRINT 5\n60 PRINT 6\n70 PRINT 7');
  assert.equal(range.nextStartLine, 8);
  assert.equal(range.truncated, true);
  assert.equal(range.guardedWritesReloadSafe, true);
  assert.equal(range.writeGuard, 'revision-epoch');

  currentProgram = {
    sourceMode: 'slang', basic: '', asm: 'generated', slang: 'main() BEGIN\nEND;', revision: 4,
    revisionEpoch: 'epoch-a', instanceId: 'tab-a',
  };
  const protectedResult = await client.callTool({
    name: 'x1pen_get_source',
    arguments: { section: 'asm' },
  });
  assert.equal(protectedResult.isError, true);
  assert.equal(jsonContent(protectedResult).error.code, 'GENERATED_SOURCE_REQUIRES_OPT_IN');

  currentProgram = {
    sourceMode: 'basic+asm', basic: '10 END', asm: '', slang: '', revision: 5,
    revisionEpoch: 'epoch-a', instanceId: 'tab-a',
  };
  const invalidRange = await client.callTool({
    name: 'x1pen_get_source',
    arguments: { section: 'basic', startLine: 2 },
  });
  const rangeError = jsonContent(invalidRange).error;
  assert.equal(rangeError.code, 'SOURCE_RANGE_INVALID');
  assert.equal(rangeError.section, 'basic');
  assert.equal(rangeError.startLine, 2);
  assert.equal(rangeError.lineCount, 1);
});

test('search_source finds literal text with bounded context', async () => {
  currentProgram.slang = [
    'main() BEGIN',
    '  drawPlayer(); drawPlayer();',
    'END;',
    '',
    'drawPlayer() BEGIN',
    '  PRINT("PLAYER");',
    'END;',
  ].join('\n');
  currentProgram.sourceMode = 'slang';
  currentProgram.basic = '';

  const result = await client.callTool({
    name: 'x1pen_search_source',
    arguments: { section: 'slang', query: 'drawplayer', contextLines: 1, maxResults: 1 },
  });
  const search = jsonContent(result);
  assert.equal(search.totalMatches, 3);
  assert.equal(search.matches.length, 1);
  assert.equal(search.matches[0].line, 2);
  assert.equal(search.truncated, true);
  assert.equal(search.guardedWritesReloadSafe, true);
  assert.equal(search.writeGuard, 'revision-epoch');
  assert.deepEqual(search.matches[0].context.map((line) => line.line), [1, 2, 3]);
});

test('bounded source reads distinguish absent content from a present empty source', async () => {
  configureCompatibility({ connectorSourceSync: true, x1penSourceSync: false });
  currentProgram.basic = '';
  const empty = jsonContent(await client.callTool({
    name: 'x1pen_get_source',
    arguments: { section: 'basic' },
  }));
  assert.equal(empty.text, '');
  assert.equal(empty.totalLines, 0);
  assert.equal(empty.writeGuard, 'revision-only');

  delete currentProgram.basic;
  for (const request of [
    { name: 'x1pen_get_source', arguments: { section: 'basic' } },
    { name: 'x1pen_search_source', arguments: { section: 'basic', query: 'PRINT' } },
  ]) {
    const result = await client.callTool(request);
    const error = jsonContent(result).error;
    assert.equal(result.isError, true);
    assert.equal(error.code, 'SOURCE_CONTENT_UNAVAILABLE');
    assert.equal(error.component, 'x1pen');
    assert.equal(error.section, 'basic');
  }
});

test('diff_source compares a cached baseline with bounded hunks', async () => {
  const baseline = jsonContent(await client.callTool({ name: 'x1pen_get_program', arguments: {} }));
  const baseHash = baseline.sections.basic.contentHash;
  currentProgram.basic = '10 PRINT "MCP"\n15 PRINT "USER"\n20 END';
  currentProgram.revision++;

  const result = jsonContent(await client.callTool({
    name: 'x1pen_diff_source',
    arguments: {
      section: 'basic', baseHash, baseSourceMode: 'basic+asm',
      baseRevisionEpoch: 'epoch-a', contextLines: 1,
    },
  }));
  assert.equal(result.baseSourceOrigin, 'cache');
  assert.equal(result.epochChanged, false);
  assert.equal(result.addedLines, 1);
  assert.equal(result.deletedLines, 0);
  assert.match(result.diff, /\+15 PRINT "USER"/);
  assert.equal(result.truncated, false);
});

test('diff_source resolves a cached baseline from an older epoch by full provenance', async () => {
  const baseline = jsonContent(await client.callTool({ name: 'x1pen_get_program', arguments: {} }));
  currentProgram = {
    ...currentProgram,
    basic: '10 PRINT "AFTER RELOAD"\n20 END',
    revision: 3,
    revisionEpoch: 'epoch-b',
  };
  const result = jsonContent(await client.callTool({
    name: 'x1pen_diff_source',
    arguments: {
      section: 'basic', baseHash: baseline.sections.basic.contentHash,
      baseSourceMode: 'basic+asm', baseRevisionEpoch: 'epoch-a',
    },
  }));
  assert.equal(result.baseSourceOrigin, 'cache');
  assert.equal(result.epochChanged, true);
  assert.equal(result.baseRevisionEpoch, 'epoch-a');
  assert.equal(result.currentRevisionEpoch, 'epoch-b');
  assert.match(result.diff, /AFTER RELOAD/);
});

test('diff_source labels caller-attested and cross-epoch baselines', async () => {
  const baseSource = initialProgram.basic;
  const baseline = jsonContent(await client.callTool({ name: 'x1pen_get_program', arguments: {} }));
  currentProgram = {
    ...currentProgram,
    basic: '10 PRINT "RELOADED"\n20 END',
    revision: 3,
    revisionEpoch: 'epoch-b',
  };
  const result = jsonContent(await client.callTool({
    name: 'x1pen_diff_source',
    arguments: {
      section: 'basic', baseHash: baseline.sections.basic.contentHash,
      baseSourceMode: 'basic+asm', baseRevisionEpoch: 'epoch-a', baseSource,
    },
  }));
  assert.equal(result.baseSourceOrigin, 'caller-supplied');
  assert.match(result.baseSourceAttestation, /self-consistency only/);
  assert.equal(result.epochChanged, true);
  assert.equal(result.currentRevisionEpoch, 'epoch-b');
});

test('diff_source reports unavailable and mode-mismatched baselines', async () => {
  const missing = await client.callTool({
    name: 'x1pen_diff_source',
    arguments: {
      section: 'basic', baseHash: `sha256-utf8-v1:${'0'.repeat(64)}`,
      baseSourceMode: 'basic+asm', baseRevisionEpoch: 'missing',
    },
  });
  assert.equal(jsonContent(missing).error.code, 'BASE_SNAPSHOT_UNAVAILABLE');

  currentProgram.sourceMode = 'slang';
  currentProgram.basic = '';
  currentProgram.slang = 'main() BEGIN\nEND;';
  const mismatch = await client.callTool({
    name: 'x1pen_diff_source',
    arguments: {
      section: 'basic', baseHash: `sha256-utf8-v1:${'0'.repeat(64)}`,
      baseSourceMode: 'basic+asm', baseRevisionEpoch: 'epoch-a',
    },
  });
  assert.equal(jsonContent(mismatch).error.code, 'BASE_MODE_MISMATCH');
});

test('set_program forwards the guarded epoch and revision but returns only a compact summary', async () => {
  const result = await client.callTool({
    name: 'x1pen_set_program',
    arguments: {
      sourceMode: 'basic+asm', basic: '10 PRINT "UPDATED"',
      expectedRevision: 3, expectedRevisionEpoch: 'epoch-a',
    },
  });
  const response = jsonContent(result);
  assert.equal(result.isError, undefined);
  assert.equal(calls.at(-1).method, 'setProgram');
  assert.equal(calls.at(-1).params.expectedRevision, 3);
  assert.equal(calls.at(-1).params.expectedRevisionEpoch, 'epoch-a');
  assert.equal(calls.at(-1).params.program.basic, '10 PRINT "UPDATED"');
  assert.equal(response.revision, 4);
  assert.equal(response.guardedWritesReloadSafe, true);
  assert.equal(response.writeGuard, 'revision-epoch');
  assert.equal(response.basic, undefined);
  assert.equal(response.sections.basic.lineCount, 1);
});

test('source-sync capability requires all three advertised components', () => {
  for (const mcpSourceSync of [false, true]) {
    for (const connectorSourceSync of [false, true]) {
      for (const x1penSourceSync of [false, true]) {
        configureCompatibility({ connectorSourceSync, x1penSourceSync });
        compatibilityComponents.mcp = {
          ...compatibilityComponents.mcp,
          features: FULL_FEATURES.filter((feature) => mcpSourceSync || feature !== 'automation.source-sync'),
        };
        const capability = evaluateCompatibility({ ...compatibilityComponents, connected: true })['automation.source-sync'];
        assert.equal(
          capability.available,
          mcpSourceSync && connectorSourceSync && x1penSourceSync,
          `mcp=${mcpSourceSync} connector=${connectorSourceSync} x1pen=${x1penSourceSync}`,
        );
      }
    }
  }
});

test('old Connector with new MCP and X1Pen permits visibly degraded writes but not diff', async () => {
  configureCompatibility({ connectorSourceSync: false, x1penSourceSync: true });
  const read = jsonContent(await client.callTool({
    name: 'x1pen_get_program', arguments: { fields: ['basic'] },
  }));
  assert.equal(typeof read.revisionEpoch, 'string');
  assert.equal(read.guardedWritesReloadSafe, false);
  assert.equal(read.writeGuard, 'revision-only');

  const range = jsonContent(await client.callTool({
    name: 'x1pen_get_source', arguments: { section: 'basic', startLine: 1, lineCount: 1 },
  }));
  const search = jsonContent(await client.callTool({
    name: 'x1pen_search_source', arguments: { section: 'basic', query: 'PRINT' },
  }));
  for (const summary of [range, search]) {
    assert.equal(summary.guardedWritesReloadSafe, false);
    assert.equal(summary.writeGuard, 'revision-only');
  }

  const set = jsonContent(await client.callTool({
    name: 'x1pen_set_program',
    arguments: {
      sourceMode: 'basic+asm', basic: '10 PRINT "DEGRADED"',
      expectedRevision: 3, expectedRevisionEpoch: 'epoch-a',
    },
  }));
  assert.equal(set.revision, 4);
  assert.equal(set.guardedWritesReloadSafe, false);
  assert.equal(set.writeGuard, 'revision-only');
  assert.equal(calls.at(-1).params.expectedRevisionEpoch, 'epoch-a');

  const diff = await client.callTool({
    name: 'x1pen_diff_source',
    arguments: {
      section: 'basic', baseHash: read.sections.basic.contentHash,
      baseSourceMode: 'basic+asm', baseRevisionEpoch: 'epoch-a',
    },
  });
  const error = jsonContent(diff).error;
  assert.equal(error.code, 'FEATURE_UNAVAILABLE');
  assert.equal(error.component, 'connector');
  assert.equal(error.feature, 'automation.source-sync');
  assert.equal(error.requiredVersion, '1.3.0');
  assert.match(error.action, /Connector 1\.3\.0 or later/);
});

test('unknown Connector capability degrades writes and blocks diff without inventing a version', async () => {
  configureCompatibility();
  compatibilityComponents.connector = normalizeConnectorPair({ extensionVersion: '1.2.0' });
  const read = jsonContent(await client.callTool({ name: 'x1pen_get_program', arguments: {} }));
  assert.equal(read.guardedWritesReloadSafe, false);
  const diff = await client.callTool({
    name: 'x1pen_diff_source',
    arguments: {
      section: 'basic', baseHash: read.sections.basic.contentHash,
      baseSourceMode: 'basic+asm', baseRevisionEpoch: 'epoch-a',
    },
  });
  const error = jsonContent(diff).error;
  assert.equal(error.code, 'FEATURE_STATUS_UNKNOWN');
  assert.equal(error.component, 'connector');
  assert.equal(error.currentVersion, '1.2.0');
  assert.equal(error.requiredVersion, undefined);
});

test('source writes pin the initially selected session across pre-read and dispatch', async () => {
  beforeGetProgram = (count) => {
    if (count === 1) selectedSessionId = 'tab-b';
  };
  const result = await client.callTool({
    name: 'x1pen_set_program',
    arguments: {
      sourceMode: 'basic+asm', basic: '10 PRINT "PINNED"',
      expectedRevision: 3, expectedRevisionEpoch: 'epoch-a',
    },
  });
  assert.equal(result.isError, undefined);
  assert.equal(selectedSessionId, 'tab-b');
  assert.ok(calls.length >= 2);
  assert.ok(calls.every((call) => call.sessionId === 'tab-a'));
});

test('full source-sync requires epoch while old X1Pen degrades to numeric revision', async () => {
  const missing = await client.callTool({
    name: 'x1pen_set_program',
    arguments: { sourceMode: 'basic+asm', basic: '10 END', expectedRevision: 3 },
  });
  assert.equal(jsonContent(missing).error.code, 'REVISION_EPOCH_REQUIRED');
  assert.equal(currentProgram.revision, 3);

  configureCompatibility({ connectorSourceSync: true, x1penSourceSync: false });
  delete currentProgram.revisionEpoch;
  const degraded = jsonContent(await client.callTool({
    name: 'x1pen_set_program',
    arguments: { sourceMode: 'basic+asm', basic: '10 PRINT "OLD PAGE"', expectedRevision: 3 },
  }));
  assert.equal(degraded.revision, 4);
  assert.equal(degraded.guardedWritesReloadSafe, false);
  assert.equal(degraded.writeGuard, 'revision-only');
});

test('full source-sync with an epoch-less snapshot returns a distinct no-mutation diagnostic', async () => {
  delete currentProgram.revisionEpoch;
  const read = jsonContent(await client.callTool({
    name: 'x1pen_get_program', arguments: {},
  }));
  assert.equal(read.guardedWritesReloadSafe, false);
  assert.equal(read.writeGuard, 'revision-only');

  calls.length = 0;
  const result = await client.callTool({
    name: 'x1pen_set_program',
    arguments: { sourceMode: 'basic+asm', basic: '10 END', expectedRevision: 3 },
  });
  const error = jsonContent(result).error;
  assert.equal(result.isError, true);
  assert.equal(error.code, 'REVISION_EPOCH_UNAVAILABLE');
  assert.match(error.action, /Update or reload X1Pen/);
  assert.equal(error.current.writeGuard, 'revision-only');
  assert.equal(calls.some((call) => call.method === 'setProgram'), false);
  assert.equal(currentProgram.revision, 3);
});

test('degraded set_program performs best-effort epoch and revision conflict enrichment', async () => {
  configureCompatibility({ connectorSourceSync: false, x1penSourceSync: true });
  const epochConflict = await client.callTool({
    name: 'x1pen_set_program',
    arguments: {
      sourceMode: 'basic+asm', basic: '10 END', expectedRevision: 3,
      expectedRevisionEpoch: 'epoch-before-reload',
    },
  });
  let error = jsonContent(epochConflict).error;
  assert.equal(error.code, 'REVISION_EPOCH_MISMATCH');
  assert.match(error.message, /does not match the current program epoch/);
  assert.doesNotMatch(error.message, /reloaded/);
  assert.equal(error.current.guardedWritesReloadSafe, false);
  assert.equal(calls.some((call) => call.method === 'setProgram'), false);

  calls.length = 0;
  const revisionConflict = await client.callTool({
    name: 'x1pen_set_program',
    arguments: { sourceMode: 'basic+asm', basic: '10 END', expectedRevision: 2 },
  });
  error = jsonContent(revisionConflict).error;
  assert.equal(error.code, 'REVISION_MISMATCH');
  assert.equal(error.observedRevision, 3);
  assert.equal(error.current.writeGuard, 'revision-only');
  assert.match(error.action, /bounded current source reads/);
  assert.doesNotMatch(error.action, /diff_source/);
});

test('set_program maps the exact legacy conflict message to bounded structured output', async () => {
  currentProgram.revision = 2;
  compatibilityFailure = {
    method: 'setProgram',
    error: new Error('Revision conflict: expected 2, current 3'),
    beforeThrow() { currentProgram.revision = 3; },
  };
  const result = await client.callTool({
    name: 'x1pen_set_program',
    arguments: {
      sourceMode: 'basic+asm', basic: '10 END',
      expectedRevision: 2, expectedRevisionEpoch: 'epoch-a',
    },
  });
  const error = jsonContent(result).error;
  assert.equal(error.code, 'REVISION_MISMATCH');
  assert.equal(error.expectedRevision, 2);
  assert.equal(error.conflictRevision, 3);
  assert.equal(error.metadataAvailable, false);
  assert.equal(error.observedMetadataAvailable, true);
  assert.equal(error.observedRevisionEpoch, 'epoch-a');
  assert.equal(error.current.basic, undefined);
});

test('apply_edits updates one section and preserves the other authoring source', async () => {
  currentProgram.asm = 'ORG $100\nRET';
  const result = await client.callTool({
    name: 'x1pen_apply_edits',
    arguments: {
      section: 'basic',
      expectedRevision: 3,
      expectedRevisionEpoch: 'epoch-a',
      edits: [
        { startLine: 1, deleteLineCount: 1, text: '10 PRINT "START"' },
        { startLine: 2, deleteLineCount: 1, text: '20 PRINT "EDITED"\n30 END' },
      ],
    },
  });
  const response = jsonContent(result);
  assert.equal(response.changed, true);
  assert.equal(response.revision, 4);
  assert.equal(response.basic, undefined);
  assert.equal(currentProgram.basic, '10 PRINT "START"\n20 PRINT "EDITED"\n30 END');
  assert.equal(currentProgram.asm, 'ORG $100\nRET');
  assert.equal(calls.at(-1).params.program.asm, 'ORG $100\nRET');
  assert.deepEqual(response.changes, [
    { startLine: 1, oldLineCount: 1, newLineCount: 1 },
    { startLine: 2, oldLineCount: 1, newLineCount: 2 },
  ]);
});

test('apply_edits handles boundaries and returns early for identical content', async () => {
  currentProgram.basic = '10 PRINT "MCP"\n20 END';
  const unchanged = jsonContent(await client.callTool({
    name: 'x1pen_apply_edits',
    arguments: {
      section: 'basic', expectedRevision: 3, expectedRevisionEpoch: 'epoch-a',
      edits: [{ startLine: 1, deleteLineCount: 1, text: '10 PRINT "MCP"' }],
    },
  }));
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.revision, 3);
  assert.equal(unchanged.guardedWritesReloadSafe, true);
  assert.equal(calls.some((call) => call.method === 'setProgram'), false);

  calls.length = 0;
  const boundary = jsonContent(await client.callTool({
    name: 'x1pen_apply_edits',
    arguments: {
      section: 'basic', expectedRevision: 3, expectedRevisionEpoch: 'epoch-a',
      edits: [
        { startLine: 1, deleteLineCount: 0, text: '5 REM START' },
        { startLine: 3, deleteLineCount: 0, text: '30 REM EOF' },
      ],
    },
  }));
  assert.equal(boundary.changed, true);
  assert.equal(currentProgram.basic, '5 REM START\n10 PRINT "MCP"\n20 END\n30 REM EOF');
  assert.deepEqual(boundary.changes, [
    { startLine: 1, oldLineCount: 0, newLineCount: 1 },
    { startLine: 3, oldLineCount: 0, newLineCount: 1 },
  ]);
});

test('degraded apply_edits succeeds visibly and rejects a colliding reload on its final pre-read', async () => {
  configureCompatibility({ connectorSourceSync: false, x1penSourceSync: true });
  const degraded = jsonContent(await client.callTool({
    name: 'x1pen_apply_edits',
    arguments: {
      section: 'basic', expectedRevision: 3, expectedRevisionEpoch: 'epoch-a',
      edits: [{ startLine: 2, deleteLineCount: 1, text: '20 PRINT "DEGRADED"' }],
    },
  }));
  assert.equal(degraded.changed, true);
  assert.equal(degraded.guardedWritesReloadSafe, false);
  assert.equal(degraded.writeGuard, 'revision-only');

  currentProgram = clone(initialProgram);
  calls.length = 0;
  getProgramCount = 0;
  beforeGetProgram = (count) => {
    if (count === 2) {
      currentProgram.revisionEpoch = 'epoch-after-reload';
      currentProgram.basic = '10 PRINT "RELOADED"\n20 END';
    }
  };
  const conflict = await client.callTool({
    name: 'x1pen_apply_edits',
    arguments: {
      section: 'basic', expectedRevision: 3, expectedRevisionEpoch: 'epoch-a',
      edits: [{ startLine: 1, deleteLineCount: 1, text: '10 PRINT "STALE"' }],
    },
  });
  const error = jsonContent(conflict).error;
  assert.equal(error.code, 'REVISION_EPOCH_MISMATCH');
  assert.equal(error.current.guardedWritesReloadSafe, false);
  assert.equal(calls.some((call) => call.method === 'setProgram'), false);
  assert.equal(currentProgram.basic, '10 PRINT "RELOADED"\n20 END');
});

test('apply_edits rejects stale revisions and overlapping edits', async () => {
  const stale = await client.callTool({
    name: 'x1pen_apply_edits',
    arguments: {
      section: 'basic', expectedRevision: 2, expectedRevisionEpoch: 'epoch-a',
      edits: [{ startLine: 1, deleteLineCount: 1, text: '10 END' }],
    },
  });
  assert.equal(stale.isError, true);
  assert.equal(jsonContent(stale).error.code, 'REVISION_MISMATCH');
  assert.equal(jsonContent(stale).error.expectedRevision, 2);
  assert.equal(jsonContent(stale).error.observedRevision, 3);
  assert.match(jsonContent(stale).error.current.authoringHash, /^sha256-authoring-v1:/);

  const overlapping = await client.callTool({
    name: 'x1pen_apply_edits',
    arguments: {
      section: 'basic',
      expectedRevision: 3,
      expectedRevisionEpoch: 'epoch-a',
      edits: [
        { startLine: 1, deleteLineCount: 2, text: '10 END' },
        { startLine: 2, deleteLineCount: 1, text: '20 END' },
      ],
    },
  });
  assert.equal(overlapping.isError, true);
  const overlapError = jsonContent(overlapping).error;
  assert.equal(overlapError.code, 'EDITS_OVERLAP');
  assert.equal(overlapError.component, 'mcp');
  assert.equal(overlapError.editIndex, 1);
  assert.equal(overlapError.otherEditIndex, 2);
  assert.match(overlapError.action, /non-overlapping/);
});

test('apply_edits returns structured domain validation errors', async () => {
  let result = await client.callTool({
    name: 'x1pen_apply_edits',
    arguments: {
      section: 'basic', expectedRevision: 3, expectedRevisionEpoch: 'epoch-a',
      edits: [{ startLine: 4, deleteLineCount: 0, text: '40 END' }],
    },
  });
  let error = jsonContent(result).error;
  assert.equal(error.code, 'EDIT_RANGE_INVALID');
  assert.equal(error.editIndex, 1);
  assert.equal(error.lineCount, 2);

  currentProgram = {
    sourceMode: 'slang', basic: '', asm: 'generated', slang: 'MAIN() BEGIN\nEND;', revision: 3,
    revisionEpoch: 'epoch-a', instanceId: 'tab-a',
  };
  result = await client.callTool({
    name: 'x1pen_apply_edits',
    arguments: {
      section: 'asm', expectedRevision: 3, expectedRevisionEpoch: 'epoch-a',
      edits: [{ startLine: 1, deleteLineCount: 1, text: 'RET' }],
    },
  });
  error = jsonContent(result).error;
  assert.equal(error.code, 'SOURCE_SECTION_NOT_EDITABLE');
  assert.equal(error.section, 'asm');

  result = await client.callTool({
    name: 'x1pen_apply_edits',
    arguments: {
      section: 'slang', expectedRevision: 3, expectedRevisionEpoch: 'epoch-a',
      edits: [
        { startLine: 1, deleteLineCount: 0, text: 'A'.repeat(300_000) },
        { startLine: 2, deleteLineCount: 0, text: 'B'.repeat(300_000) },
      ],
    },
  });
  error = jsonContent(result).error;
  assert.equal(error.code, 'SOURCE_LIMIT_EXCEEDED');
  assert.equal(error.limit, 512 * 1024);
  assert.equal(error.actual, 600_000);

  currentProgram = {
    sourceMode: 'basic+asm', basic: 'A'.repeat(400_000), asm: '', slang: '', revision: 3,
    revisionEpoch: 'epoch-a', instanceId: 'tab-a',
  };
  result = await client.callTool({
    name: 'x1pen_apply_edits',
    arguments: {
      section: 'basic', expectedRevision: 3, expectedRevisionEpoch: 'epoch-a',
      edits: [{ startLine: 1, deleteLineCount: 0, text: 'B'.repeat(200_000) }],
    },
  });
  error = jsonContent(result).error;
  assert.equal(error.code, 'SOURCE_LIMIT_EXCEEDED');
  assert.equal(error.section, 'basic');
  assert.equal(error.limit, 512 * 1024);
  assert.equal(error.actual, 600_001);
});

test('apply_edits rejects a colliding revision from another epoch', async () => {
  const before = currentProgram.basic;
  const result = await client.callTool({
    name: 'x1pen_apply_edits',
    arguments: {
      section: 'basic', expectedRevision: 3, expectedRevisionEpoch: 'epoch-before-reload',
      edits: [{ startLine: 1, deleteLineCount: 1, text: '10 PRINT "STALE"' }],
    },
  });
  const error = jsonContent(result).error;
  assert.equal(error.code, 'REVISION_EPOCH_MISMATCH');
  assert.equal(error.expectedRevisionEpoch, 'epoch-before-reload');
  assert.equal(error.observedRevisionEpoch, 'epoch-a');
  assert.equal(currentProgram.basic, before);
});

test('apply_edits clears generated ASM when editing SLANG', async () => {
  configureCompatibility({ connectorSourceSync: false, x1penSourceSync: true });
  currentProgram = {
    sourceMode: 'slang', basic: '', asm: 'generated asm', slang: 'main() BEGIN\nEND;', revision: 9,
    revisionEpoch: 'epoch-a', instanceId: 'tab-a',
  };
  const result = await client.callTool({
    name: 'x1pen_apply_edits',
    arguments: {
      section: 'slang', expectedRevision: 9, expectedRevisionEpoch: 'epoch-a',
      edits: [{ startLine: 2, deleteLineCount: 0, text: '  PRINT("MCP");' }],
    },
  });
  const response = jsonContent(result);
  assert.equal(response.generatedAsmCleared, true);
  assert.equal(response.guardedWritesReloadSafe, false);
  assert.equal(response.sections.asm.characterCount, 0);
  assert.equal(currentProgram.asm, '');
  assert.equal(currentProgram.slang, 'main() BEGIN\n  PRINT("MCP");\nEND;');
});

test('capture_screen returns an MCP PNG image', async () => {
  const result = await client.callTool({ name: 'x1pen_capture_screen', arguments: {} });
  const image = result.content.find((item) => item.type === 'image');
  assert.equal(image.mimeType, 'image/png');
  assert.equal(Buffer.from(image.data, 'base64').toString(), 'png');
});

test('debugger tools route controls and return named state', async () => {
  const state = jsonContent(await client.callTool({ name: 'x1pen_debug_get_state', arguments: {} }));
  assert.equal(state.runState, 'paused');
  assert.equal(state.registers.pc, 0x0100);

  const breakpoints = jsonContent(await client.callTool({
    name: 'x1pen_debug_set_breakpoints',
    arguments: { addresses: [0x0100, 0x0100, 0x0120] },
  }));
  assert.equal(breakpoints.breakpointCount, 2);
  assert.deepEqual(calls.at(-1).params.addresses, [0x0100, 0x0100, 0x0120]);

  const resumed = jsonContent(await client.callTool({ name: 'x1pen_debug_resume', arguments: {} }));
  assert.equal(resumed.runState, 'running');
  const paused = jsonContent(await client.callTool({ name: 'x1pen_debug_pause', arguments: {} }));
  assert.equal(paused.stopReason, 'manual');

  const stepped = jsonContent(await client.callTool({
    name: 'x1pen_debug_step',
    arguments: { count: 3 },
  }));
  assert.equal(stepped.stepsExecuted, 3);
  assert.equal(stepped.registers.pc, 0x0103);
  assert.deepEqual(calls.at(-1).params, { count: 3 });

  await client.callTool({
    name: 'x1pen_debug_wait_for_pause',
    arguments: { afterSequence: resumed.sequence, stopReason: 'step', address: 0x0103, timeoutMs: 250 },
  });
  assert.deepEqual(calls.at(-1).params, {
    afterSequence: resumed.sequence,
    stopReason: 'step',
    address: 0x0103,
    timeoutMs: 250,
  });
});

test('debugger memory reads are bounded and compact', async () => {
  const result = await client.callTool({
    name: 'x1pen_debug_read_memory',
    arguments: { address: 0x01AB, length: 4 },
  });
  const memory = jsonContent(result);
  assert.deepEqual(memory, { address: 0x01AB, endAddress: 0x01AE, length: 4, hex: 'ABACADAE' });
  assert.equal(memory.bytes, undefined);

  const invalid = await client.callTool({
    name: 'x1pen_debug_read_memory',
    arguments: { address: 0xFFFF, length: 2 },
  });
  assert.equal(invalid.isError, true);
  assert.match(invalid.content[0].text, /64KB address space/);
});

test('debugger VRAM tools validate regions and return compact responses', async () => {
  const video = jsonContent(await client.callTool({
    name: 'x1pen_debug_get_video_state', arguments: {},
  }));
  assert.equal(video.model, 'x1');
  assert.equal(calls.at(-1).method, 'debuggerGetVideoState');

  const read = jsonContent(await client.callTool({
    name: 'x1pen_debug_read_vram',
    arguments: { region: 'graphics', bank: 'access', plane: 'blue', offset: 0, length: 4 },
  }));
  assert.deepEqual(read, {
    region: 'graphics', bankSelector: 'access', bank: 0, plane: 'blue',
    offset: 0, endOffset: 3, length: 4, hex: 'ABACADAE',
  });
  assert.equal(read.bytes, undefined);

  const written = jsonContent(await client.callTool({
    name: 'x1pen_debug_write_vram',
    arguments: { region: 'attribute', offset: 2, hex: '0aFF' },
  }));
  assert.deepEqual(calls.at(-1).params.bytes, [0x0A, 0xFF]);
  assert.deepEqual(written, {
    region: 'attribute', offset: 2, endOffset: 3, bytesWritten: 2, redrawPending: true,
  });

  const unchanged = jsonContent(await client.callTool({
    name: 'x1pen_debug_write_vram',
    arguments: { region: 'attribute', offset: 3, hex: '00' },
  }));
  assert.equal(unchanged.redrawPending, false);

  const missingPlane = await client.callTool({
    name: 'x1pen_debug_read_vram',
    arguments: { region: 'graphics', bank: 0, offset: 0, length: 1 },
  });
  assert.equal(missingPlane.isError, true);
  assert.match(missingPlane.content[0].text, /requires plane/);

  const oversizedText = await client.callTool({
    name: 'x1pen_debug_read_vram',
    arguments: { region: 'text', offset: 0x07FF, length: 2 },
  });
  assert.equal(oversizedText.isError, true);
  assert.match(oversizedText.content[0].text, /2048 bytes/);
});
