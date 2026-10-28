// Copy a HuBASIC bundle into assets/hubasic/<revision>/, make it current, and refresh the
// conformance fixtures in tests/fixtures/hubasic/ from the bundle's testdata.
//
//   node scripts/import-hubasic-bundle.mjs <bundle-dir> [--allow-dirty]
//
// <bundle-dir> is the output of SLANG-compiler `scripts/build-hubasic-wasm.sh <dir>`:
// _framework/ (hubasic2sl browser-wasm), runtime/ (x1native .asm), env/, testdata/ and
// manifest.json. Build it from the SLANG-compiler main revision to import, for example:
//   git -C <SLANG-compiler> worktree add <tmp> <revision>
//   AILZ80ASM_PATH=<SLANG-compiler>/tools/AILZ80ASM <tmp>/scripts/build-hubasic-wasm.sh <bundle-dir>
// The wasm converter and the runtime must come from one revision, so a bundle built from
// uncommitted sources (manifest dirty: true) is refused unless --allow-dirty is given for local
// experiments. Never commit such a bundle. Every copied file is checked against the manifest's
// sha256. Pre-compressed copies (*.br, *.gz) are skipped; the server compresses on the fly.
//
// The x1pen-mcp HuBASIC reference (mcp/reference/hubasic.json) describes one bundle revision.
// After importing another one, review it against that revision's hubasic2sl sources and
// docs/HUBASIC.md (never the HuBASIC manual), then update runtimeRevision and hubasic2slVersion
// of its profile in mcp/reference/manifest.json and the revision in its sourceUrls;
// tests/x1pen_reference_test.mjs fails until then.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(repoRoot, 'assets', 'hubasic');
const fixtureDir = join(repoRoot, 'tests', 'fixtures', 'hubasic');

const args = process.argv.slice(2);
const allowDirty = args.includes('--allow-dirty');
const bundleDir = args.find((arg) => !arg.startsWith('--'));
if (!bundleDir) {
  console.error('usage: node scripts/import-hubasic-bundle.mjs <bundle-dir> [--allow-dirty]');
  process.exit(2);
}

function fail(message) {
  console.error(`import-hubasic-bundle: ${message}`);
  process.exit(1);
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const manifest = JSON.parse(await readFile(join(bundleDir, 'manifest.json'), 'utf8'));
const revision = manifest.slangCompilerRevision;
if (typeof revision !== 'string' || !/^[0-9a-f]{40}$/.test(revision)) fail('manifest has no 40-hex slangCompilerRevision');
if (manifest.dirty !== false) {
  if (!allowDirty) fail(`bundle ${revision} was built from uncommitted sources (dirty); rebuild from a clean SLANG-compiler checkout`);
  console.warn('import-hubasic-bundle: WARNING: importing a dirty bundle for local use only; do not commit it');
}
const env = manifest.envs && manifest.envs.x1native_slfs;
if (!env || !Array.isArray(env.libraries)) fail('manifest has no x1native_slfs libraries');
if (!Array.isArray(manifest.files)) fail('manifest has no file list');
if (!Number.isInteger(manifest.basAbi) || manifest.basAbi <= 0) fail('manifest has no basAbi');
const testdata = manifest.testdata;
if (!testdata || testdata.env !== 'x1native_slfs' || !Array.isArray(testdata.cases) || testdata.cases.length === 0) {
  fail('manifest has no x1native_slfs testdata');
}

// Verify every listed file before copying anything
const bundleFiles = new Map();
for (const file of manifest.files) {
  if (typeof file.path !== 'string' || file.path.split('/').includes('..') || file.path.startsWith('/')) {
    fail(`manifest lists an unsafe path: ${file.path}`);
  }
  const bytes = await readFile(join(bundleDir, file.path));
  if (bytes.length !== file.size || sha256(bytes) !== file.sha256) fail(`${file.path} does not match the manifest`);
  bundleFiles.set(file.path, bytes);
}
for (const name of ['_framework/dotnet.js', ...env.libraries.map((lib) => `runtime/${lib}`)]) {
  if (!bundleFiles.has(name)) fail(`bundle is missing ${name}`);
}

// assets/hubasic/<revision>/: what the page serves
const target = join(assetsDir, revision);
await rm(target, { recursive: true, force: true });
for (const [path, bytes] of bundleFiles) {
  if (!/^(_framework|runtime|env)\//.test(path) || /\.(br|gz)$/.test(path)) continue;
  await mkdir(dirname(join(target, path)), { recursive: true });
  await writeFile(join(target, path), bytes);
}
await copyFile(join(bundleDir, 'manifest.json'), join(target, 'manifest.json'));
for (const entry of await readdir(assetsDir, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name !== revision) {
    await rm(join(assetsDir, entry.name), { recursive: true, force: true });
    console.log(`import-hubasic-bundle: removed ${entry.name}`);
  }
}
await writeFile(join(assetsDir, 'current.json'), `${JSON.stringify({ revision }, null, 2)}\n`);

// tests/fixtures/hubasic/: what the real tools produced for the testdata programs
// Work-area symbols as printed in the AILZ80ASM listing: "  ADDR   NAME EQU (__WORK__ + N)"
function workSymbols(listing) {
  const symbols = {};
  for (const line of listing.split(/\r?\n/)) {
    const m = line.match(/^\s+([0-9A-F]{4})\s+([A-Za-z_][A-Za-z0-9_]*) EQU \(__WORK__ \+ \d+\)/);
    if (m) symbols[m[2].toUpperCase()] = parseInt(m[1], 16);
    const w = line.match(/^\s+([0-9A-F]{4})\s+(__WORK__|__WORKEND__):/);
    if (w) symbols[w[2]] = parseInt(w[1], 16);
  }
  return symbols;
}

await rm(fixtureDir, { recursive: true, force: true });
await mkdir(fixtureDir, { recursive: true });
const expected = { revision, basAbi: manifest.basAbi, assembler: manifest.assembler || null, programs: {} };
for (const testCase of testdata.cases) {
  const get = (key) => {
    const bytes = bundleFiles.get(testCase[key]);
    if (!bytes) fail(`testdata ${testCase.name} has no ${key}`);
    return bytes;
  };
  const bin = get('bin');
  const symbols = workSymbols(get('lst').toString('utf8'));
  if (symbols.__WORKEND__ === undefined) fail(`testdata ${testCase.name} listing has no __WORKEND__`);
  await writeFile(join(fixtureDir, `${testCase.name}.BAS`), get('bas'));
  await writeFile(join(fixtureDir, `${testCase.name}.SL`), get('sl'));
  await writeFile(join(fixtureDir, `${testCase.name}.bin`), bin);
  expected.programs[testCase.name] = {
    diskMainName: testCase.diskMainName,
    binLength: bin.length,
    workSymbols: symbols,
    d88Sha256: sha256(get('d88')),
  };
}
await writeFile(join(fixtureDir, 'expected.json'), `${JSON.stringify(expected, null, 2)}\n`);
console.log(`import-hubasic-bundle: assets/hubasic/${revision} is current (hubasic2sl ${manifest.hubasic2slVersion}, BAS_ABI ${manifest.basAbi}, dirty ${manifest.dirty}); ${testdata.cases.length} fixtures`);
console.log('import-hubasic-bundle: now review mcp/reference/hubasic.json for this revision (see the note at the top of this script)');
