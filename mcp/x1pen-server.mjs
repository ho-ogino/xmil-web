#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod/v4';
import { X1PenBridge } from './x1pen-bridge.mjs';

const MAX_SOURCE_LENGTH = 512 * 1024;
const DEFAULT_RANGE_CHARACTERS = 32 * 1024;
const MAX_RANGE_CHARACTERS = 128 * 1024;
const SOURCE_SECTIONS = ['basic', 'asm', 'slang'];

function textResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
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

function normalizeProgramSnapshot(value) {
  if (!value || typeof value !== 'object') throw new Error('X1Pen returned an invalid program snapshot');
  const sourceMode = value.sourceMode;
  if (!['basic+asm', 'asm', 'slang'].includes(sourceMode)) {
    throw new Error(`X1Pen returned an invalid source mode: ${sourceMode}`);
  }
  if (!Number.isInteger(value.revision) || value.revision < 0) {
    throw new Error('X1Pen returned an invalid program revision');
  }
  const snapshot = {
    sourceMode,
    revision: value.revision,
    instanceId: typeof value.instanceId === 'string' ? value.instanceId : undefined,
  };
  for (const section of SOURCE_SECTIONS) {
    if (typeof value[section] !== 'string') throw new Error(`X1Pen returned invalid ${section} source`);
    snapshot[section] = value[section];
  }
  return snapshot;
}

function sourceLineCount(source) {
  return source.length === 0 ? 0 : source.split('\n').length;
}

function summarizeProgram(snapshot) {
  const sections = {};
  for (const section of SOURCE_SECTIONS) {
    sections[section] = {
      lineCount: sourceLineCount(snapshot[section]),
      characterCount: snapshot[section].length,
    };
  }
  sections.asm.generated = snapshot.sourceMode === 'slang' && snapshot.asm.length > 0;
  return {
    sourceMode: snapshot.sourceMode,
    revision: snapshot.revision,
    ...(snapshot.instanceId ? { instanceId: snapshot.instanceId } : {}),
    sections,
  };
}

function selectProgramFields(snapshot, fields, includeGeneratedAsm, maxCharacters) {
  const requested = [...new Set(fields || [])];
  const result = {
    ...summarizeProgram(snapshot),
    includedFields: [],
    omittedFields: [],
  };
  let selectedCharacters = 0;
  for (const section of requested) {
    const generatedAsm = section === 'asm' && snapshot.sourceMode === 'slang' && snapshot.asm.length > 0;
    if (generatedAsm && !includeGeneratedAsm) {
      result.omittedFields.push({ field: section, reason: 'generated ASM is excluded by default' });
      continue;
    }
    selectedCharacters += snapshot[section].length;
    if (selectedCharacters > maxCharacters) {
      throw new Error(`Selected sources contain ${selectedCharacters} characters, exceeding maxCharacters ${maxCharacters}. Use x1pen_get_source or raise maxCharacters explicitly.`);
    }
    result[section] = snapshot[section];
    result.includedFields.push(section);
  }
  return result;
}

function getReadableSection(snapshot, section, includeGeneratedAsm) {
  if (section === 'asm' && snapshot.sourceMode === 'slang' && snapshot.asm.length > 0 && !includeGeneratedAsm) {
    throw new Error('ASM is generated from SLANG. Set includeGeneratedAsm to true to read it.');
  }
  return snapshot[section];
}

function getSourceRange(snapshot, section, options) {
  const source = getReadableSection(snapshot, section, options.includeGeneratedAsm);
  const lines = source.length === 0 ? [] : source.split('\n');
  if (lines.length === 0) {
    return {
      section,
      revision: snapshot.revision,
      startLine: 1,
      endLine: 0,
      totalLines: 0,
      text: '',
      truncated: false,
    };
  }
  if (options.startLine > lines.length) {
    throw new Error(`startLine ${options.startLine} exceeds ${section} line count ${lines.length}`);
  }

  const requested = lines.slice(options.startLine - 1, options.startLine - 1 + options.lineCount);
  const selected = [];
  let characterCount = 0;
  let lineTruncated = false;
  for (const line of requested) {
    const separatorLength = selected.length > 0 ? 1 : 0;
    if (characterCount + separatorLength + line.length <= options.maxCharacters) {
      selected.push(line);
      characterCount += separatorLength + line.length;
      continue;
    }
    if (selected.length === 0) {
      selected.push(line.slice(0, options.maxCharacters));
      lineTruncated = true;
    }
    break;
  }
  const endLine = options.startLine + selected.length - 1;
  return {
    section,
    revision: snapshot.revision,
    startLine: options.startLine,
    endLine,
    totalLines: lines.length,
    text: selected.join('\n'),
    truncated: lineTruncated || endLine < lines.length,
    lineTruncated,
    nextStartLine: lineTruncated || endLine >= lines.length ? null : endLine + 1,
  };
}

