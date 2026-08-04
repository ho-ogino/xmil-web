#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod/v4';
import { X1PenSession } from './x1pen-session.mjs';

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
      return await handler(args);
    } catch (error) {
      return toolError(error);
    }
  };
}

export function createX1PenMcpServer(options = {}) {
  const session = options.session || new X1PenSession(options.sessionOptions);
  const server = new McpServer({ name: 'x1pen', version: '1.0.0' });

  server.registerTool('x1pen_get_program', {
    description: 'Get the BASIC, Z80 assembly, and SLANG source currently loaded in X1Pen.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async () => textResult(await session.getProgram())));

  server.registerTool('x1pen_set_program', {
    description: 'Replace the complete X1Pen program. Sources not used by sourceMode are cleared.',
    inputSchema: {
      sourceMode: z.enum(['basic+asm', 'asm', 'slang']),
      basic: z.string().max(MAX_SOURCE_LENGTH).optional(),
      asm: z.string().max(MAX_SOURCE_LENGTH).optional(),
      slang: z.string().max(MAX_SOURCE_LENGTH).optional(),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, handleTool(async (program) => textResult(await session.setProgram(program))));

  server.registerTool('x1pen_validate', {
    description: 'Compile or tokenize the current program without resetting or running the emulator.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async () => textResult(await session.validate())));

  server.registerTool('x1pen_run', {
    description: 'Build and run the current X1Pen program, then wait briefly before returning status.',
    inputSchema: {
      waitMs: z.number().int().min(0).max(10_000).default(500),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, handleTool(async ({ waitMs }) => textResult(await session.run(waitMs))));

  server.registerTool('x1pen_stop', {
    description: 'Send ESC to stop the current X1Pen program.',
    annotations: { destructiveHint: true, openWorldHint: false },
  }, handleTool(async () => textResult(await session.stop())));

  server.registerTool('x1pen_get_status', {
    description: 'Get X1Pen initialization, busy, and status-message state.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async () => textResult(await session.getStatus())));

  server.registerTool('x1pen_capture_screen', {
    description: 'Capture the current 640x400 X1 emulator canvas as a PNG image.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async () => {
    const png = await session.captureScreen();
    return {
      content: [
        { type: 'text', text: 'Current X1Pen emulator screen (640x400 PNG).' },
        { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
      ],
    };
  }));

  return { server, session };
}

async function main() {
  const { server, session } = createX1PenMcpServer();
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await session.close();
    await server.close();
  };
  process.once('SIGINT', () => close().finally(() => process.exit(0)));
  process.once('SIGTERM', () => close().finally(() => process.exit(0)));
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[x1pen-mcp] server ready on stdio');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error('[x1pen-mcp] fatal:', error);
    process.exit(1);
  });
}
