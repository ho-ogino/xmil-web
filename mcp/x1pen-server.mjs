#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod/v4';
import { X1PenBridge } from './x1pen-bridge.mjs';
import { createMcpDescriptor } from './x1pen-compatibility.mjs';
import {
  getReferenceEntries,
  getReferenceManifest,
  searchReference,
} from './x1pen-reference.mjs';

const PACKAGE = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const MAX_SOURCE_LENGTH = 512 * 1024;
const DEFAULT_RANGE_CHARACTERS = 32 * 1024;
const MAX_RANGE_CHARACTERS = 128 * 1024;
const SOURCE_SECTIONS = ['basic', 'asm', 'slang'];
const REFERENCE_LANGUAGES = ['fuzzybasic', 'slang', 'z80asm', 'x1'];
const REFERENCE_KINDS = [
  'syntax', 'runtime', 'x1-extension', 'catalog', 'library', 'profile', 'limits',
  'architecture', 'memory', 'video', 'io',
];
const DEBUGGER_STOP_REASONS = ['none', 'manual', 'breakpoint', 'step'];
const DEBUGGER_MAX_READ_LENGTH = 4096;
const DEBUGGER_MAX_BREAKPOINTS = 1024;
const DEBUGGER_VRAM_REGIONS = ['text', 'attribute', 'kanji', 'graphics'];
const DEBUGGER_VRAM_PLANES = ['blue', 'red', 'green'];
const DEBUGGER_VRAM_REGION_SIZES = {
  text: 0x0800,
  attribute: 0x0800,
  kanji: 0x0800,
  graphics: 0x4000,
};
const SERVER_INSTRUCTIONS = [
  'X1Pen FuzzyBASIC, SLANG and the built-in Z80 assembler have implementation-specific contracts. Do not infer syntax or APIs from ordinary BASIC, C, another SLANG release or a different assembler.',
  'The X1 has separate CPU-memory, I/O-port and video-memory spaces. Before direct memory, port, bank or VRAM work, search the bundled x1 hardware reference instead of inferring another machine architecture.',
  'Before writing or substantially editing a program, call x1pen_get_language_profile, search the bundled reference with x1pen_search_reference, and fetch only the needed IDs with x1pen_get_reference.',
  'After editing, call x1pen_validate. Run and inspect the visible emulator when behavior must be confirmed.',
  'Prefer bounded source and reference tools so generated ASM and unrelated manual sections do not consume context.',
  'Connection and status results report MCP, Connector and X1Pen compatibility. Do not retry a feature that reports an update-required error until that component is updated.',
].join(' ');

function textResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
  };
}

function toolError(error) {
  if (error && typeof error.code === 'string') {
    const details = {};
    for (const key of ['code', 'component', 'feature', 'message', 'currentVersion', 'requiredVersion', 'action']) {
      if (typeof error[key] === 'string') details[key] = error[key];
    }
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ error: details }) }],
    };
  }
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

function compactDebuggerMemory(value) {
  if (!value || !Number.isInteger(value.address) || !Number.isInteger(value.length) ||
      !Array.isArray(value.bytes) || value.bytes.length !== value.length ||
      value.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 0xFF)) {
    throw new Error('X1Pen returned an invalid debugger memory response');
  }
  return {
    address: value.address,
    endAddress: value.address + value.length - 1,
    length: value.length,
    hex: value.bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase(),
  };
}

function validateDebuggerVramRange({ region, bank, plane, offset, length }) {
  const size = DEBUGGER_VRAM_REGION_SIZES[region];
  if (offset + length > size) {
    throw new Error(`VRAM range exceeds the ${region} region (${size} bytes)`);
  }
  if (region === 'graphics') {
    if (bank === undefined) throw new Error('graphics VRAM requires bank 0, 1, display or access');
    if (plane === undefined) throw new Error('graphics VRAM requires plane blue, red or green');
  } else if (bank !== undefined || plane !== undefined) {
    throw new Error('bank and plane are only valid for graphics VRAM');
  }
}

