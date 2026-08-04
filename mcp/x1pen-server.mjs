#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod/v4';
import { X1PenBridge } from './x1pen-bridge.mjs';

const MAX_SOURCE_LENGTH = 512 * 1024;

function textResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function toolError(error) {
  return {
    isError: true,
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
  };
}

function handleTool(handler) {
  return async (args) => {
    try {
      return await handler(args || {});
    } catch (error) {
      return toolError(error);
    }
  };
}

export function createX1PenMcpServer(options = {}) {
  const bridge = options.bridge || new X1PenBridge(options.bridgeOptions);
  const server = new McpServer({ name: 'x1pen', version: '2.0.0' });
  const sessionInput = { sessionId: z.string().optional().describe('Connected X1Pen instance ID; omit when one tab is connected') };

  server.registerTool('x1pen_connection_info', {
    description: 'Get the local bridge port and pairing code used by the X1Pen Connector extension.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async () => textResult(bridge.connectionInfo())));

  server.registerTool('x1pen_list_sessions', {
    description: 'List X1Pen browser tabs explicitly connected through the extension.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async () => textResult({ sessions: bridge.listSessions() })));

  server.registerTool('x1pen_select_session', {
    description: 'Select the X1Pen browser tab used by later tool calls.',
    inputSchema: { sessionId: z.string().min(1) },
    annotations: { openWorldHint: false },
  }, handleTool(async ({ sessionId }) => textResult(bridge.selectSession(sessionId))));

  server.registerTool('x1pen_get_program', {
    description: 'Get source and revision from the connected X1Pen tab.',
    inputSchema: sessionInput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId }) => textResult(await bridge.sendCommand('getProgram', {}, sessionId))));

  server.registerTool('x1pen_set_program', {
    description: 'Replace the complete program when expectedRevision still matches the connected X1Pen tab.',
    inputSchema: {
      sessionId: sessionInput.sessionId,
      expectedRevision: z.number().int().min(0),
      sourceMode: z.enum(['basic+asm', 'asm', 'slang']),
      basic: z.string().max(MAX_SOURCE_LENGTH).optional(),
      asm: z.string().max(MAX_SOURCE_LENGTH).optional(),
      slang: z.string().max(MAX_SOURCE_LENGTH).optional(),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId, expectedRevision, ...program }) => textResult(await bridge.sendCommand(
    'setProgram', { program, expectedRevision }, sessionId,
  ))));

  server.registerTool('x1pen_validate', {
    description: 'Compile or tokenize the current program without running it.',
    inputSchema: sessionInput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId }) => textResult(await bridge.sendCommand('validate', {}, sessionId))));

  server.registerTool('x1pen_run', {
    description: 'Build and run the current program in the connected user-visible X1Pen tab.',
    inputSchema: {
      sessionId: sessionInput.sessionId,
      waitMs: z.number().int().min(0).max(10_000).default(500),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId, waitMs }) => textResult(await bridge.sendCommand('run', { waitMs }, sessionId))));

  server.registerTool('x1pen_stop', {
    description: 'Send ESC to stop the program in the connected X1Pen tab.',
    inputSchema: sessionInput,
    annotations: { destructiveHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId }) => textResult(await bridge.sendCommand('stop', {}, sessionId))));

  server.registerTool('x1pen_get_status', {
    description: 'Get readiness, revision, lock and status state from the connected X1Pen tab.',
    inputSchema: sessionInput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId }) => textResult(await bridge.sendCommand('getStatus', {}, sessionId))));

  server.registerTool('x1pen_capture_screen', {
    description: 'Capture the connected X1Pen emulator canvas as a 640x400 PNG.',
    inputSchema: sessionInput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId }) => {
    const dataUrl = await bridge.sendCommand('captureScreen', {}, sessionId);
    const comma = dataUrl.indexOf(',');
    if (!dataUrl.startsWith('data:image/png;base64,') || comma < 0) throw new Error('Invalid PNG data returned by X1Pen');
    return {
      content: [
        { type: 'text', text: 'Current user-visible X1Pen screen (640x400 PNG).' },
        { type: 'image', data: dataUrl.slice(comma + 1), mimeType: 'image/png' },
      ],
    };
  }));

  return { server, bridge };
}

async function main() {
  const { server, bridge } = createX1PenMcpServer();
  await bridge.start();
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await bridge.close();
    await server.close();
  };
  process.once('SIGINT', () => close().finally(() => process.exit(0)));
  process.once('SIGTERM', () => close().finally(() => process.exit(0)));
  await server.connect(new StdioServerTransport());
  console.error('[x1pen-mcp] server ready on stdio');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error('[x1pen-mcp] fatal:', error);
    process.exit(1);
  });
}
