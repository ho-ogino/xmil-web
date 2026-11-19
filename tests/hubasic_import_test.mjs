import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// scripts/import-hubasic-bundle.mjs checks a whole bundle, and starts it the way the page does,
// before it changes anything; a failure at any later step puts everything back. It runs here
// against temporary destinations (IMPORT_HUBASIC_ROOT), never this checkout. The bundles are made
// from the committed one (its .NET framework, runtime and environments) with small testdata.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const importer = join(repoRoot, 'scripts', 'import-hubasic-bundle.mjs');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const revision = JSON.parse(readFileSync(join(repoRoot, 'assets', 'hubasic', 'current.json'), 'utf8')).revision;
const committedDir = join(repoRoot, 'assets', 'hubasic', revision);
const committed = JSON.parse(readFileSync(join(committedDir, 'manifest.json'), 'utf8'));

function snapshot(root) {
  const out = {};
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) { out[`${relative(root, path)}/`] = 'dir'; walk(path); } else out[relative(root, path)] = sha256(readFileSync(path));
    }
  };
  walk(root);
  return out;
}

// A destination with another bundle already imported (or nothing at all)
function fakeDestination({ empty = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'x1pen-dest-'));
  if (empty) return root;
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const before = 'b'.repeat(40);
  write('assets/hubasic/current.json', JSON.stringify({ revision: before }));
  write(`assets/hubasic/${before}/manifest.json`, '{}');
  write('tests/fixtures/hubasic/expected.json', '{"before":true}');
  write('tests/fixtures/slang/expected.json', '{"before":true}');
  return root;
}

// The committed bundle's files (linked, not copied) and small testdata that `mutate` can break.
// skip: bundle files to leave out of the bundle and its file list.
function fakeBundle(mutate = () => {}, { skip = () => false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'x1pen-bundle-'));
  const files = {};
  const put = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
    files[path] = Buffer.from(text);
  };
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      const rel = relative(committedDir, path);
      if (entry.isDirectory()) { walk(path); continue; }
      if (rel === 'manifest.json' || skip(rel)) continue;
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      symlinkSync(path, join(dir, rel));
      files[rel] = readFileSync(path);
    }
  };
  walk(committedDir);
  for (const name of ['HELLO', 'FILEIO']) {
    put(`testdata/${name}.BAS`, '10 END');
    put(`testdata/${name}.SL`, 'MAIN() {}');
    put(`testdata/${name}.bin`, 'BIN');
    put(`testdata/${name}.LST`, '      3533                     __WORKEND__ EQU (__WORK__ + 4012)\n');
    put(`testdata/${name}.d88`, 'D88');
  }
  put('testdata/FILEIO.GREET.TXT', 'HELLO\n');
  put('testdata/slang/SCREEN.SL', 'MAIN() {}');
  put('testdata/slang/SCREEN.ASM', ' RET');
  put('testdata/slang/SCREEN.bin', 'BIN');
  const caseOf = (name) => ({
    name, bas: `testdata/${name}.BAS`, sl: `testdata/${name}.SL`, bin: `testdata/${name}.bin`,
    lst: `testdata/${name}.LST`, d88: `testdata/${name}.d88`, diskMainName: name,
  });
  const manifest = {
    ...JSON.parse(JSON.stringify(committed)),
    testdata: { env: 'x1native_slfs', cases: [caseOf('HELLO')] },
    hufsTestdata: { env: 'x1native_hufs', cases: [{ ...caseOf('FILEIO'), hufsAdd: [{ name: 'GREET.TXT', file: 'testdata/FILEIO.GREET.TXT', kind: 'text' }] }] },
    slangTestdata: { env: 'x1', includePaths: ['include'], cases: [{ name: 'SCREEN', sl: 'testdata/slang/SCREEN.SL', asm: 'testdata/slang/SCREEN.ASM', bin: 'testdata/slang/SCREEN.bin' }] },
    files: Object.entries(files).map(([path, bytes]) => ({ path, size: bytes.length, sha256: sha256(bytes) })),
  };
  mutate(manifest);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}

function runImport(bundle, root, env = {}) {
  return spawnSync(process.execPath, ['--no-warnings', importer, bundle],
    { encoding: 'utf8', env: { ...process.env, ...env, IMPORT_HUBASIC_ROOT: root } });
}