function compactDebuggerVram(value) {
  if (!value || !DEBUGGER_VRAM_REGIONS.includes(value.region) ||
      !Number.isInteger(value.offset) || !Number.isInteger(value.length) ||
      !Array.isArray(value.bytes) || value.bytes.length !== value.length ||
      value.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 0xFF)) {
    throw new Error('X1Pen returned an invalid debugger VRAM response');
  }
  const result = {
    region: value.region,
    offset: value.offset,
    endOffset: value.offset + value.length - 1,
    length: value.length,
    hex: value.bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase(),
  };
  if (value.region === 'graphics') {
    if (!Number.isInteger(value.bank) || !DEBUGGER_VRAM_PLANES.includes(value.plane)) {
      throw new Error('X1Pen returned an invalid graphics VRAM response');
    }
    result.bankSelector = value.bankSelector;
    result.bank = value.bank;
    result.plane = value.plane;
  }
  return result;
}

function compactDebuggerVramWrite(value) {
  if (!value || !DEBUGGER_VRAM_REGIONS.includes(value.region) ||
      !Number.isInteger(value.offset) || !Number.isInteger(value.length) ||
      !Number.isInteger(value.bytesWritten) || value.bytesWritten !== value.length ||
      typeof value.redrawPending !== 'boolean') {
    throw new Error('X1Pen returned an invalid debugger VRAM write response');
  }
  const result = {
    region: value.region,
    offset: value.offset,
    endOffset: value.offset + value.length - 1,
    bytesWritten: value.bytesWritten,
    redrawPending: value.redrawPending,
  };
  if (value.region === 'graphics') {
    if (!Number.isInteger(value.bank) || !DEBUGGER_VRAM_PLANES.includes(value.plane)) {
      throw new Error('X1Pen returned an invalid graphics VRAM write response');
    }
    result.bankSelector = value.bankSelector;
    result.bank = value.bank;
    result.plane = value.plane;
  }
  return result;
}

