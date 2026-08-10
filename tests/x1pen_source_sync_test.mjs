import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  SourceBaselineCache,
  contentHash,
  createBoundedLineDiff,
  sourceIdentities,
} from '../mcp/x1pen-source-sync.mjs';

test('content hashes use exact UTF-8 bytes without newline normalization', () => {
  for (const source of ['', 'A', '日本語', 'A\n', 'A\r\n', 'A\0B']) {
    const expected = createHash('sha256').update(Buffer.from(source, 'utf8')).digest('hex');
    assert.equal(contentHash(source), `sha256-utf8-v1:${expected}`);
  }
  assert.notEqual(contentHash('A\n'), contentHash('A\r\n'));
});

test('SLANG generated ASM does not change authoringHash', () => {
  const snapshot = {
    sourceMode: 'slang', basic: '', asm: 'ORG $100\nRET', slang: 'main() BEGIN\nEND;',
    revision: 1, revisionEpoch: 'epoch-a', instanceId: 'tab-a',
  };
  const first = sourceIdentities(snapshot);
  const generatedChanged = sourceIdentities({ ...snapshot, asm: 'ORG $200\nRET', revision: 2 });
  const authoringChanged = sourceIdentities({ ...snapshot, slang: 'main() BEGIN\n  PRINT("X");\nEND;', revision: 2 });
  assert.equal(first.authoringHash, generatedChanged.authoringHash);
  assert.notEqual(first.sections.asm.generatedContentHash, generatedChanged.sections.asm.generatedContentHash);
  assert.notEqual(first.authoringHash, authoringChanged.authoringHash);
});

test('bounded diff reports line content and line-ending-only changes deterministically', () => {
  const content = createBoundedLineDiff('A\r\nB', 'A\nX\nB\n', { contextLines: 1 });
  assert.equal(content.addedLines, 1);
  assert.equal(content.deletedLines, 0);
  assert.match(content.diff, /\+X/);
  assert.deepEqual(content.lineEndingChanges, [
    { oldLine: 1, newLine: 1, oldTerminator: 'crlf', newTerminator: 'lf' },
    { oldLine: 2, newLine: 3, oldTerminator: 'none', newTerminator: 'lf' },
  ]);
  assert.equal(content.truncated, false);

  const finalNewline = createBoundedLineDiff('A', 'A\n');
  assert.equal(finalNewline.diff, '');
  assert.equal(finalNewline.totalLineEndingChanges, 1);
  assert.equal(finalNewline.lineEndingChanges[0].oldTerminator, 'none');
  assert.equal(finalNewline.lineEndingChanges[0].newTerminator, 'lf');
});

test('bounded diff fails before excessive quadratic work', () => {
  const left = Array.from({ length: 600 }, (_, index) => `A${index}`).join('\n');
  const right = Array.from({ length: 600 }, (_, index) => `B${index}`).join('\n');
  assert.throws(
    () => createBoundedLineDiff(left, right),
    (error) => error.code === 'DIFF_LIMIT_EXCEEDED',
  );
});

test('baseline cache is epoch-aware, bounded, and expires entries', () => {
  let now = 1_000;
  const cache = new SourceBaselineCache({
    maxEntryBytes: 20, maxTotalBytes: 20, maxEntries: 3, ttlMs: 100,
    now: () => now,
  });
  const snapshot = {
    sourceMode: 'basic+asm', basic: '10 END', asm: '', slang: '',
    revision: 1, revisionEpoch: 'epoch-a', instanceId: 'tab-a',
  };
  cache.rememberSnapshot(snapshot);
  const hash = contentHash(snapshot.basic);
  assert.equal(cache.get({
    instanceId: 'tab-a', revisionEpoch: 'epoch-a', sourceMode: 'basic+asm',
    section: 'basic', role: 'authoring', hash,
  }).source, snapshot.basic);
  assert.equal(cache.get({
    instanceId: 'tab-a', revisionEpoch: 'epoch-b', sourceMode: 'basic+asm',
    section: 'basic', role: 'authoring', hash,
  }), null);
  now += 101;
  assert.equal(cache.get({
    instanceId: 'tab-a', revisionEpoch: 'epoch-a', sourceMode: 'basic+asm',
    section: 'basic', role: 'authoring', hash,
  }), null);
});
