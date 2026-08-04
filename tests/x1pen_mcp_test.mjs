import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { after, before, test } from 'node:test';
import { createX1PenMcpServer } from '../mcp/x1pen-server.mjs';

const program = { sourceMode: 'basic+asm', basic: '10 PRINT "MCP"', asm: '', slang: '' };
const fakeSession = {
  async getProgram() { return program; },
  async setProgram(value) { return value; },
  async validate() { return { ok: true, sourceMode: 'basic+asm', diagnostics: [], output: {} }; },
  async run(waitMs) { return { ok: true, waitMs }; },
  async stop() { return { ready: true, status: 'Stopped' }; },
  async getStatus() { return { ready: true, state: 'ready', busy: false, status: 'Ready' }; },
  async captureScreen() { return Buffer.from('png'); },
  async close() {},
};

let server;
let client;

before(async () => {
  ({ server } = createX1PenMcpServer({ session: fakeSession }));
  client = new Client({ name: 'x1pen-mcp-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

after(async () => {
  if (client) await client.close();
  if (server) await server.close();
});

test('server exposes the expected X1Pen tool surface', async () => {
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
    'x1pen_capture_screen',
    'x1pen_get_program',
    'x1pen_get_status',
    'x1pen_run',
    'x1pen_set_program',
    'x1pen_stop',
    'x1pen_validate',
  ]);
});

test('program and image results cross the MCP protocol', async () => {
  const setResult = await client.callTool({ name: 'x1pen_set_program', arguments: program });
  assert.equal(setResult.isError, undefined);
  assert.deepEqual(setResult.structuredContent, program);

  const imageResult = await client.callTool({ name: 'x1pen_capture_screen', arguments: {} });
  assert.equal(imageResult.content[1].type, 'image');
  assert.equal(imageResult.content[1].mimeType, 'image/png');
  assert.equal(Buffer.from(imageResult.content[1].data, 'base64').toString(), 'png');
});
