// Copy a SLANG-compiler browser bundle into assets/hubasic/<revision>/, make it current, and refresh
// the conformance fixtures in tests/fixtures/hubasic/ and tests/fixtures/slang/ from its testdata.
//
//   node scripts/import-hubasic-bundle.mjs <bundle-dir> [--allow-dirty]
//
// <bundle-dir> is the output of SLANG-compiler `scripts/build-hubasic-wasm.sh <dir>`:
// _framework/ (hubasic2sl, slangc and the Hu-BASIC disk builder as one .NET browser-wasm),
// runtime/ (.asm of every environment), env/, include/ (.LIB for the x1 environment), testdata/,
// LICENSE files and manifest.json. Build it from the SLANG-compiler main revision to import:
//   git -C <SLANG-compiler> worktree add <tmp> <revision>
//   AILZ80ASM_PATH=<SLANG-compiler>/tools/AILZ80ASM <tmp>/scripts/build-hubasic-wasm.sh <bundle-dir>
// The wasm and the runtime must come from one revision, so a bundle built from uncommitted sources
// (manifest dirty: true) is refused unless --allow-dirty is given for local experiments. Never
// commit such a bundle. Every copied file is checked against the manifest's sha256.
// Pre-compressed copies (*.br, *.gz) are skipped; the server compresses on the fly.
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
const slangFixtureDir = join(repoRoot, 'tests', 'fixtures', 'slang');

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
// x1native_slfs and x1native_hufs boot HuBASIC programs; x1 is the SLANG tab (LSX-Dodgers)
const ENV_NAMES = ['x1native_slfs', 'x1native_hufs', 'x1'];
for (const name of ENV_NAMES) {
  const env = manifest.envs && manifest.envs[name];
  if (!env || !Array.isArray(env.libraries) || env.libraries.length === 0) fail(`manifest has no ${name} libraries`);
}
if (!Array.isArray(manifest.files)) fail('manifest has no file list');
if (!Number.isInteger(manifest.basAbi) || manifest.basAbi <= 0) fail('manifest has no basAbi');
if (!Number.isInteger(manifest.basFileAbi) || manifest.basFileAbi <= 0) fail('manifest has no basFileAbi');
const testdata = manifest.testdata;
if (!testdata || testdata.env !== 'x1native_slfs' || !Array.isArray(testdata.cases) || testdata.cases.length === 0) {
  fail('manifest has no x1native_slfs testdata');
}
const hufsTestdata = manifest.hufsTestdata;
if (!hufsTestdata || hufsTestdata.env !== 'x1native_hufs' || !Array.isArray(hufsTestdata.cases) || hufsTestdata.cases.length === 0) {
  fail('manifest has no x1native_hufs testdata (hufsTestdata)');
}
const slangTestdata = manifest.slangTestdata;
if (!slangTestdata || slangTestdata.env !== 'x1' || !Array.isArray(slangTestdata.cases) || slangTestdata.cases.length === 0) {
  fail('manifest has no x1 testdata (slangTestdata)');
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
const required = ['_framework/dotnet.js', 'LICENSE', 'LICENSE-APACHE-2.0.txt'];
for (const name of ENV_NAMES) {
  required.push(`env/${name}.env`, ...manifest.envs[name].libraries.map((lib) => `runtime/${lib}`));
}
for (const name of required) {
  if (!bundleFiles.has(name)) fail(`bundle is missing ${name}`);
}
if (![...bundleFiles.keys()].some((path) => path.startsWith('include/'))) fail('bundle has no include/');

// assets/hubasic/<revision>/: what the page serves
const target = join(assetsDir, revision);
await rm(target, { recursive: true, force: true });
for (const [path, bytes] of bundleFiles) {
  // LICENSE and LICENSE-APACHE-2.0.txt at the root go with it
  if (!/^((_framework|runtime|env|include)\/|LICENSE[^/]*$)/.test(path) || /\.(br|gz)$/.test(path)) continue;
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

// tests/fixtures/hubasic/: what the real tools produced for the testdata programs. Disk images
// are kept as sha256 only, never copied into the repository.
// __WORKEND__ as printed in the AILZ80ASM listing: "  ADDR   __WORKEND__ EQU (...)" or "  ADDR   __WORKEND__:"
function workEnd(listing) {
  for (const line of listing.split(/\r?\n/)) {
    const m = line.match(/^\s+([0-9A-F]{4})\s+__WORKEND__(?::| EQU )/);
    if (m) return parseInt(m[1], 16);
  }
  return undefined;
}

function caseFile(testCase, key) {
  const bytes = bundleFiles.get(testCase[key]);
  if (!bytes) fail(`testdata ${testCase.name} has no ${key}`);
  return bytes;
}

await rm(fixtureDir, { recursive: true, force: true });
await mkdir(fixtureDir, { recursive: true });
const expected = {
  revision, basAbi: manifest.basAbi, basFileAbi: manifest.basFileAbi, assembler: manifest.assembler || null, programs: {},
};
let hubasicCount = 0;
for (const [set, envName] of [[testdata, 'x1native_slfs'], [hufsTestdata, 'x1native_hufs']]) {
  for (const testCase of set.cases) {
    if (!/^[A-Z0-9_]+$/.test(testCase.name) || expected.programs[testCase.name]) fail(`testdata has a bad or repeated name: ${testCase.name}`);
    const get = (key) => caseFile(testCase, key);
    const bin = get('bin');
    const end = workEnd(get('lst').toString('utf8'));
    if (end === undefined) fail(`testdata ${testCase.name} listing has no __WORKEND__`);
    await writeFile(join(fixtureDir, `${testCase.name}.BAS`), get('bas'));
    await writeFile(join(fixtureDir, `${testCase.name}.SL`), get('sl'));
    await writeFile(join(fixtureDir, `${testCase.name}.bin`), bin);
    const files = [];
    for (const add of testCase.hufsAdd || []) {
      if (envName !== 'x1native_hufs') fail(`testdata ${testCase.name} adds files to an ${envName} disk`);
      const bytes = bundleFiles.get(add.file);
      if (!bytes || typeof add.name !== 'string' || !['text', 'bin', 'raw', undefined].includes(add.kind)) {
        fail(`testdata ${testCase.name} has a bad hufsAdd entry`);
      }
      const fixtureName = `${testCase.name}.ADD.${files.length}`;
      await writeFile(join(fixtureDir, fixtureName), bytes);
      files.push({ name: add.name, kind: add.kind || 'raw', file: fixtureName });
    }
    expected.programs[testCase.name] = {
      env: envName,
      transpileOptions: set.transpileOptions || {},
      diskMainName: testCase.diskMainName,
      binLength: bin.length,
      workEnd: end,
      d88Sha256: sha256(get('d88')),
      files,
    };
    hubasicCount++;
  }
}
await writeFile(join(fixtureDir, 'expected.json'), `${JSON.stringify(expected, null, 2)}\n`);

// tests/fixtures/slang/: the SLANG tab environment (x1), compiled by slangbuild + AILZ80ASM
await rm(slangFixtureDir, { recursive: true, force: true });
await mkdir(slangFixtureDir, { recursive: true });
const slangExpected = {
  revision, env: 'x1', includePaths: slangTestdata.includePaths || [], assembler: manifest.assembler || null, programs: {},
};
for (const testCase of slangTestdata.cases) {
  if (!/^[A-Z0-9_]+$/.test(testCase.name) || slangExpected.programs[testCase.name]) fail(`slangTestdata has a bad or repeated name: ${testCase.name}`);
  const get = (key) => caseFile(testCase, key);
  await writeFile(join(slangFixtureDir, `${testCase.name}.SL`), get('sl'));
  await writeFile(join(slangFixtureDir, `${testCase.name}.ASM`), get('asm'));
  await writeFile(join(slangFixtureDir, `${testCase.name}.bin`), get('bin'));
  slangExpected.programs[testCase.name] = { binLength: get('bin').length, binSha256: sha256(get('bin')) };
}
if (Object.keys(slangExpected.programs).length === 0) fail('no x1 testdata to import');
await writeFile(join(slangFixtureDir, 'expected.json'), `${JSON.stringify(slangExpected, null, 2)}\n`);

console.log(`import-hubasic-bundle: assets/hubasic/${revision} is current (hubasic2sl ${manifest.hubasic2slVersion}, slangc ${manifest.slangcVersion}, BAS_ABI ${manifest.basAbi}, BAS_FABI ${manifest.basFileAbi}, dirty ${manifest.dirty}); ${hubasicCount} HuBASIC and ${Object.keys(slangExpected.programs).length} SLANG fixtures`);
console.log('import-hubasic-bundle: now review mcp/reference/hubasic.json for this revision (see the note at the top of this script)');
