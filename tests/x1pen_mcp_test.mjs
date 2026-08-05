import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { after, before, beforeEach, test } from 'node:test';
import { createX1PenMcpServer } from '../mcp/x1pen-server.mjs';

const initialProgram = {
  sourceMode: 'basic+asm',
  basic: '10 PRINT "MCP"\n20 END',
  asm: '',
  slang: '',
  revision: 3,
  instanceId: 'tab-a',
};
const calls = [];
let currentProgram;
let debuggerState;

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
  connectionInfo() { return { port: 43110, pairingCode: '123456', extensionConnected: true }; },
  listSessions() { return [{ sessionId: 'tab-a', title: 'X1Pen', selected: true }]; },
  selectSession(sessionId) { return { sessionId }; },
  async sendCommand(method, params, sessionId) {
    calls.push({ method, params: clone(params), sessionId });
    if (method === 'getProgram') return clone(currentProgram);
    if (method === 'setProgram') {
      if (params.expectedRevision !== currentProgram.revision) {
        throw new Error(`Revision conflict: expected ${params.expectedRevision}, current ${currentProgram.revision}`);
      }
      currentProgram = {
        ...normalizeProgram(params.program),
        revision: currentProgram.revision + 1,
        instanceId: currentProgram.instanceId,
      };
      return clone(currentProgram);
    }
    if (method === 'validate') return { ok: true, diagnostics: [] };
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
  ({ server } = createX1PenMcpServer({ bridge: fakeBridge }));
  client = new Client({ name: 'x1pen-mcp-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

beforeEach(() => {
  calls.length = 0;
  currentProgram = clone(initialProgram);
  debuggerState = clone(initialDebuggerState);
});

after(async () => {
  if (client) await client.close();
  if (server) await server.close();
});

test('server exposes context-efficient source tools', async () => {
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
    'x1pen_apply_edits',
    'x1pen_capture_screen',
    'x1pen_connection_info',
    'x1pen_debug_get_state',
    'x1pen_debug_pause',
    'x1pen_debug_read_memory',
    'x1pen_debug_resume',
    'x1pen_debug_set_breakpoints',
    'x1pen_debug_step',
    'x1pen_debug_wait_for_pause',
    'x1pen_get_language_profile',
    'x1pen_get_program',
    'x1pen_get_reference',
    'x1pen_get_source',
    'x1pen_get_status',
    'x1pen_list_sessions',
    'x1pen_run',
    'x1pen_search_reference',
    'x1pen_search_source',
    'x1pen_select_session',
    'x1pen_set_program',
    'x1pen_stop',
    'x1pen_validate',
  ]);
});

test('language reference tools search compact results and fetch selected details', async () => {
  const searchResult = await client.callTool({
    name: 'x1pen_search_reference',
    arguments: { language: 'slang', query: 'TILE_SET_SCROLL' },
  });
  const search = jsonContent(searchResult);
  assert.equal(search.totalMatches, 1);
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
});

test('language profile reports bundled data and connected X1Pen compatibility', async () => {
  const result = await client.callTool({ name: 'x1pen_get_language_profile', arguments: {} });
  const profile = jsonContent(result);
  assert.equal(profile.schemaVersion, 1);
  assert.equal(profile.profiles.length, 2);
  assert.equal(profile.active.id, 'x1pen-fuzzybasic-1.2L');
  assert.equal(profile.reportedProfiles.slang.id, 'x1pen-slang-c9e8f53-lsx');
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
    instanceId: 'tab-a',
  };

  const defaultResult = await client.callTool({ name: 'x1pen_get_program', arguments: {} });
  const selected = jsonContent(defaultResult);
  assert.equal(selected.slang, undefined);
  assert.equal(selected.asm, undefined);
  assert.deepEqual(selected.includedFields, []);
  assert.equal(selected.sections.asm.generated, true);
  assert.equal(selected.sections.asm.lineCount, 20_000);
  assert.ok(defaultResult.content[0].text.length < 500, 'metadata-only response must stay small even with huge generated ASM');
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
  assert.match(generatedResult.content[0].text, /exceeding maxCharacters/);

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

  currentProgram = {
    sourceMode: 'slang', basic: '', asm: 'generated', slang: 'main() BEGIN\nEND;', revision: 4, instanceId: 'tab-a',
  };
  const protectedResult = await client.callTool({
    name: 'x1pen_get_source',
    arguments: { section: 'asm' },
  });
  assert.equal(protectedResult.isError, true);
  assert.match(protectedResult.content[0].text, /generated from SLANG/);
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
  assert.deepEqual(search.matches[0].context.map((line) => line.line), [1, 2, 3]);
});

test('set_program forwards expected revision but returns only a compact summary', async () => {
  const result = await client.callTool({
    name: 'x1pen_set_program',
    arguments: { sourceMode: 'basic+asm', basic: '10 PRINT "UPDATED"', expectedRevision: 3 },
  });
  const response = jsonContent(result);
  assert.equal(result.isError, undefined);
  assert.equal(calls.at(-1).method, 'setProgram');
  assert.equal(calls.at(-1).params.expectedRevision, 3);
  assert.equal(calls.at(-1).params.program.basic, '10 PRINT "UPDATED"');
  assert.equal(response.revision, 4);
  assert.equal(response.basic, undefined);
  assert.equal(response.sections.basic.lineCount, 1);
});

test('apply_edits updates one section and preserves the other authoring source', async () => {
  currentProgram.asm = 'ORG $100\nRET';
  const result = await client.callTool({
    name: 'x1pen_apply_edits',
    arguments: {
      section: 'basic',
      expectedRevision: 3,
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

test('apply_edits rejects stale revisions and overlapping edits', async () => {
  const stale = await client.callTool({
    name: 'x1pen_apply_edits',
    arguments: {
      section: 'basic', expectedRevision: 2, edits: [{ startLine: 1, deleteLineCount: 1, text: '10 END' }],
    },
  });
  assert.equal(stale.isError, true);
  assert.match(stale.content[0].text, /Revision conflict/);

  const overlapping = await client.callTool({
    name: 'x1pen_apply_edits',
    arguments: {
      section: 'basic',
      expectedRevision: 3,
      edits: [
        { startLine: 1, deleteLineCount: 2, text: '10 END' },
        { startLine: 2, deleteLineCount: 1, text: '20 END' },
      ],
    },
  });
  assert.equal(overlapping.isError, true);
  assert.match(overlapping.content[0].text, /overlap/);
});

test('apply_edits clears generated ASM when editing SLANG', async () => {
  currentProgram = {
    sourceMode: 'slang', basic: '', asm: 'generated asm', slang: 'main() BEGIN\nEND;', revision: 9, instanceId: 'tab-a',
  };
  const result = await client.callTool({
    name: 'x1pen_apply_edits',
    arguments: {
      section: 'slang', expectedRevision: 9, edits: [{ startLine: 2, deleteLineCount: 0, text: '  PRINT("MCP");' }],
    },
  });
  const response = jsonContent(result);
  assert.equal(response.generatedAsmCleared, true);
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
    arguments: { address: 0x0100, length: 4 },
  });
  const memory = jsonContent(result);
  assert.deepEqual(memory, { address: 0x0100, endAddress: 0x0103, length: 4, hex: '00010203' });
  assert.equal(memory.bytes, undefined);

  const invalid = await client.callTool({
    name: 'x1pen_debug_read_memory',
    arguments: { address: 0xFFFF, length: 2 },
  });
  assert.equal(invalid.isError, true);
  assert.match(invalid.content[0].text, /64KB address space/);
});
