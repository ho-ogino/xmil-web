import { createHash } from 'node:crypto';

export const HASH_PATTERN = /^sha256-utf8-v1:[0-9a-f]{64}$/;
export const MAX_BASELINE_BYTES = 256 * 1024;
export const MAX_DIFF_LINES = 20_000;
export const MAX_DIFF_WORK = 250_000;

const AUTHORING_SECTIONS = Object.freeze({
  'basic+asm': ['basic', 'asm'],
  asm: ['asm'],
  slang: ['slang'],
});

export class SourceSyncError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SourceSyncError';
    this.code = code;
    this.component = 'mcp';
    Object.assign(this, details);
  }
}

export function sourceByteLength(source) {
  return Buffer.byteLength(source, 'utf8');
}

export function contentHash(source) {
  return `sha256-utf8-v1:${createHash('sha256').update(source, 'utf8').digest('hex')}`;
}

function updateLengthPrefixed(hash, value) {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  hash.update(length);
  hash.update(bytes);
}

export function authoringHash(snapshot) {
  const hash = createHash('sha256');
  hash.update('x1pen-authoring-v1\0', 'utf8');
  updateLengthPrefixed(hash, snapshot.sourceMode);
  for (const section of AUTHORING_SECTIONS[snapshot.sourceMode]) {
    updateLengthPrefixed(hash, section);
    updateLengthPrefixed(hash, snapshot[section]);
  }
  return `sha256-authoring-v1:${hash.digest('hex')}`;
}

export function sourceRole(sourceMode, section, source) {
  if (sourceMode === 'slang' && section === 'asm') {
    return source.length > 0 ? 'generated' : 'inactive';
  }
  return AUTHORING_SECTIONS[sourceMode].includes(section) ? 'authoring' : 'inactive';
}

export function sourceIdentities(snapshot) {
  const sections = {};
  for (const section of ['basic', 'asm', 'slang']) {
    const role = sourceRole(snapshot.sourceMode, section, snapshot[section]);
    const hash = contentHash(snapshot[section]);
    sections[section] = role === 'generated'
      ? { role, generatedContentHash: hash }
      : { role, contentHash: hash };
  }
  return { authoringHash: authoringHash(snapshot), sections };
}

function baselineKey(value) {
  return [
    value.instanceId,
    value.revisionEpoch,
    value.sourceMode,
    value.section,
    value.role,
    value.hash,
  ].join('\u0000');
}

export class SourceBaselineCache {
  constructor(options = {}) {
    this.maxEntryBytes = options.maxEntryBytes ?? MAX_BASELINE_BYTES;
    this.maxTotalBytes = options.maxTotalBytes ?? (4 * 1024 * 1024);
    this.maxEntries = options.maxEntries ?? 64;
    this.ttlMs = options.ttlMs ?? (15 * 60 * 1000);
    this.now = options.now || (() => Date.now());
    this.entries = new Map();
    this.totalBytes = 0;
  }

  rememberSnapshot(snapshot) {
    if (!snapshot.instanceId || !snapshot.revisionEpoch) return;
    const identities = sourceIdentities(snapshot);
    for (const section of ['basic', 'asm', 'slang']) {
      const source = snapshot[section];
      const bytes = sourceByteLength(source);
      if (bytes > this.maxEntryBytes) continue;
      const identity = identities.sections[section];
      const hash = identity.contentHash || identity.generatedContentHash;
      const entry = {
        instanceId: snapshot.instanceId,
        revisionEpoch: snapshot.revisionEpoch,
        revision: snapshot.revision,
        sourceMode: snapshot.sourceMode,
        section,
        role: identity.role,
        hash,
        source,
        bytes,
        touchedAt: this.now(),
      };
      const key = baselineKey(entry);
      const previous = this.entries.get(key);
      if (previous) this.totalBytes -= previous.bytes;
      this.entries.delete(key);
      this.entries.set(key, entry);
      this.totalBytes += bytes;
    }
    this.prune();
  }

  get(provenance) {
    this.prune();
    const key = baselineKey(provenance);
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    entry.touchedAt = this.now();
    this.entries.set(key, entry);
    return { ...entry };
  }

  retainInstances(instanceIds) {
    if (!instanceIds || instanceIds.size === 0) {
      this.clear();
      return;
    }
    for (const [key, entry] of this.entries) {
      if (!instanceIds.has(entry.instanceId)) this.delete(key, entry);
    }
  }

