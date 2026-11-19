import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// scripts/import-hubasic-bundle.mjs checks a whole bundle before it changes anything: a bundle
// whose testdata is wrong must leave the committed bundle, current.json and fixtures as they are.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function snapshot(dir) {
  const out = {};
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else out[relative(repoRoot, path)] = sha256(readFileSync(path));
    }
  };
  walk(dir);
  return out;
}

// The environments of the committed bundle: a fake bundle with them passes the page's checks
const committed = JSON.parse(readFileSync(join(repoRoot, 'assets', 'hubasic',
  JSON.parse(readFileSync(join(repoRoot, 'assets', 'hubasic', 'current.json'), 'utf8')).revision, 'manifest.json'), 'utf8'));

// A small bundle with every file the importer asks for, and testdata that `mutate` can break
function fakeBundle(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'x1pen-bundle-'));
  const files = {};
  const put = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
    files[path] = Buffer.from(text);
  };
  const envs = JSON.parse(JSON.stringify(committed.envs));
  for (const [name, env] of Object.entries(envs)) {
    put(`env/${name}.env`, name);
    for (const lib of env.libraries) if (!files[`runtime/${lib}`]) put(`runtime/${lib}`, `; ${lib}`);
  }
  put('include/GRAPH.LIB', '// lib');
  put('_framework/dotnet.js', '// dotnet');
  put('LICENSE', 'MIT');
  put('LICENSE-APACHE-2.0.txt', 'Apache');
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
    slangCompilerRevision: 'a'.repeat(40), dirty: false, hubasic2slVersion: 'test', slangcVersion: 'test',
    basAbi: committed.basAbi, basFileAbi: committed.basFileAbi, loadAddress: committed.loadAddress,
    reservedStart: committed.reservedStart, envs,
    testdata: { env: 'x1native_slfs', cases: [caseOf('HELLO')] },
    hufsTestdata: { env: 'x1native_hufs', cases: [{ ...caseOf('FILEIO'), hufsAdd: [{ name: 'GREET.TXT', file: 'testdata/FILEIO.GREET.TXT', kind: 'text' }] }] },
    slangTestdata: { env: 'x1', includePaths: ['include'], cases: [{ name: 'SCREEN', sl: 'testdata/slang/SCREEN.SL', asm: 'testdata/slang/SCREEN.ASM', bin: 'testdata/slang/SCREEN.bin' }] },
    files: Object.entries(files).map(([path, bytes]) => ({ path, size: bytes.length, sha256: sha256(bytes) })),
  };
  mutate(manifest);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}

function assertImportChangesNothing(mutate, env = {}, stderrPattern) {
  const watched = [join(repoRoot, 'assets', 'hubasic'), join(repoRoot, 'tests', 'fixtures', 'hubasic'), join(repoRoot, 'tests', 'fixtures', 'slang')];
  const before = Object.assign({}, ...watched.map(snapshot));
  const bundle = fakeBundle(mutate);
  try {
    const run = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'import-hubasic-bundle.mjs'), bundle],
      { encoding: 'utf8', env: { ...process.env, ...env } });
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stderr, stderrPattern);
    assert.deepEqual(Object.assign({}, ...watched.map(snapshot)), before);
    for (const dir of watched) assert.ok(statSync(dir).isDirectory());
    for (const dir of [join(repoRoot, 'tests', 'fixtures'), join(repoRoot, 'assets', 'hubasic')]) {
      assert.deepEqual(readdirSync(dir).filter((name) => /^\.staging|\.previous$|\.next$/.test(name)), [], `${dir} has leftovers`);
    }
  } finally {
    rmSync(bundle, { recursive: true, force: true });
  }
}

for (const [what, mutate] of [
  ['a hufsAdd entry names a file that is not in the bundle', (m) => { m.hufsTestdata.cases[0].hufsAdd[0].file = 'testdata/NONE.TXT'; }],
  ['a hufsAdd entry has an unknown kind', (m) => { m.hufsTestdata.cases[0].hufsAdd[0].kind = 'ascii'; }],
  ['a SLANG case has no binary', (m) => { m.slangTestdata.cases[0].bin = 'testdata/slang/NONE.bin'; }],
  ['a listing has no __WORKEND__', (m) => { m.testdata.cases[0].lst = 'testdata/FILEIO.GREET.TXT'; }],
]) {
  test(`a bundle where ${what} changes nothing`, () => {
    // Stopped at the testdata, not earlier at the bundle's own files
    assertImportChangesNothing(mutate, {}, /^import-hubasic-bundle: .*(testdata|slangTestdata|hufsAdd|__WORKEND__)/);
  });
}

test('a bundle the page would refuse is not imported', () => {
  assertImportChangesNothing((m) => { m.envs.x1native_hufs.defaultOrg = 0x2000; }, {},
    /^import-hubasic-bundle: the page would refuse this bundle: .*x1native_hufs\.defaultOrg/);
});

for (const failAfter of [1, 2, 3, 4]) {
  test(`a failure after publishing step ${failAfter} puts everything back`, () => {
    assertImportChangesNothing(() => {}, { IMPORT_HUBASIC_FAIL_AFTER: String(failAfter) },
      /^import-hubasic-bundle: could not publish the bundle, nothing changed: stopped after step/);
  });
}