export function createX1PenMcpServer(options = {}) {
  const bridge = options.bridge || new X1PenBridge({
    ...options.bridgeOptions,
    serverDescriptor: options.bridgeOptions?.serverDescriptor || createMcpDescriptor(PACKAGE.version),
  });
  const server = new McpServer(
    { name: 'x1pen', version: PACKAGE.version },
    { instructions: SERVER_INSTRUCTIONS },
  );
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

  server.registerTool('x1pen_get_language_profile', {
    description: 'Call before generating nontrivial code. Lists the bundled FuzzyBASIC, SLANG, built-in Z80 assembler and X1 hardware profiles and, when connected, compares language profiles with those reported by X1Pen.',
    inputSchema: {
      sessionId: sessionInput.sessionId,
      includeActive: z.boolean().default(true)
        .describe('Read profile IDs from the connected X1Pen tab when one is available'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId, includeActive }) => {
    const manifest = getReferenceManifest();
    const result = { ...manifest, active: null, reportedProfiles: null, compatible: null };
    if (!includeActive) return textResult(result);

    const sessions = bridge.listSessions();
    if (!sessionId && sessions.length === 0) {
      result.note = 'Reference data is available offline; connect an X1Pen tab to identify its active profiles.';
      return textResult(result);
    }

    const status = await bridge.sendCommand('getStatus', {}, sessionId);
    if (!status || !status.languageProfiles) {
      result.note = 'The connected X1Pen does not report language profile IDs. Update X1Pen to compare reference compatibility.';
      return textResult(result);
    }
    result.active = status.activeLanguageProfile || null;
    result.reportedProfiles = status.languageProfiles;
    const bundledIds = new Set(manifest.profiles.map((profile) => profile.id));
    const activeIds = Object.values(status.languageProfiles)
      .map((profile) => profile && profile.id)
      .filter(Boolean);
    result.compatible = activeIds.every((id) => bundledIds.has(id));
    return textResult(result);
  }));

  server.registerTool('x1pen_search_reference', {
    description: 'Search the bundled X1Pen-specific FuzzyBASIC, SLANG, built-in Z80 assembler and X1 hardware reference before assuming syntax, APIs, memory maps or I/O behavior. Returns compact summaries and stable IDs; use x1pen_get_reference for selected details.',
    inputSchema: {
      query: z.string().min(1).max(1_024),
      language: z.enum(REFERENCE_LANGUAGES).optional(),
      profile: z.string().min(1).max(128).optional(),
      kinds: z.array(z.enum(REFERENCE_KINDS)).min(1).max(REFERENCE_KINDS.length).optional(),
      maxResults: z.number().int().min(1).max(20).default(8),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async (args) => textResult(searchReference(args))));

  server.registerTool('x1pen_get_reference', {
    description: 'Get complete X1Pen-specific reference entries for stable IDs returned by x1pen_search_reference, with a bounded response size.',
    inputSchema: {
      ids: z.array(z.string().min(1).max(128)).min(1).max(10),
      maxCharacters: z.number().int().min(1).max(MAX_RANGE_CHARACTERS).default(DEFAULT_RANGE_CHARACTERS),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async (args) => textResult(getReferenceEntries(args))));

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

  server.registerTool('x1pen_debug_get_state', {
    description: 'Get the Z80 debugger run state, stop reason, registers, cycles and current memory mapping.',
    inputSchema: sessionInput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId }) => textResult(
    await bridge.sendCommand('debuggerGetState', {}, sessionId),
  )));

  server.registerTool('x1pen_debug_pause', {
    description: 'Pause Z80 execution after any in-progress X1Pen Run setup finishes.',
    inputSchema: sessionInput,
    annotations: { openWorldHint: false },
  }, handleTool(async ({ sessionId }) => textResult(
    await bridge.sendCommand('debuggerPause', {}, sessionId),
  )));

  server.registerTool('x1pen_debug_resume', {
    description: 'Resume Z80 execution. Pass the returned sequence to x1pen_debug_wait_for_pause when waiting for a later stop.',
    inputSchema: sessionInput,
    annotations: { destructiveHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId }) => textResult(
    await bridge.sendCommand('debuggerResume', {}, sessionId),
  )));

  server.registerTool('x1pen_debug_step', {
    description: 'Execute one or more Z80 instructions from a paused state and return only the final state.',
    inputSchema: {
      sessionId: sessionInput.sessionId,
      count: z.number().int().min(1).max(100).default(1),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId, count }) => textResult(
    await bridge.sendCommand('debuggerStep', { count }, sessionId),
  )));

  server.registerTool('x1pen_debug_set_breakpoints', {
    description: 'Atomically replace up to 1024 Z80 PC breakpoints. Pass an empty array to clear them.',
    inputSchema: {
      sessionId: sessionInput.sessionId,
      addresses: z.array(z.number().int().min(0).max(0xFFFF)).max(DEBUGGER_MAX_BREAKPOINTS),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId, addresses }) => textResult(
    await bridge.sendCommand('debuggerSetBreakpoints', { addresses }, sessionId),
  )));

  server.registerTool('x1pen_debug_read_memory', {
    description: 'Read a bounded range from the current Z80 address space as a compact uppercase hexadecimal string.',
    inputSchema: {
      sessionId: sessionInput.sessionId,
      address: z.number().int().min(0).max(0xFFFF),
      length: z.number().int().min(1).max(DEBUGGER_MAX_READ_LENGTH).default(64),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId, address, length }) => {
    if (address + length > 0x10000) throw new Error('Memory range exceeds the 64KB address space');
    const memory = await bridge.sendCommand('debuggerReadMemory', { address, length }, sessionId);
    return textResult(compactDebuggerMemory(memory));
  }));

  server.registerTool('x1pen_debug_get_video_state', {
    description: 'Get the current X1 model, screen dimensions, display/access graphics banks and VRAM availability.',
    inputSchema: sessionInput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId }) => textResult(
    await bridge.sendCommand('debuggerGetVideoState', {}, sessionId),
  )));

  const vramSelectionSchema = {
    sessionId: sessionInput.sessionId,
    region: z.enum(DEBUGGER_VRAM_REGIONS),
    bank: z.union([z.literal(0), z.literal(1), z.enum(['display', 'access'])]).optional()
      .describe('Required for graphics VRAM; display/access are resolved atomically by X1Pen'),
    plane: z.enum(DEBUGGER_VRAM_PLANES).optional().describe('Required for graphics VRAM'),
    offset: z.number().int().min(0).max(0x3FFF),
  };

  server.registerTool('x1pen_debug_read_vram', {
    description: 'Read logical X1 video memory without I/O side effects and return compact uppercase hex. Running reads may not be a consistent multi-byte snapshot; pause first when consistency matters.',
    inputSchema: {
      ...vramSelectionSchema,
      length: z.number().int().min(1).max(DEBUGGER_MAX_READ_LENGTH).default(64),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId, ...request }) => {
    validateDebuggerVramRange(request);
    const value = await bridge.sendCommand('debuggerReadVram', request, sessionId);
    return textResult(compactDebuggerVram(value));
  }));

  server.registerTool('x1pen_debug_write_vram', {
    description: 'Write logical X1 video memory while the Z80 debugger is paused. hex must contain 1-4096 bytes as contiguous even-length hexadecimal.',
    inputSchema: {
      ...vramSelectionSchema,
      hex: z.string().min(2).max(DEBUGGER_MAX_READ_LENGTH * 2)
        .regex(/^(?:[0-9A-Fa-f]{2})+$/, 'hex must contain contiguous pairs of hexadecimal digits'),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId, hex, ...selection }) => {
    const bytes = Array.from(Buffer.from(hex, 'hex'));
    const request = { ...selection, length: bytes.length };
    validateDebuggerVramRange(request);
    const value = await bridge.sendCommand('debuggerWriteVram', { ...selection, bytes }, sessionId);
    return textResult(compactDebuggerVramWrite(value));
  }));

  server.registerTool('x1pen_debug_wait_for_pause', {
    description: 'Wait for a matching debugger pause. afterSequence must be the sequence returned by x1pen_debug_resume, not an earlier stopped state.',
    inputSchema: {
      sessionId: sessionInput.sessionId,
      afterSequence: z.number().int().min(0).max(0xFFFFFFFF).optional(),
      stopReason: z.enum(DEBUGGER_STOP_REASONS).optional(),
      address: z.number().int().min(0).max(0xFFFF).optional(),
      timeoutMs: z.number().int().min(0).max(50_000).default(5_000),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId, ...options }) => textResult(
    await bridge.sendCommand('debuggerWaitForPause', options, sessionId),
  )));

  server.registerTool('x1pen_run', {
    description: 'Build and run the current program in the connected user-visible X1Pen tab. Concurrent Run returns ordinary content with code RUN_IN_PROGRESS and retryAfterMs; a Run held behind other Automation work can return non-retryable RUN_QUEUE_TIMEOUT. The server does not retry automatically.',
    inputSchema: {
      sessionId: sessionInput.sessionId,
      waitMs: z.number().int().min(0).max(10_000).default(500),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId, waitMs }) => {
    const commandTimeoutMs = Number.isFinite(bridge.commandTimeoutMs) ? bridge.commandTimeoutMs : 60_000;
    const queueTimeoutMs = Math.max(100, Math.min(20_000, Math.floor(commandTimeoutMs / 4)));
    return textResult(await bridge.sendCommand('run', { waitMs, queueTimeoutMs }, sessionId));
  }));

  server.registerTool('x1pen_recover_stalled', {
    description: 'Reload a Run-stalled X1Pen tab. First call without confirmation to read the data-loss warning. Recovery is refused unless Run admission is already stalled; it preserves editor source but loses emulator RAM and unpersisted disk changes.',
    inputSchema: {
      sessionId: sessionInput.sessionId,
      confirmDataLoss: z.boolean().default(false),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId, confirmDataLoss }) => textResult(
    await bridge.sendCommand('recoverStalled', { confirmDataLoss }, sessionId),
  )));

  server.registerTool('x1pen_stop', {
    description: 'Send ESC to stop the program in the connected X1Pen tab.',
    inputSchema: sessionInput,
    annotations: { destructiveHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId }) => textResult(await bridge.sendCommand('stop', {}, sessionId))));

  server.registerTool('x1pen_get_status', {
    description: 'Get readiness, revision, lock and status state from the connected X1Pen tab.',
    inputSchema: sessionInput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId }) => {
    const status = await bridge.sendCommand('getStatus', {}, sessionId);
    const compatibility = typeof bridge.getSessionCompatibility === 'function'
      ? bridge.getSessionCompatibility(sessionId)
      : null;
    return textResult({ ...status, compatibility });
  }));

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
  if (process.argv.includes('--version') || process.argv.includes('-v')) {
    console.log(PACKAGE.version);
    return;
  }
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`x1pen-mcp ${PACKAGE.version}\n\nLocal stdio MCP server and browser bridge for X1Pen.\n\nOptions:\n  -h, --help     Show this help\n  -v, --version  Show the package version`);
    return;
  }
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

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((error) => {
    console.error('[x1pen-mcp] fatal:', error);
    process.exit(1);
  });
}