function clipSearchLine(line, matchIndex, maxLength = 500) {
  if (line.length <= maxLength) return { text: line, columnOffset: 0, truncated: false };
  const start = Math.max(0, Math.min(matchIndex - Math.floor(maxLength / 3), line.length - maxLength));
  return {
    text: `${start > 0 ? '...' : ''}${line.slice(start, start + maxLength)}${start + maxLength < line.length ? '...' : ''}`,
    columnOffset: start,
    truncated: true,
  };
}

function searchSource(snapshot, section, options) {
  const source = getReadableSection(snapshot, section, options.includeGeneratedAsm);
  const lines = source.length === 0 ? [] : source.split('\n');
  const needle = options.caseSensitive ? options.query : options.query.toLowerCase();
  const matches = [];
  let totalMatches = 0;
  for (let index = 0; index < lines.length; index++) {
    const haystack = options.caseSensitive ? lines[index] : lines[index].toLowerCase();
    let searchFrom = 0;
    while (searchFrom <= haystack.length) {
      const columnIndex = haystack.indexOf(needle, searchFrom);
      if (columnIndex < 0) break;
      totalMatches++;
      if (matches.length < options.maxResults) {
        const contextStart = Math.max(0, index - options.contextLines);
        const contextEnd = Math.min(lines.length - 1, index + options.contextLines);
        const context = [];
        for (let contextIndex = contextStart; contextIndex <= contextEnd; contextIndex++) {
          const clipped = clipSearchLine(lines[contextIndex], contextIndex === index ? columnIndex : 0);
          context.push({ line: contextIndex + 1, text: clipped.text, truncated: clipped.truncated });
        }
        const matchLine = clipSearchLine(lines[index], columnIndex);
        matches.push({
          line: index + 1,
          column: columnIndex + 1,
          displayedColumn: columnIndex - matchLine.columnOffset + 1 + (matchLine.columnOffset > 0 ? 3 : 0),
          context,
        });
      }
      searchFrom = columnIndex + needle.length;
    }
  }
  return {
    section,
    revision: snapshot.revision,
    query: options.query,
    totalMatches,
    matches,
    truncated: totalMatches > matches.length,
  };
}

function applyLineEdits(source, edits) {
  const lines = source.length === 0 ? [] : source.split('\n');
  const normalized = edits.map((edit, index) => {
    const startIndex = edit.startLine - 1;
    if (startIndex > lines.length || (edit.deleteLineCount > 0 && startIndex === lines.length)) {
      throw new Error(`edit ${index + 1} starts beyond the source at line ${edit.startLine}`);
    }
    if (startIndex + edit.deleteLineCount > lines.length) {
      throw new Error(`edit ${index + 1} deletes beyond the end of the source`);
    }
    return {
      index,
      startIndex,
      endIndex: startIndex + edit.deleteLineCount,
      replacementLines: edit.text.length === 0 ? [] : edit.text.split('\n'),
      startLine: edit.startLine,
      deleteLineCount: edit.deleteLineCount,
    };
  });

  const ascending = [...normalized].sort((left, right) => left.startIndex - right.startIndex);
  for (let index = 1; index < ascending.length; index++) {
    const previous = ascending[index - 1];
    const current = ascending[index];
    if (current.startIndex === previous.startIndex || current.startIndex < previous.endIndex) {
      throw new Error(`edits ${previous.index + 1} and ${current.index + 1} overlap`);
    }
  }

  let outputLines = [];
  let cursor = 0;
  for (const edit of ascending) {
    outputLines = outputLines.concat(lines.slice(cursor, edit.startIndex), edit.replacementLines);
    cursor = edit.endIndex;
  }
  outputLines = outputLines.concat(lines.slice(cursor));
  return {
    source: outputLines.join('\n'),
    changes: normalized.map((edit) => ({
      startLine: edit.startLine,
      oldLineCount: edit.deleteLineCount,
      newLineCount: edit.replacementLines.length,
    })),
  };
}

function assertEditableSection(snapshot, section) {
  if (snapshot.sourceMode === 'slang' && section !== 'slang') {
    throw new Error('SLANG mode only allows edits to the SLANG source; generated ASM is read-only');
  }
  if (snapshot.sourceMode === 'asm' && section !== 'asm') {
    throw new Error('ASM mode only allows edits to the ASM source');
  }
  if (snapshot.sourceMode === 'basic+asm' && section === 'slang') {
    throw new Error('BASIC+ASM mode does not allow edits to the SLANG source');
  }
}

