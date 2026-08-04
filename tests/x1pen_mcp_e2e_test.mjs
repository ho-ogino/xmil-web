import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { after, before, test } from 'node:test';

let client;

before(async () => {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['mcp/x1pen-server.mjs'],
    cwd: process.cwd(),
    stderr: 'inherit',
  });
  client = new Client({ name: 'x1pen-mcp-e2e-test', version: '1.0.0' });
  await client.connect(transport);
});

after(async () => {
  if (client) await client.close();
});

test('stdio MCP server controls the real X1Pen browser session', { timeout: 60_000 }, async () => {
  const source = {
    sourceMode: 'basic+asm',
    basic: '10 PRINT "MCP E2E"',
    asm: '',
    slang: '',
  };
  const setResult = await client.callTool({ name: 'x1pen_set_program', arguments: source });
  assert.equal(setResult.isError, undefined);

  const validation = await client.callTool({ name: 'x1pen_validate', arguments: {} });
  assert.equal(validation.structuredContent.ok, true);

  const run = await client.callTool({ name: 'x1pen_run', arguments: { waitMs: 200 } });
  assert.equal(run.structuredContent.ok, true);

  const screen = await client.callTool({ name: 'x1pen_capture_screen', arguments: {} });
  const image = screen.content.find((item) => item.type === 'image');
  assert.equal(image.mimeType, 'image/png');
  const png = Buffer.from(image.data, 'base64');
  assert.ok(png.length > 1_000);
  assert.equal(png.readUInt32BE(16), 640);
  assert.equal(png.readUInt32BE(20), 400);
});
