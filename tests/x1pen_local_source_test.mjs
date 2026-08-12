import assert from 'node:assert/strict';
import { open, realpath, stat, appendFile, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  canonicalizeAllowedSourceRoots,
  readLocalUtf8Source,
} from '../mcp/x1pen-local-source.mjs';

let tempRoot;
let allowedRoot;
let outsideRoot;
let allowedRoots;

before(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'x1pen-local-source-'));
  allowedRoot = join(tempRoot, 'allowed');
  outsideRoot = join(tempRoot, 'outside');
  await mkdir(allowedRoot);
  await mkdir(outsideRoot);
  allowedRoots = canonicalizeAllowedSourceRoots([allowedRoot, allowedRoot]);
});

after(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

async function errorFrom(path, options = {}) {
  try {
    await readLocalUtf8Source(path, { allowedRoots, ...options });
  } catch (error) {
    return error;
  }
  assert.fail('expected local source read to fail');
}

test('reads a bounded regular UTF-8 source and returns metadata only', async () => {
  const path = join(allowedRoot, 'program.bas');
  await writeFile(path, '10 PRINT "日本語"\n20 END\n');
  const result = await readLocalUtf8Source(path, { allowedRoots });
  assert.equal(result.source, '10 PRINT "日本語"\n20 END\n');
  assert.equal(result.byteCount, Buffer.byteLength(result.source));
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  assert.equal(allowedRoots.length, 1);
});

test('strips one UTF-8 BOM and normalizes CRLF and lone CR to LF', async () => {
  const path = join(allowedRoot, 'windows.bas');
  const raw = Buffer.concat([
    Buffer.from([0xEF, 0xBB, 0xBF]),
    Buffer.from('10 PRINT "BOM"\r\n20 PRINT "CR"\r30 END\r\n'),
  ]);
  await writeFile(path, raw);
  const result = await readLocalUtf8Source(path, { allowedRoots });
  assert.equal(result.source, '10 PRINT "BOM"\n20 PRINT "CR"\n30 END\n');
  assert.equal(result.byteCount, raw.byteLength);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
});

test('rejects default-deny, traversal and symlink escapes without disclosing paths', async () => {
  const outside = join(outsideRoot, 'outside.bas');
  await writeFile(outside, '10 END\n');
  const unconfigured = await errorFrom(outside, { allowedRoots: [] });
  assert.equal(unconfigured.code, 'SOURCE_ROOT_NOT_CONFIGURED');

  const traversal = await errorFrom(join(allowedRoot, '..', 'outside', 'outside.bas'));
  assert.equal(traversal.code, 'SOURCE_PATH_NOT_ALLOWED');
  assert.equal(traversal.message.includes(tempRoot), false);

  const link = join(allowedRoot, 'escape.bas');
  await symlink(outside, link);
  const escaped = await errorFrom(link);
  assert.equal(escaped.code, 'SOURCE_PATH_NOT_ALLOWED');
  assert.equal(escaped.message.includes(outside), false);
});

test('fails fast when an allowed root is missing or is not a directory', async () => {
  assert.throws(
    () => canonicalizeAllowedSourceRoots([join(tempRoot, 'missing')]),
    /ENOENT/,
  );
  const regular = join(tempRoot, 'not-a-directory');
  await writeFile(regular, 'file');
  assert.throws(
    () => canonicalizeAllowedSourceRoots([regular]),
    /not a directory: .*not-a-directory/,
  );
});

test('rejects directories, oversized files, invalid UTF-8 and NUL', async () => {
  const directory = join(allowedRoot, 'directory');
  await mkdir(directory);
  assert.equal((await errorFrom(directory)).code, 'SOURCE_FILE_NOT_REGULAR');

  const oversized = join(allowedRoot, 'oversized.bas');
  await writeFile(oversized, '123456789');
  const tooLarge = await errorFrom(oversized, { maxBytes: 8 });
  assert.equal(tooLarge.code, 'SOURCE_FILE_TOO_LARGE');
  assert.equal(tooLarge.limit, 8);

  const invalid = join(allowedRoot, 'invalid.bas');
  await writeFile(invalid, Buffer.from([0xC3, 0x28]));
  assert.equal((await errorFrom(invalid)).code, 'SOURCE_FILE_INVALID_UTF8');

  const nul = join(allowedRoot, 'nul.bas');
  await writeFile(nul, '10\0END');
  assert.equal((await errorFrom(nul)).code, 'SOURCE_FILE_CONTAINS_NUL');
});

function mutatingIo(mutate) {
  return {
    realpath,
    stat,
    async open(path, flags) {
      const handle = await open(path, flags);
      let mutated = false;
      return {
        stat: (...args) => handle.stat(...args),
        close: () => handle.close(),
        async read(...args) {
          const result = await handle.read(...args);
          if (!mutated && result.bytesRead > 0) {
            mutated = true;
            await mutate();
          }
          return result;
        },
      };
    },
  };
}

test('rejects file growth and identity replacement during a read', async () => {
  const growing = join(allowedRoot, 'growing.bas');
  await writeFile(growing, '10 END\n');
  const growth = await errorFrom(growing, {
    io: mutatingIo(() => appendFile(growing, '20 END\n')),
  });
  assert.equal(growth.code, 'SOURCE_FILE_CHANGED');

  const replaced = join(allowedRoot, 'replaced.bas');
  const replacement = join(allowedRoot, 'replacement.tmp');
  await writeFile(replaced, '10 PRINT "OLD"\n');
  await writeFile(replacement, '10 PRINT "NEW"\n');
  const changed = await errorFrom(replaced, {
    io: mutatingIo(() => rename(replacement, replaced)),
  });
  assert.equal(changed.code, 'SOURCE_FILE_CHANGED');
});