function assertImportChangesNothing({ mutate, skip, env = {}, empty = false }, stderrPattern) {
  const root = fakeDestination({ empty });
  const before = snapshot(root);
  const bundle = fakeBundle(mutate, { skip });
  try {
    const run = runImport(bundle, root, env);
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stderr, stderrPattern);
    // Nothing changed and nothing was left behind (staging, previous copies, the lock); an empty
    // destination may keep the empty folders the lock was made in
    const after = snapshot(root);
    if (empty) {
      for (const key of Object.keys(after)) assert.ok(/\/$/.test(key), `${key} is left in an empty destination`);
    } else {
      assert.deepEqual(after, before);
    }
  } finally {
    rmSync(bundle, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

for (const empty of [false, true]) {
  test(`a good bundle is imported into ${empty ? 'an empty destination' : 'a destination with another bundle'}, and the lock is released`, () => {
    const root = fakeDestination({ empty });
    const bundle = fakeBundle();
    try {
      const run = runImport(bundle, root);
      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.deepEqual(JSON.parse(readFileSync(join(root, 'assets/hubasic/current.json'), 'utf8')), { revision });
      assert.deepEqual(readdirSync(join(root, 'assets/hubasic')).sort(), [revision, 'current.json']);
      assert.deepEqual(readdirSync(join(root, 'tests/fixtures')).sort(), ['hubasic', 'slang']);
      assert.ok(readdirSync(join(root, 'tests/fixtures/hubasic')).includes('FILEIO.ADD.0'));
      assert.equal(readFileSync(join(root, 'assets/hubasic', revision, 'manifest.json'), 'utf8'),
        readFileSync(join(bundle, 'manifest.json'), 'utf8'), 'the manifest that was checked is the one published');
    } finally {
      rmSync(bundle, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('an import stops while another one holds the lock', () => {
  const root = fakeDestination();
  writeFileSync(join(root, 'assets/hubasic/.import.lock'), '1\n');
  const before = snapshot(root);
  const bundle = fakeBundle();
  try {
    const run = runImport(bundle, root);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /another import is running/);
    assert.deepEqual(snapshot(root), before);
  } finally {
    rmSync(bundle, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [what, mutate] of [
  ['a hufsAdd entry names a file that is not in the bundle', (m) => { m.hufsTestdata.cases[0].hufsAdd[0].file = 'testdata/NONE.TXT'; }],
  ['a hufsAdd entry has an unknown kind', (m) => { m.hufsTestdata.cases[0].hufsAdd[0].kind = 'ascii'; }],
  ['a SLANG case has no binary', (m) => { m.slangTestdata.cases[0].bin = 'testdata/slang/NONE.bin'; }],
  ['a listing has no __WORKEND__', (m) => { m.testdata.cases[0].lst = 'testdata/FILEIO.GREET.TXT'; }],
]) {
  test(`a bundle where ${what} changes nothing`, () => {
    // Stopped at the testdata, not earlier at the bundle's own files
    assertImportChangesNothing({ mutate }, /^import-hubasic-bundle: .*(testdata|slangTestdata|hufsAdd|__WORKEND__)/);
  });
}

test('a bundle the page would refuse is not imported', () => {
  assertImportChangesNothing({ mutate: (m) => { m.envs.x1native_hufs.defaultOrg = 0x2000; } },
    /^import-hubasic-bundle: the page would refuse this bundle: .*x1native_hufs\.defaultOrg/);
  // The runtime markers too: a file ABI the runtime does not carry
  assertImportChangesNothing({ mutate: (m) => { m.basFileAbi += 1; } },
    /^import-hubasic-bundle: the page would refuse this bundle: .*BAS_FABI/);
});

test('a bundle missing a file its .NET framework needs is not imported', () => {
  assertImportChangesNothing({ skip: (rel) => /^_framework\/dotnet\.native\.[^/]*\.wasm$/.test(rel) },
    /^import-hubasic-bundle: nothing changed: the page could not start this bundle/);
});

for (const empty of [false, true]) {
  for (const failAfter of [1, 2, 3, 4, 5, 6]) {
    test(`a failure after step ${failAfter} puts ${empty ? 'an empty destination' : 'everything'} back`, () => {
      assertImportChangesNothing({ env: { IMPORT_HUBASIC_FAIL_AFTER: String(failAfter) }, empty },
        /^import-hubasic-bundle: nothing changed: stopped after step/);
    });
  }
}