  prune() {
    const cutoff = this.now() - this.ttlMs;
    for (const [key, entry] of this.entries) {
      if (entry.touchedAt < cutoff) this.delete(key, entry);
    }
    while (this.entries.size > this.maxEntries || this.totalBytes > this.maxTotalBytes) {
      const first = this.entries.entries().next().value;
      if (!first) break;
      this.delete(first[0], first[1]);
    }
  }

  delete(key, entry) {
    this.entries.delete(key);
    this.totalBytes -= entry.bytes;
  }

  clear() {
    this.entries.clear();
    this.totalBytes = 0;
  }
}

function parseLines(source) {
  if (source.length === 0) return [];
  const parts = source.split('\n');
  const count = source.endsWith('\n') ? parts.length - 1 : parts.length;
  const lines = [];
  for (let index = 0; index < count; index++) {
    const hasLf = index < parts.length - 1;
    const raw = parts[index];
    const crlf = hasLf && raw.endsWith('\r');
    lines.push({
      content: crlf ? raw.slice(0, -1) : raw,
      terminator: hasLf ? (crlf ? 'crlf' : 'lf') : 'none',
    });
  }
  return lines;
}

function createOperations(baseLines, currentLines, maxWork, deadline) {
  let prefix = 0;
  while (prefix < baseLines.length && prefix < currentLines.length &&
      baseLines[prefix].content === currentLines[prefix].content) prefix++;

  let suffix = 0;
  while (suffix < baseLines.length - prefix && suffix < currentLines.length - prefix &&
      baseLines[baseLines.length - 1 - suffix].content === currentLines[currentLines.length - 1 - suffix].content) suffix++;

  const baseMiddle = baseLines.slice(prefix, baseLines.length - suffix);
  const currentMiddle = currentLines.slice(prefix, currentLines.length - suffix);
  const work = baseMiddle.length * currentMiddle.length;
  if (work > maxWork) {
    throw new SourceSyncError(
      'DIFF_LIMIT_EXCEEDED',
      `Diff requires ${work} comparison cells, exceeding the ${maxWork} work limit`,
      { action: 'Compare smaller source sections or establish a closer baseline.' },
    );
  }

  const columns = currentMiddle.length + 1;
  const matrix = new Uint32Array((baseMiddle.length + 1) * columns);
  for (let left = baseMiddle.length - 1; left >= 0; left--) {
    if ((left & 31) === 0 && Date.now() > deadline) {
      throw new SourceSyncError(
        'DIFF_LIMIT_EXCEEDED',
        'Diff exceeded its elapsed-time budget',
        { action: 'Compare smaller source sections or establish a closer baseline.' },
      );
    }
    for (let right = currentMiddle.length - 1; right >= 0; right--) {
      const offset = left * columns + right;
      matrix[offset] = baseMiddle[left].content === currentMiddle[right].content
        ? matrix[(left + 1) * columns + right + 1] + 1
        : Math.max(matrix[(left + 1) * columns + right], matrix[left * columns + right + 1]);
    }
  }

  const operations = [];
  let oldLine = 1;
  let newLine = 1;
  function push(type, oldValue, newValue) {
    operations.push({ type, oldLine, newLine, oldValue, newValue });
    if (type !== 'insert') oldLine++;
    if (type !== 'delete') newLine++;
  }
  for (let index = 0; index < prefix; index++) push('equal', baseLines[index], currentLines[index]);

  let left = 0;
  let right = 0;
  while (left < baseMiddle.length || right < currentMiddle.length) {
    if (left < baseMiddle.length && right < currentMiddle.length &&
        baseMiddle[left].content === currentMiddle[right].content) {
      push('equal', baseMiddle[left++], currentMiddle[right++]);
    } else if (right < currentMiddle.length &&
        (left === baseMiddle.length || matrix[left * columns + right + 1] >= matrix[(left + 1) * columns + right])) {
      push('insert', null, currentMiddle[right++]);
    } else {
      push('delete', baseMiddle[left++], null);
    }
  }

  for (let index = suffix; index > 0; index--) {
    const baseIndex = baseLines.length - index;
    const currentIndex = currentLines.length - index;
    push('equal', baseLines[baseIndex], currentLines[currentIndex]);
  }
  return operations;
}

