#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod/v4';
import { X1PenBridge } from './x1pen-bridge.mjs';
import { assertFeatureCompatible, createMcpDescriptor } from './x1pen-compatibility.mjs';
import {
  HASH_PATTERN,
  MAX_BASELINE_BYTES,
  SourceBaselineCache,
  SourceSyncError,
  contentHash,
  createBoundedLineDiff,
  sourceByteLength,
  sourceIdentities,
  sourceRole,
} from './x1pen-source-sync.mjs';
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
const X1PEN_KEY_CODES = Object.freeze([
  0x08, 0x09, 0x0D, 0x13, 0x1B, 0x20,
  ...Array.from({ length: 8 }, (_, index) => 0x21 + index),
  0x2D, 0x2E,
  ...Array.from({ length: 10 }, (_, index) => 0x30 + index),
  ...Array.from({ length: 26 }, (_, index) => 0x41 + index),
  ...Array.from({ length: 12 }, (_, index) => 0x60 + index),
  0x6D, 0x6E, 0x6F,
  ...Array.from({ length: 12 }, (_, index) => 0x70 + index),
  0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xBF, 0xC0,
  0xDB, 0xDC, 0xDD, 0xDE, 0xE2,
]);
const X1PEN_KEY_CODE_SET = new Set(X1PEN_KEY_CODES);
const SERVER_INSTRUCTIONS = [
  'X1Pen FuzzyBASIC, SLANG and the built-in Z80 assembler have implementation-specific contracts. Do not infer syntax or APIs from ordinary BASIC, C, another SLANG release or a different assembler.',
  'The X1 has separate CPU-memory, I/O-port and video-memory spaces. Before direct memory, port, bank or VRAM work, search the bundled x1 hardware reference instead of inferring another machine architecture.',
  'Before writing or substantially editing a program, call x1pen_get_language_profile, search the bundled reference with x1pen_search_reference, and fetch only the needed IDs with x1pen_get_reference.',
  'After editing, call x1pen_validate. Run and inspect the visible emulator when behavior must be confirmed.',
  'x1pen_set_program is a complete replacement: sections inactive for sourceMode are cleared even when supplied. Use x1pen_apply_edits for bounded edits within the current mode.',
  'Before sending a replacement, treat it as large asset-like only when it embeds substantially all of a known asset of at least 8 KiB, or has at least 8,192 byte literals in table-like runs covering at least 50% of its non-whitespace text; source length alone never triggers this rule. Before explicit user approval, do not read, re-emit, or split that data through the model. Offer ASM: the existing Import button for DB lines; SLANG: the existing Import button inserts array values at the cursor, or use Disk Editor plus MAGLOAD/FOPEN/FREAD; BASIC: Disk Editor plus BLOAD or the applicable file workflow. Do not suggest local UTF-8 source-file sync unless available and user-configured, and then only for a complete prepared source section, not raw binary or a fragment. After approval, prefer one write and split only if the client output limit requires it.',
  'For SLANG, validation output.generatedAsmLines and asmBytes describe temporary compilation output only. Validation does not store generated ASM in the program; Run does.',
  'Prefer bounded source and reference tools so generated ASM and unrelated manual sections do not consume context.',
  'Retain revisionEpoch when offered, revision and authoringHash together. Inspect writeGuard on every source result: revision-epoch is reload-safe, while revision-only is a visible compatibility fallback. On a source conflict, compare before retrying; never replace only the revision and blindly resend stale source.',
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
    for (const key of ['code', 'component', 'feature', 'section', 'message', 'currentVersion', 'requiredVersion', 'action']) {
      if (typeof error[key] === 'string') details[key] = error[key].slice(0, 1_024);
    }
    for (const key of [
      'expectedRevision', 'currentRevision', 'conflictRevision', 'observedRevision',
      'editIndex', 'otherEditIndex', 'startLine', 'lineCount', 'limit', 'actual',
    ]) {
      if (Number.isSafeInteger(error[key]) && error[key] >= 0) details[key] = error[key];
    }
    for (const key of [
      'expectedRevisionEpoch', 'currentRevisionEpoch', 'conflictRevisionEpoch',
      'observedRevisionEpoch', 'instanceId',
    ]) {
      if (typeof error[key] === 'string' && error[key].length <= 128) details[key] = error[key];
    }
    for (const key of ['metadataAvailable', 'observedMetadataAvailable']) {
      if (typeof error[key] === 'boolean') details[key] = error[key];
    }
    if (error.current && typeof error.current === 'object') {
      const current = {};
      for (const key of ['sourceMode', 'revisionEpoch', 'instanceId', 'authoringHash']) {
        if (typeof error.current[key] === 'string' && error.current[key].length <= 128) current[key] = error.current[key];
      }
      if (Number.isSafeInteger(error.current.revision) && error.current.revision >= 0) {
        current.revision = error.current.revision;
      }
      if (typeof error.current.guardedWritesReloadSafe === 'boolean') {
        current.guardedWritesReloadSafe = error.current.guardedWritesReloadSafe;
      }
      if (['revision-only', 'revision-epoch'].includes(error.current.writeGuard)) {
        current.writeGuard = error.current.writeGuard;
      }
      if (error.current.sections && typeof error.current.sections === 'object') {
        current.sections = {};
        for (const section of SOURCE_SECTIONS) {
          const input = error.current.sections[section];
          if (!input || typeof input !== 'object') continue;
          const output = {};
          for (const key of ['lineCount', 'characterCount', 'byteCount']) {
            if (Number.isSafeInteger(input[key]) && input[key] >= 0) output[key] = input[key];
          }
          for (const key of ['role', 'contentHash', 'generatedContentHash']) {
            if (typeof input[key] === 'string' && input[key].length <= 96) output[key] = input[key];
          }
          current.sections[section] = output;
        }
      }
      details.current = current;
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
    revisionEpoch: typeof value.revisionEpoch === 'string' && value.revisionEpoch.length <= 128
      ? value.revisionEpoch
      : undefined,
    pageGuardedWritesReloadSafe: value.guardedWritesReloadSafe === true,
  };
  for (const section of SOURCE_SECTIONS) {
    if (typeof value[section] !== 'string') {
      const error = new Error(`X1Pen did not expose ${section} source content`);
      Object.assign(error, {
        code: 'SOURCE_CONTENT_UNAVAILABLE',
        component: 'x1pen',
        section,
        action: 'Update or reload X1Pen, then read the program again. An absent source field is not treated as empty source.',
      });
      throw error;
    }
    snapshot[section] = value[section];
  }
  return snapshot;
}

