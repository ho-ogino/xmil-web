import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { after, before, test } from 'node:test';
import { createX1PenMcpServer } from '../mcp/x1pen-server.mjs';

const program = {
  sourceMode: 'basic+asm',
  basic: '10 PRINT "MCP"',
  asm: '',
  slang: '',
  revision: 3,
  instanceId: 'tab-a',
};
const calls = [];
const fakeBridge = {
  connectionInfo() { return { port: 43110, pairingCode: '123456', extensionConnected: true }; },
  listSessions() { return [{ sessionId: 'tab-a', title: 'X1Pen', selected: true }]; },
  selectSession(sessionId) { return { sessionId }; },
  async sendCommand(method, params, sessionId) {
    calls.push({ method, params, sessionId });
    if (method === 'getProgram' || method === 'setProgram') return program;
    if (method === 'validate') return { ok: true, diagnostics: [] };
    if (method === 'captureScreen') return `data:image/png;base64,${Buffer.from('png').toString('base64')}`;
    return { ok: true };
  },
  async close() {},
};

let server;
let client;

before(async () => {
  ({ server } = createX1PenMcpServer({ bridge: fakeBridge }));
  client = new Client({ name: 'x1pen-mcp-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

after(async () => {
  if (client) await client.close();
  if (server) await server.close();
});

test('server exposes browser connection and X1Pen tools', async () => {
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
    'x1pen_capture_screen',
    'x1pen_connection_info',
    'x1pen_get_program',
    'x1pen_get_status',
    'x1pen_list_sessions',
    'x1pen_run',
    'x1pen_select_session',
    'x1pen_set_program',
    'x1pen_stop',
    'x1pen_validate',
  ]);
});

test('set_program forwards expected revision and source to the selected tab', async () => {
  const result = await client.callTool({
    name: 'x1pen_set_program',
    arguments: { sourceMode: 'basic+asm', basic: program.basic, expectedRevision: 3 },
  });
  assert.equal(result.isError, undefined);
  assert.equal(calls.at(-1).method, 'setProgram');
  assert.equal(calls.at(-1).params.expectedRevision, 3);
  assert.equal(calls.at(-1).params.program.basic, program.basic);
});

test('capture_screen returns an MCP PNG image', async () => {
  const result = await client.callTool({ name: 'x1pen_capture_screen', arguments: {} });
  const image = result.content.find((item) => item.type === 'image');
  assert.equal(image.mimeType, 'image/png');
  assert.equal(Buffer.from(image.data, 'base64').toString(), 'png');
});