function hunkRanges(operations, contextLines) {
  const changed = [];
  for (let index = 0; index < operations.length; index++) {
    if (operations[index].type !== 'equal') changed.push(index);
  }
  if (changed.length === 0) return [];
  const ranges = [];
  let start = Math.max(0, changed[0] - contextLines);
  let end = Math.min(operations.length, changed[0] + contextLines + 1);
  for (const index of changed.slice(1)) {
    const nextStart = Math.max(0, index - contextLines);
    const nextEnd = Math.min(operations.length, index + contextLines + 1);
    if (nextStart <= end) end = Math.max(end, nextEnd);
    else {
      ranges.push([start, end]);
      start = nextStart;
      end = nextEnd;
    }
  }
  ranges.push([start, end]);
  return ranges;
}

function renderHunk(operations, start, end) {
  const selected = operations.slice(start, end);
  const oldStart = selected[0]?.oldLine || 1;
  const newStart = selected[0]?.newLine || 1;
  const oldCount = selected.filter((entry) => entry.type !== 'insert').length;
  const newCount = selected.filter((entry) => entry.type !== 'delete').length;
  const lines = [`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`];
  for (const entry of selected) {
    const value = entry.type === 'insert' ? entry.newValue : entry.oldValue;
    const prefix = entry.type === 'insert' ? '+' : (entry.type === 'delete' ? '-' : ' ');
    lines.push(prefix + value.content);
    if (entry.type !== 'equal' && value.terminator === 'none') {
      lines.push('\\ No newline at end of file');
    }
  }
  return lines.join('\n');
}

export function createBoundedLineDiff(baseSource, currentSource, options = {}) {
  const maxSourceBytes = options.maxSourceBytes ?? MAX_BASELINE_BYTES;
  const maxLines = options.maxLines ?? MAX_DIFF_LINES;
  const maxWork = options.maxWork ?? MAX_DIFF_WORK;
  const maxElapsedMs = options.maxElapsedMs ?? 50;
  const contextLines = options.contextLines ?? 3;
  const maxHunks = options.maxHunks ?? 20;
  const maxCharacters = options.maxCharacters ?? (32 * 1024);
  const baseBytes = sourceByteLength(baseSource);
  const currentBytes = sourceByteLength(currentSource);
  if (baseBytes > maxSourceBytes || currentBytes > maxSourceBytes) {
    throw new SourceSyncError(
      'DIFF_LIMIT_EXCEEDED',
      `Diff inputs exceed the ${maxSourceBytes} byte per-source limit`,
      { action: 'Use bounded source reads to compare the relevant region.' },
    );
  }

  const baseLines = parseLines(baseSource);
  const currentLines = parseLines(currentSource);
  if (baseLines.length > maxLines || currentLines.length > maxLines) {
    throw new SourceSyncError(
      'DIFF_LIMIT_EXCEEDED',
      `Diff inputs exceed the ${maxLines} line per-source limit`,
      { action: 'Use bounded source reads to compare the relevant region.' },
    );
  }

  const operations = createOperations(baseLines, currentLines, maxWork, Date.now() + maxElapsedMs);
  const lineEndingChanges = [];
  let totalLineEndingChanges = 0;
  let addedLines = 0;
  let deletedLines = 0;
  for (const entry of operations) {
    if (entry.type === 'insert') addedLines++;
    if (entry.type === 'delete') deletedLines++;
    if (entry.type === 'equal' && entry.oldValue.terminator !== entry.newValue.terminator) {
      totalLineEndingChanges++;
      if (lineEndingChanges.length < 100) {
        lineEndingChanges.push({
          oldLine: entry.oldLine,
          newLine: entry.newLine,
          oldTerminator: entry.oldValue.terminator,
          newTerminator: entry.newValue.terminator,
        });
      }
    }
  }

  const ranges = hunkRanges(operations, contextLines);
  const rendered = [];
  let characters = 0;
  let truncated = ranges.length > maxHunks;
  for (const [start, end] of ranges.slice(0, maxHunks)) {
    const hunk = renderHunk(operations, start, end);
    const separator = rendered.length === 0 ? 0 : 1;
    if (characters + separator + hunk.length > maxCharacters) {
      truncated = true;
      break;
    }
    rendered.push(hunk);
    characters += separator + hunk.length;
  }

  return {
    diff: rendered.join('\n'),
    baseLineCount: baseLines.length,
    currentLineCount: currentLines.length,
    addedLines,
    deletedLines,
    lineEndingChanges,
    totalLineEndingChanges,
    lineEndingChangesTruncated: totalLineEndingChanges > lineEndingChanges.length,
    hunkCount: rendered.length,
    totalHunks: ranges.length,
    truncated,
    limits: { maxSourceBytes, maxLines, maxWork, maxElapsedMs, contextLines, maxHunks, maxCharacters },
  };
}