function sourceLineCount(source) {
  return source.length === 0 ? 0 : source.split('\n').length;
}

function writeGuardFields(snapshot) {
  const guardedWritesReloadSafe = snapshot.guardedWritesReloadSafe === true;
  return {
    guardedWritesReloadSafe,
    writeGuard: guardedWritesReloadSafe ? 'revision-epoch' : 'revision-only',
  };
}

function summarizeProgram(snapshot) {
  const identities = sourceIdentities(snapshot);
  const sections = {};
  for (const section of SOURCE_SECTIONS) {
    const identity = identities.sections[section];
    sections[section] = {
      lineCount: sourceLineCount(snapshot[section]),
      characterCount: snapshot[section].length,
      byteCount: sourceByteLength(snapshot[section]),
      role: identity.role,
      ...(identity.contentHash ? { contentHash: identity.contentHash } : {}),
      ...(identity.generatedContentHash ? { generatedContentHash: identity.generatedContentHash } : {}),
    };
  }
  sections.asm.generated = snapshot.sourceMode === 'slang' && snapshot.asm.length > 0;
  return {
    sourceMode: snapshot.sourceMode,
    revision: snapshot.revision,
    ...(snapshot.revisionEpoch ? { revisionEpoch: snapshot.revisionEpoch } : {}),
    ...writeGuardFields(snapshot),
    ...(snapshot.instanceId ? { instanceId: snapshot.instanceId } : {}),
    authoringHash: identities.authoringHash,
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
      throw new SourceSyncError(
        'SOURCE_LIMIT_EXCEEDED',
        `Selected sources contain ${selectedCharacters} characters, exceeding maxCharacters ${maxCharacters}`,
        {
          limit: maxCharacters,
          actual: selectedCharacters,
          action: 'Use x1pen_get_source for bounded ranges or raise maxCharacters explicitly.',
        },
      );
    }
    result[section] = snapshot[section];
    result.includedFields.push(section);
  }
  return result;
}