export function createX1PenMcpServer(options = {}) {
  const bridge = options.bridge || new X1PenBridge(options.bridgeOptions);
  const server = new McpServer({ name: 'x1pen', version: '2.1.0' });
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
    description: 'Get a compact program summary and explicitly selected complete sources. Defaults to metadata only; prefer get_source/search_source for large sources.',
    inputSchema: {
      sessionId: sessionInput.sessionId,
      fields: z.array(z.enum(SOURCE_SECTIONS)).max(3).optional()
        .describe('Complete sources to include; omit or pass [] for metadata only'),
      includeGeneratedAsm: z.boolean().default(false)
        .describe('Allow generated ASM to be returned when the program is in SLANG mode'),
      maxCharacters: z.number().int().min(1).max(MAX_SOURCE_LENGTH).default(MAX_RANGE_CHARACTERS)
        .describe('Maximum combined size of explicitly selected complete sources'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId, fields, includeGeneratedAsm, maxCharacters }) => {
    const snapshot = normalizeProgramSnapshot(await bridge.sendCommand('getProgram', {}, sessionId));
    return textResult(selectProgramFields(snapshot, fields, includeGeneratedAsm, maxCharacters));
  }));

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
  }, handleTool(async ({ sessionId, expectedRevision, ...program }) => {
    const snapshot = normalizeProgramSnapshot(await bridge.sendCommand(
      'setProgram', { program, expectedRevision }, sessionId,
    ));
    return textResult({ ok: true, ...summarizeProgram(snapshot) });
  }));

  server.registerTool('x1pen_get_source', {
    description: 'Read a bounded line range from one X1Pen source section without returning the complete program.',
    inputSchema: {
      sessionId: sessionInput.sessionId,
      section: z.enum(SOURCE_SECTIONS),
      startLine: z.number().int().min(1).default(1),
      lineCount: z.number().int().min(1).max(1_000).default(200),
      maxCharacters: z.number().int().min(1).max(MAX_RANGE_CHARACTERS).default(DEFAULT_RANGE_CHARACTERS),
      includeGeneratedAsm: z.boolean().default(false),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId, section, ...options }) => {
    const snapshot = normalizeProgramSnapshot(await bridge.sendCommand('getProgram', {}, sessionId));
    return textResult(getSourceRange(snapshot, section, options));
  }));

  server.registerTool('x1pen_search_source', {
    description: 'Find literal text in one X1Pen source section and return bounded line context around matches.',
    inputSchema: {
      sessionId: sessionInput.sessionId,
      section: z.enum(SOURCE_SECTIONS),
      query: z.string().min(1).max(1_024),
      caseSensitive: z.boolean().default(false),
      contextLines: z.number().int().min(0).max(5).default(2),
      maxResults: z.number().int().min(1).max(20).default(20),
      includeGeneratedAsm: z.boolean().default(false),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId, section, ...options }) => {
    const snapshot = normalizeProgramSnapshot(await bridge.sendCommand('getProgram', {}, sessionId));
    return textResult(searchSource(snapshot, section, options));
  }));

  server.registerTool('x1pen_apply_edits', {
    description: 'Apply non-overlapping line edits to one authoring source when expectedRevision still matches. Line numbers are 1-based.',
    inputSchema: {
      sessionId: sessionInput.sessionId,
      section: z.enum(SOURCE_SECTIONS),
      expectedRevision: z.number().int().min(0),
      edits: z.array(z.object({
        startLine: z.number().int().min(1),
        deleteLineCount: z.number().int().min(0),
        text: z.string().max(MAX_SOURCE_LENGTH),
      })).min(1).max(100),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId, section, expectedRevision, edits }) => {
    const replacementSize = edits.reduce((total, edit) => total + edit.text.length, 0);
    if (replacementSize > MAX_SOURCE_LENGTH) {
      throw new Error(`Combined replacement text exceeds ${MAX_SOURCE_LENGTH} characters`);
    }

    const snapshot = normalizeProgramSnapshot(await bridge.sendCommand('getProgram', {}, sessionId));
    if (snapshot.revision !== expectedRevision) {
      throw new Error(`Revision conflict: expected ${expectedRevision}, current ${snapshot.revision}`);
    }
    assertEditableSection(snapshot, section);
    const applied = applyLineEdits(snapshot[section], edits);
    if (applied.source.length > MAX_SOURCE_LENGTH) {
      throw new Error(`Edited ${section} source exceeds ${MAX_SOURCE_LENGTH} characters`);
    }
    if (applied.source === snapshot[section]) {
      return textResult({
        ok: true,
        changed: false,
        section,
        changes: applied.changes,
        ...summarizeProgram(snapshot),
      });
    }

    const program = {
      sourceMode: snapshot.sourceMode,
      basic: snapshot.basic,
      asm: snapshot.asm,
      slang: snapshot.slang,
      [section]: applied.source,
    };
    const generatedAsmCleared = section === 'slang' && snapshot.asm.length > 0;
    const updated = normalizeProgramSnapshot(await bridge.sendCommand(
      'setProgram', { program, expectedRevision }, sessionId,
    ));
    return textResult({
      ok: true,
      changed: true,
      section,
      changes: applied.changes,
      generatedAsmCleared,
      ...summarizeProgram(updated),
    });
  }));

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