function getReadableSection(snapshot, section, includeGeneratedAsm) {
  if (section === 'asm' && snapshot.sourceMode === 'slang' && snapshot.asm.length > 0 && !includeGeneratedAsm) {
    throw new SourceSyncError(
      'GENERATED_SOURCE_REQUIRES_OPT_IN',
      'ASM is generated from SLANG and is excluded by default',
      { section, action: 'Set includeGeneratedAsm to true only when generated output is required.' },
    );
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
      ...(snapshot.revisionEpoch ? { revisionEpoch: snapshot.revisionEpoch } : {}),
      ...writeGuardFields(snapshot),
      contentHash: contentHash(snapshot[section]),
      startLine: 1,
      endLine: 0,
      totalLines: 0,
      text: '',
      truncated: false,
    };
  }
  if (options.startLine > lines.length) {
    throw new SourceSyncError(
      'SOURCE_RANGE_INVALID',
      `startLine ${options.startLine} exceeds ${section} line count ${lines.length}`,
      {
        section,
        startLine: options.startLine,
        lineCount: lines.length,
        action: 'Read the current section metadata and request a startLine within its line count.',
      },
    );
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
    ...(snapshot.revisionEpoch ? { revisionEpoch: snapshot.revisionEpoch } : {}),
    ...writeGuardFields(snapshot),
    contentHash: contentHash(snapshot[section]),
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
    ...(snapshot.revisionEpoch ? { revisionEpoch: snapshot.revisionEpoch } : {}),
    ...writeGuardFields(snapshot),
    contentHash: contentHash(snapshot[section]),
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
      throw new SourceSyncError(
        'EDIT_RANGE_INVALID',
        `edit ${index + 1} starts beyond the source at line ${edit.startLine}`,
        {
          editIndex: index + 1,
          startLine: edit.startLine,
          lineCount: lines.length,
          action: 'Read the current bounded source and submit an edit within its line range.',
        },
      );
    }
    if (startIndex + edit.deleteLineCount > lines.length) {
      throw new SourceSyncError(
        'EDIT_RANGE_INVALID',
        `edit ${index + 1} deletes beyond the end of the source`,
        {
          editIndex: index + 1,
          startLine: edit.startLine,
          lineCount: lines.length,
          action: 'Reduce deleteLineCount or re-read the current source before editing.',
        },
      );
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
      throw new SourceSyncError(
        'EDITS_OVERLAP',
        `edits ${previous.index + 1} and ${current.index + 1} overlap`,
        {
          editIndex: previous.index + 1,
          otherEditIndex: current.index + 1,
          action: 'Merge overlapping replacements or submit non-overlapping line ranges.',
        },
      );
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
    throw new SourceSyncError(
      'SOURCE_SECTION_NOT_EDITABLE',
      'SLANG mode only allows edits to the SLANG source; generated ASM is read-only',
      { section, action: 'Edit the slang section; generated ASM is replaced by the next compile.' },
    );
  }
  if (snapshot.sourceMode === 'asm' && section !== 'asm') {
    throw new SourceSyncError(
      'SOURCE_SECTION_NOT_EDITABLE',
      'ASM mode only allows edits to the ASM source',
      { section, action: 'Edit the asm section or replace the complete program with a different sourceMode.' },
    );
  }
  if (snapshot.sourceMode === 'basic+asm' && section === 'slang') {
    throw new SourceSyncError(
      'SOURCE_SECTION_NOT_EDITABLE',
      'BASIC+ASM mode does not allow edits to the SLANG source',
      { section, action: 'Edit the basic or asm section, or replace the complete program in slang mode.' },
    );
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
  const baselines = new SourceBaselineCache(options.sourceBaselineOptions);

  function pruneBaselinesToSessions() {
    const activeInstances = new Set((bridge.listSessions?.() || []).map((session) => session.sessionId));
    baselines.retainInstances(activeInstances);
  }

  function observeSnapshot(snapshot) {
    pruneBaselinesToSessions();
    baselines.rememberSnapshot(snapshot);
    return snapshot;
  }

  function sourceSyncContext(sessionId) {
    let resolvedSessionId = sessionId;
    if (typeof bridge.resolveSession === 'function') {
      resolvedSessionId = bridge.resolveSession(sessionId);
    } else if (!resolvedSessionId) {
      const sessions = bridge.listSessions?.() || [];
      if (sessions.length === 1) resolvedSessionId = sessions[0].sessionId;
    }
    const compatibility = typeof bridge.getSessionCompatibility === 'function'
      ? bridge.getSessionCompatibility(resolvedSessionId)
      : null;
    return {
      sessionId: resolvedSessionId,
      compatibility,
      sourceSyncAvailable:
        compatibility?.capabilities?.['automation.source-sync']?.state === 'available',
    };
  }

  function effectiveWriteGuard(snapshot, context, requirePageConfirmation = false) {
    const guardedWritesReloadSafe = context.sourceSyncAvailable === true &&
      typeof snapshot.revisionEpoch === 'string' &&
      (!requirePageConfirmation || snapshot.pageGuardedWritesReloadSafe === true);
    return {
      ...snapshot,
      guardedWritesReloadSafe,
    };
  }

  async function readProgram(sessionOrContext) {
    const context = sessionOrContext && typeof sessionOrContext === 'object'
      ? sessionOrContext
      : sourceSyncContext(sessionOrContext);
    const snapshot = normalizeProgramSnapshot(
      await bridge.sendCommand('getProgram', {}, context.sessionId),
    );
    return observeSnapshot(effectiveWriteGuard(snapshot, context));
  }

  function conflictError(code, details = {}) {
    let message;
    if (code === 'REVISION_EPOCH_UNAVAILABLE') {
      message = 'X1Pen advertises reload-safe source sync but did not expose a revision epoch';
    } else if (code === 'REVISION_EPOCH_REQUIRED') {
      message = 'A revision epoch is required with expectedRevision';
    } else if (code === 'REVISION_EPOCH_MISMATCH') {
      message = 'Revision epoch conflict: expectedRevisionEpoch does not match the current program epoch';
    } else {
      message = `Revision conflict: expected ${details.expectedRevision}, current ${details.currentRevision}`;
    }
    const error = new Error(message);
    Object.assign(error, {
      code,
      component: 'x1pen',
      action: code === 'REVISION_EPOCH_UNAVAILABLE'
        ? 'Update or reload X1Pen and read the program again; do not retry this write without a page-provided epoch.'
        : (code === 'REVISION_EPOCH_REQUIRED'
            ? 'Call x1pen_get_program and retry with both expectedRevisionEpoch and expectedRevision.'
            : 'Call x1pen_diff_source or bounded source reads, reconcile changes, then retry with the newly observed epoch and revision.'),
      ...details,
    });
    return error;
  }

  function normalizeLegacyConflict(error) {
    if (error?.code) return error;
    const match = /^Revision conflict: expected (\d+), current (\d+)$/.exec(error?.message || '');
    if (!match) return error;
    const expectedRevision = Number(match[1]);
    const currentRevision = Number(match[2]);
    if (!Number.isSafeInteger(expectedRevision) || !Number.isSafeInteger(currentRevision)) return error;
    Object.assign(error, {
      code: 'REVISION_MISMATCH',
      component: 'x1pen',
      expectedRevision,
      currentRevision,
      metadataAvailable: false,
      legacyConflictShape: true,
      action: 'Call x1pen_get_program and compare the current source before retrying.',
    });
    return error;
  }

  async function enrichConflict(input, context, knownSnapshot) {
    const error = normalizeLegacyConflict(input);
    if (![
      'REVISION_MISMATCH', 'REVISION_EPOCH_MISMATCH',
      'REVISION_EPOCH_REQUIRED', 'REVISION_EPOCH_UNAVAILABLE',
    ].includes(error?.code)) {
      throw error;
    }
    if (Number.isSafeInteger(error.currentRevision)) error.conflictRevision = error.currentRevision;
    if (typeof error.currentRevisionEpoch === 'string') error.conflictRevisionEpoch = error.currentRevisionEpoch;
    try {
      const current = knownSnapshot || await readProgram(context);
      const summary = summarizeProgram(current);
      error.metadataAvailable = error.legacyConflictShape !== true;
      error.observedMetadataAvailable = true;
      error.observedRevision = current.revision;
      if (current.revisionEpoch) error.observedRevisionEpoch = current.revisionEpoch;
      if (current.instanceId) error.instanceId = current.instanceId;
      error.current = summary;
      error.action = error.code === 'REVISION_EPOCH_UNAVAILABLE'
        ? 'Update or reload X1Pen and read the program again; the full-capability page did not provide an epoch.'
        : (error.code === 'REVISION_EPOCH_REQUIRED'
            ? 'Retry with expectedRevisionEpoch and expectedRevision from the current summary.'
            : (context.sourceSyncAvailable
            ? 'Compare the retained baseline with the current hashes or x1pen_diff_source before retrying with the observed epoch and revision.'
            : 'Compare bounded current source reads and hashes before retrying with the observed numeric revision; reload-safe writes and source diff are unavailable in this compatibility mode.'));
    } catch {
      error.metadataAvailable = false;
      error.observedMetadataAvailable = false;
    }
    throw error;
  }

  async function assertWriteBaseline(context, expectedRevision, expectedRevisionEpoch, knownSnapshot) {
    const current = knownSnapshot || await readProgram(context);
    if (context.sourceSyncAvailable && current.revisionEpoch === undefined) {
      return enrichConflict(conflictError('REVISION_EPOCH_UNAVAILABLE', {
        expectedRevision,
        currentRevision: current.revision,
        instanceId: current.instanceId,
      }), context, current);
    }
    if (context.sourceSyncAvailable && expectedRevisionEpoch === undefined) {
      return enrichConflict(conflictError('REVISION_EPOCH_REQUIRED', {
        expectedRevision,
        currentRevision: current.revision,
        currentRevisionEpoch: current.revisionEpoch,
        instanceId: current.instanceId,
      }), context, current);
    }
    if (expectedRevisionEpoch !== undefined && current.revisionEpoch !== undefined &&
        expectedRevisionEpoch !== current.revisionEpoch) {
      return enrichConflict(conflictError('REVISION_EPOCH_MISMATCH', {
        expectedRevision,
        expectedRevisionEpoch,
        currentRevision: current.revision,
        currentRevisionEpoch: current.revisionEpoch,
        instanceId: current.instanceId,
      }), context, current);
    }
    if (current.revision !== expectedRevision) {
      return enrichConflict(conflictError('REVISION_MISMATCH', {
        expectedRevision,
        currentRevision: current.revision,
        currentRevisionEpoch: current.revisionEpoch,
        instanceId: current.instanceId,
      }), context, current);
    }
    return current;
  }

  function sameAuthoringSnapshot(left, right) {
    if (left.sourceMode !== right.sourceMode) return false;
    const leftIdentities = sourceIdentities(left);
    const rightIdentities = sourceIdentities(right);
    return leftIdentities.authoringHash === rightIdentities.authoringHash;
  }

  async function assertApplySnapshotUnchanged(context, snapshot, expectedRevisionEpoch) {
    const current = await readProgram(context);
    if (expectedRevisionEpoch !== undefined && current.revisionEpoch !== undefined &&
        expectedRevisionEpoch !== current.revisionEpoch) {
      return enrichConflict(conflictError('REVISION_EPOCH_MISMATCH', {
        expectedRevision: snapshot.revision,
        expectedRevisionEpoch,
        currentRevision: current.revision,
        currentRevisionEpoch: current.revisionEpoch,
        instanceId: current.instanceId,
      }), context, current);
    }
    if (current.revision !== snapshot.revision || !sameAuthoringSnapshot(snapshot, current)) {
      return enrichConflict(conflictError('REVISION_MISMATCH', {
        expectedRevision: snapshot.revision,
        currentRevision: current.revision,
        currentRevisionEpoch: current.revisionEpoch,
        instanceId: current.instanceId,
      }), context, current);
    }
    return current;
  }

  async function sendGuardedProgram(program, expectedRevision, expectedRevisionEpoch, context) {
    const latestContext = sourceSyncContext(context.sessionId);
    if (latestContext.sourceSyncAvailable && expectedRevisionEpoch === undefined) {
      return enrichConflict(conflictError('REVISION_EPOCH_REQUIRED', {
        expectedRevision,
      }), latestContext);
    }
    try {
      const snapshot = normalizeProgramSnapshot(await bridge.sendCommand(
        'setProgram', { program, expectedRevision, expectedRevisionEpoch }, latestContext.sessionId,
      ));
      return observeSnapshot(effectiveWriteGuard(snapshot, latestContext, true));
    } catch (error) {
      return enrichConflict(error, latestContext);
    }
  }

  server.registerTool('x1pen_connection_info', {
    description: 'Get the local bridge port and pairing code used by the X1Pen Connector extension.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async () => {
    pruneBaselinesToSessions();
    return textResult(bridge.connectionInfo());
  }));

  server.registerTool('x1pen_list_sessions', {
    description: 'List X1Pen browser tabs explicitly connected through the extension.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async () => {
    const sessions = bridge.listSessions();
    baselines.retainInstances(new Set(sessions.map((session) => session.sessionId)));
    return textResult({ sessions });
  }));

  server.registerTool('x1pen_select_session', {
    description: 'Select the X1Pen browser tab used by later tool calls. Pad input is released on the previously selected live tab first; force only when that cleanup cannot complete.',
    inputSchema: {
      sessionId: z.string().min(1),
      force: z.boolean().default(false)
        .describe('Select after pad-release failure; the old live tab may stay held until disconnect/reload'),
    },
    annotations: { openWorldHint: false },
  }, handleTool(async ({ sessionId, force }) => textResult(
    await bridge.selectSession(sessionId, { force }),
  )));

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
    const snapshot = await readProgram(sessionId);
    return textResult(selectProgramFields(snapshot, fields, includeGeneratedAsm, maxCharacters));
  }));

  server.registerTool('x1pen_set_program', {
    description: 'Replace the complete program when its revision guard still matches. Sources inactive for sourceMode are cleared even when supplied; use apply_edits to preserve the other active authoring section. Before embedding a large generated byte table, follow the server large-asset guidance; ordinary long code alone does not trigger it. expectedRevisionEpoch is required when all connected components support reload-safe source sync; older peers visibly degrade to numeric revision guarding.',
    inputSchema: {
      sessionId: sessionInput.sessionId,
      expectedRevision: z.number().int().min(0),
      expectedRevisionEpoch: z.string().min(1).max(128).optional(),
      sourceMode: z.enum(['basic+asm', 'asm', 'slang']),
      basic: z.string().max(MAX_SOURCE_LENGTH).optional(),
      asm: z.string().max(MAX_SOURCE_LENGTH).optional(),
      slang: z.string().max(MAX_SOURCE_LENGTH).optional(),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId, expectedRevision, expectedRevisionEpoch, ...program }) => {
    const context = sourceSyncContext(sessionId);
    await assertWriteBaseline(context, expectedRevision, expectedRevisionEpoch);
    const snapshot = await sendGuardedProgram(program, expectedRevision, expectedRevisionEpoch, context);
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
    const snapshot = await readProgram(sessionId);
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
    const snapshot = await readProgram(sessionId);
    return textResult(searchSource(snapshot, section, options));
  }));

  server.registerTool('x1pen_diff_source', {
    description: 'Compare a retained source baseline with the current connected tab using bounded line hunks. Baselines are ephemeral; caller-supplied text is labeled self-attested. Diffs never authorize a write.',
    inputSchema: {
      sessionId: sessionInput.sessionId,
      section: z.enum(SOURCE_SECTIONS),
      baseHash: z.string().regex(HASH_PATTERN),
      baseSourceMode: z.enum(['basic+asm', 'asm', 'slang']),
      baseRevisionEpoch: z.string().min(1).max(128),
      baseGenerated: z.boolean().default(false),
      baseSource: z.string().max(MAX_SOURCE_LENGTH).optional()
        .describe('Optional caller-retained fallback when the ephemeral baseline cache no longer has baseHash'),
      includeGeneratedAsm: z.boolean().default(false),
      contextLines: z.number().int().min(0).max(5).default(3),
      maxHunks: z.number().int().min(1).max(100).default(20),
      maxCharacters: z.number().int().min(1_024).max(64 * 1024).default(32 * 1024),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, handleTool(async ({
    sessionId, section, baseHash, baseSourceMode, baseRevisionEpoch, baseGenerated,
    baseSource, includeGeneratedAsm, contextLines, maxHunks, maxCharacters,
  }) => {
    const context = sourceSyncContext(sessionId);
    assertFeatureCompatible(
      'automation.source-sync',
      context.compatibility?.capabilities,
      context.compatibility?.components,
      { requireAvailable: true },
    );
    const current = await readProgram(context);
    if (!current.instanceId || !current.revisionEpoch) {
      throw new SourceSyncError(
        'FEATURE_UNAVAILABLE',
        'The connected X1Pen does not report source revision epochs',
        { component: 'x1pen', feature: 'automation.source-sync', action: 'Update/reload X1Pen and reconnect the tab.' },
      );
    }
    if (baseSourceMode !== current.sourceMode) {
      throw new SourceSyncError(
        'BASE_MODE_MISMATCH',
        `Baseline mode ${baseSourceMode} does not match current mode ${current.sourceMode}`,
        { action: 'Establish a new baseline after the source-mode change.' },
      );
    }

    const requestedRole = baseGenerated ? 'generated' : 'authoring';
    const currentRole = sourceRole(current.sourceMode, section, current[section]);
    if (currentRole !== requestedRole) {
      throw new SourceSyncError(
        'BASE_ROLE_MISMATCH',
        `${section} is ${currentRole} in ${current.sourceMode} mode, not ${requestedRole}`,
        { action: 'Select an authoring section or establish a baseline with matching provenance.' },
      );
    }
    if (requestedRole === 'generated' && !includeGeneratedAsm) {
      throw new SourceSyncError(
        'GENERATED_SOURCE_REQUIRES_OPT_IN',
        'Generated ASM diffs require includeGeneratedAsm=true for both sides',
        { action: 'Set includeGeneratedAsm=true only when generated output is intentionally needed.' },
      );
    }

    let resolvedBaseSource;
    let baseSourceOrigin;
    if (baseSource !== undefined) {
      if (sourceByteLength(baseSource) > MAX_BASELINE_BYTES) {
        throw new SourceSyncError('DIFF_LIMIT_EXCEEDED', `baseSource exceeds ${MAX_BASELINE_BYTES} UTF-8 bytes`);
      }
      const suppliedHash = contentHash(baseSource);
      if (suppliedHash !== baseHash) {
        throw new SourceSyncError(
          'BASE_HASH_MISMATCH',
          'baseSource does not match baseHash',
          { action: 'Use the hash returned with the retained source text.' },
        );
      }
      if (sourceRole(baseSourceMode, section, baseSource) !== requestedRole) {
        throw new SourceSyncError('BASE_ROLE_MISMATCH', 'baseSource provenance does not match baseGenerated');
      }
      resolvedBaseSource = baseSource;
      baseSourceOrigin = 'caller-supplied';
    } else {
      const entry = baselines.get({
        instanceId: current.instanceId,
        revisionEpoch: baseRevisionEpoch,
        sourceMode: baseSourceMode,
        section,
        role: requestedRole,
        hash: baseHash,
      });
      if (!entry) {
        throw new SourceSyncError(
          'BASE_SNAPSHOT_UNAVAILABLE',
          'The requested baseline is not available in the bounded in-memory cache',
          { action: 'Supply the retained baseSource with its provenance or establish a new baseline.' },
        );
      }
      resolvedBaseSource = entry.source;
      baseSourceOrigin = 'cache';
    }

    const currentHash = contentHash(current[section]);
    const diff = createBoundedLineDiff(resolvedBaseSource, current[section], {
      contextLines, maxHunks, maxCharacters,
    });
    return textResult({
      section,
      sourceMode: current.sourceMode,
      role: currentRole,
      baseHash,
      currentHash,
      byteIdentityChanged: baseHash !== currentHash,
      baseRevisionEpoch,
      currentRevisionEpoch: current.revisionEpoch,
      epochChanged: baseRevisionEpoch !== current.revisionEpoch,
      currentRevision: current.revision,
      instanceId: current.instanceId,
      baseSourceOrigin,
      baseSourceAttestation: baseSourceOrigin === 'cache'
        ? 'observed-by-this-mcp-process'
        : 'caller-supplied; hash proves self-consistency only',
      ...diff,
    });
  }));

  server.registerTool('x1pen_apply_edits', {
    description: 'Apply non-overlapping line edits when the current revision guard matches. Before embedding a large generated byte table, follow the server large-asset guidance; ordinary long code alone does not trigger it. expectedRevisionEpoch is required for reload-safe source sync; degraded revision-only mode is reported and has a narrow reload-collision risk between the final pre-read and write.',
    inputSchema: {
      sessionId: sessionInput.sessionId,
      section: z.enum(SOURCE_SECTIONS),
      expectedRevision: z.number().int().min(0),
      expectedRevisionEpoch: z.string().min(1).max(128).optional(),
      edits: z.array(z.object({
        startLine: z.number().int().min(1),
        deleteLineCount: z.number().int().min(0),
        text: z.string().max(MAX_SOURCE_LENGTH),
      })).min(1).max(100),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId, section, expectedRevision, expectedRevisionEpoch, edits }) => {
    const replacementSize = edits.reduce((total, edit) => total + edit.text.length, 0);
    if (replacementSize > MAX_SOURCE_LENGTH) {
      throw new SourceSyncError(
        'SOURCE_LIMIT_EXCEEDED',
        `Combined replacement text exceeds ${MAX_SOURCE_LENGTH} characters`,
        {
          limit: MAX_SOURCE_LENGTH,
          actual: replacementSize,
          action: 'Split the operation into smaller guarded edits whose combined replacement stays within the limit.',
        },
      );
    }

    const context = sourceSyncContext(sessionId);
    const snapshot = await assertWriteBaseline(
      context, expectedRevision, expectedRevisionEpoch,
    );
    assertEditableSection(snapshot, section);
    const applied = applyLineEdits(snapshot[section], edits);
    if (applied.source.length > MAX_SOURCE_LENGTH) {
      throw new SourceSyncError(
        'SOURCE_LIMIT_EXCEEDED',
        `Edited ${section} source exceeds ${MAX_SOURCE_LENGTH} characters`,
        {
          section,
          limit: MAX_SOURCE_LENGTH,
          actual: applied.source.length,
          action: 'Reduce the resulting source size and retry against the same guarded snapshot.',
        },
      );
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
    await assertApplySnapshotUnchanged(context, snapshot, expectedRevisionEpoch);
    const updated = await sendGuardedProgram(program, expectedRevision, expectedRevisionEpoch, context);
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
    description: 'Compile or tokenize the current program without running it. For SLANG, output.generatedAsmLines and asmBytes describe temporary compilation output; validate does not store generated ASM in the program, while Run does.',
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

  server.registerTool('x1pen_send_key', {
    description: 'Send one allowlisted X1 virtual key down/hold/up lifecycle to the visible connected X1Pen emulator. code is a numeric Windows-compatible VK (for example 0x41=A, 0x0D=Enter, 0x20=Space); modifiers, chords and text strings are not supported.',
    inputSchema: {
      sessionId: sessionInput.sessionId,
      code: z.number().int().min(0).max(0xFF)
        .refine((value) => X1PEN_KEY_CODE_SET.has(value), 'code is not an allowlisted X1Pen virtual key'),
      durationMs: z.number().int().min(80).max(2_000).default(80)
        .describe('Requested hold duration in milliseconds; background tabs are rejected'),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId, code, durationMs }) => textResult(
    await bridge.sendCommand('sendKey', { code, durationMs }, sessionId),
  )));

  server.registerTool('x1pen_set_pad', {
    description: 'Set one X1 joystick port as an active-low raw byte in the visible connected emulator. Ports 1/2 map to PSG registers 14/15; bits 0..7 are Up, Down, Left, Right, Button 4, Button 2 (B), Button 1 (A), Button 3. Zero means pressed and 255 releases the remote contribution.',
    inputSchema: {
      sessionId: sessionInput.sessionId,
      port: z.union([z.literal(1), z.literal(2)]),
      bits: z.number().int().min(0).max(0xFF),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, handleTool(async ({ sessionId, port, bits }) => textResult(
    await bridge.sendCommand('setPad', { port, bits }, sessionId),
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

  const closeServer = server.close.bind(server);
  server.close = async () => {
    baselines.clear();
    return closeServer();
  };
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
  const transport = new StdioServerTransport();
  process.stdin.once('end', () => close().catch(() => {}));
  process.stdin.once('close', () => close().catch(() => {}));
  await server.connect(transport);
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
