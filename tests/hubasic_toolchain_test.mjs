import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import vm from 'node:vm';

// X1Pen's HuBASIC toolchain against the real SLANG-compiler tools. The page's scripts run here
// with the committed bundle (assets/hubasic/<current>/, the same .NET wasm the page loads):
// hubasic2sl and slangc from the bundle, X1Pen's JS assembler, and the bundle's Hu-BASIC disk
// builder or X1Pen's SLFS disk builder. tests/fixtures/hubasic holds what slangbuild and
// AILZ80ASM made from the bundle's testdata (written by scripts/import-hubasic-bundle.mjs).

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = join(repoRoot, 'tests', 'fixtures', 'hubasic');
const current = JSON.parse(readFileSync(join(repoRoot, 'assets', 'hubasic', 'current.json'), 'utf8'));
const bundleDir = join(repoRoot, 'assets', 'hubasic', current.revision);
const manifest = JSON.parse(readFileSync(join(bundleDir, 'manifest.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(fixtureDir, 'expected.json'), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');

// The page fetches hubasic/... next to x1pen.html; serve those from assets/hubasic/.
function makeFetch(overrides = {}) {
  return async (url) => {
    const path = String(url);
    if (path in overrides) {
      const body = overrides[path];
      if (body === 404) return { ok: false, status: 404 };
      return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(body).buffer };
    }
    if (!path.startsWith('hubasic/')) return { ok: false, status: 404 };
    const file = join(repoRoot, 'assets', path);
    if (!existsSync(file)) return { ok: false, status: 404 };
    const bytes = readFileSync(file);
    return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  };
}

function loadPage({ hostname = 'x1.example.test', fetchOverrides } = {}) {
  const context = {
    console, TextEncoder, TextDecoder, URL, URLSearchParams, atob,
    // The page has one realm; the .NET runtime checks byte arrays with instanceof Uint8Array
    Uint8Array, ArrayBuffer,
    location: { hostname, search: '', href: pathToFileURL(join(repoRoot, 'assets', 'x1pen.html')).href },
    fetch: makeFetch(fetchOverrides),
  };
  context.window = context;
  vm.createContext(context);
  for (const file of ['x1pen_z80asm.js', 'x1pen_slfs_disk.js', 'disk_container.js', 'disk_fs.js', 'x1pen_slang_wasm.js', 'x1pen_hubasic.js']) {
    vm.runInContext(readFileSync(join(repoRoot, 'html', file), 'utf8'), context, {
      filename: file,
      // x1pen_slang_wasm.js imports the bundle's dotnet.js
      importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
    });
  }
  return context;
}

const page = loadPage();
const wasm = page.X1PenSlangWasm;
const runtimeText = (env) => Object.fromEntries(manifest.envs[env].libraries.map((lib) =>
  [lib, readFileSync(join(bundleDir, 'runtime', lib), 'utf8')]));
const fixtureFiles = (name) => expected.programs[name].files.map((f) => ({
  name: f.name, kind: f.kind, bytes: new Uint8Array(readFileSync(join(fixtureDir, f.file))),
}));
// The page always converts PROGRAM.BAS; the fixtures were converted under their own names, which
// also name the boot file
const build = (source, options = {}, files = [], sourceName) =>
  page.X1PenHuBasic.build(source, options, files, sourceName ? { sourceName } : undefined);

test('the committed bundle and fixtures belong to one clean SLANG-compiler revision', () => {
  assert.equal(manifest.slangCompilerRevision, current.revision);
  assert.equal(expected.revision, current.revision,
    'fixtures belong to another revision; re-run scripts/import-hubasic-bundle.mjs');
  assert.equal(manifest.dirty, false, 'assets/hubasic must not contain a bundle built from uncommitted sources');
  assert.equal(expected.basAbi, manifest.basAbi);
  assert.equal(expected.basFileAbi, manifest.basFileAbi);
  assert.ok(existsSync(join(bundleDir, '_framework', 'dotnet.js')));
  for (const env of ['x1native_slfs', 'x1native_hufs']) {
    assert.ok(Object.values(expected.programs).some((p) => p.env === env), `a fixture for ${env}`);
  }
});

test('the bundle loads and reports its revision', async () => {
  const info = await page.X1PenHuBasic.load();
  assert.equal(info.revision, current.revision);
  assert.equal(info.basAbi, manifest.basAbi);
  assert.equal(info.basFileAbi, manifest.basFileAbi);
  assert.equal(info.slangcVersion, manifest.slangcVersion);
  assert.equal(info.hubasic2slVersion, manifest.hubasic2slVersion);
});

for (const name of Object.keys(expected.programs)) {
  test(`${name}: the page's toolchain makes the same program and disk as slangbuild`, async () => {
    const want = expected.programs[name];
    const result = await build(readFileSync(join(fixtureDir, `${name}.BAS`), 'utf8'), want.transpileOptions, fixtureFiles(name), `${name}.BAS`);
    assert.equal(result.ok, true, `${name}: ${result.stage}: ${result.message}`);
    assert.equal(result.environment, want.env);
    assert.equal(result.sl, readFileSync(join(fixtureDir, `${name}.SL`), 'utf8'), `${name}: converter output`);
    assert.equal(Buffer.compare(Buffer.from(result.bytes), readFileSync(join(fixtureDir, `${name}.bin`))), 0, `${name}: program bytes`);
    assert.equal(result.workEnd, want.workEnd);
    assert.equal(result.diskMainName, want.diskMainName);
    assert.equal(result.d88.byteLength, 348848);
    assert.equal(sha256(result.d88), want.d88Sha256, `${name}: disk image`);
    assert.equal(result.filesUsed, want.env === 'x1native_hufs' ? want.files.length : 0);
  });
}

test('a program without file statements boots from SLFS and leaves the added files out', async () => {
  const files = [{ name: 'DATA.TXT', kind: 'text', bytes: new TextEncoder().encode('hello\n') }];
  const result = await build(readFileSync(join(fixtureDir, 'HELLO.BAS'), 'utf8'), {}, files, 'HELLO.BAS');
  assert.equal(result.ok, true);
  assert.equal(result.environment, 'x1native_slfs');
  assert.equal(result.filesIgnored, 1);
  assert.equal(result.filesUsed, 0);
  assert.equal(sha256(result.d88), expected.programs.HELLO.d88Sha256);
});

test('a Hu-BASIC disk puts the program first in consecutive clusters, whatever is added', async () => {
  // About 15 clusters of program and many files given in reverse name order
  const program = new Uint8Array(60000).map((_, i) => (i * 31) & 0xff);
  const files = [];
  for (let i = 29; i >= 0; i--) {
    files.push({ name: `F${String(i).padStart(2, '0')}.DAT`, kind: ['text', 'bin', 'raw'][i % 3], bytes: new TextEncoder().encode(`file ${i}\n`.repeat(40 + i * 10)) });
  }
  const disk = await wasm.buildHufsDisk(program, { mainName: 'BIGMAIN', load: 0x1000, exec: 0x1000, files });
  assert.equal(disk.ok, true, disk.error);
  const container = page.XmilDiskContainer.openContainer(disk.d88.buffer, 'x.d88');
  const fs = new page.XmilDiskFS.HuBasicFS(container);
  const list = fs.listDirectory();
  const main = list.find((e) => e.name.trim() === 'BIGMAIN');
  assert.equal(main.startCluster, 2);
  assert.equal(main.mode & 0x41, 0x41, 'Bin and write-protected');
  fs._readFat();
  const chain = [];
  for (let c = main.startCluster; ; c = fs._fat[c]) { chain.push(c); if (fs._fat[c] >= 0x80) break; }
  assert.deepEqual(chain, Array.from({ length: chain.length }, (_, i) => 2 + i));
  assert.equal(chain.length, Math.ceil(60000 / 4096));
  // The IPL record (record 0) holds the program's place (a byte offset) and size: cluster 2 = 2 x 16 x 256
  const ipl = fs._readLogicalSector(1);   // logical sectors are 1-based
  assert.equal(new TextDecoder().decode(ipl.slice(1, 14)).trim(), 'BIGMAIN');
  assert.equal(ipl[0x12] | (ipl[0x13] << 8), 60000);
  assert.equal(ipl[0x1D] | (ipl[0x1E] << 8) | (ipl[0x1F] << 16), 2 * 16 * 256);
  const names = [...list.filter((e) => e !== main).map((e) => e.name.trim())];
  assert.deepEqual(names, [...names].sort());
  // Deleting and adding files (as a program does) leaves the program where it is
  for (const e of list.filter((x) => /^F0/.test(x.name))) fs.deleteFile(e);
  fs.addFile('NEW', 'DAT', new Uint8Array(9000).fill(7));
  fs._readFat();
  const again = [];
  for (let c = 2; ; c = fs._fat[c]) { again.push(c); if (fs._fat[c] >= 0x80) break; }
  assert.deepEqual(again, chain);
});

test('a Hu-BASIC disk that cannot be built stops at the disk stage', async () => {
  const fileio = readFileSync(join(fixtureDir, 'FILEIO.BAS'), 'utf8');
  const big = [];
  for (let i = 0; i < 6; i++) big.push({ name: `B${i}.BIN`, kind: 'bin', bytes: new Uint8Array(60000) });
  const full = await build(fileio, {}, big);
  assert.equal(full.ok, false);
  assert.equal(full.stage, 'disk');
  assert.match(full.message, /hufs: /);
  const tooBig = await wasm.buildHufsDisk(new Uint8Array(70000), { mainName: 'P', files: [] });
  assert.equal(tooBig.ok, false);
  const badName = await wasm.buildHufsDisk(new Uint8Array(1), { mainName: 'P', files: [{ name: 'A:B', kind: 'raw', bytes: new Uint8Array(1) }] });
  assert.equal(badName.ok, false);
});

test('CLEAR <address> and the reserved area are checked through the bundle', async () => {
  const fits = await build('10 CLEAR &HF000\n20 PRINT "A"\n');
  assert.equal(fits.ok, true, fits.message);
  assert.equal(fits.clearTop, 0xF000);
  const over = await build('10 CLEAR &H1100\n20 PRINT "A"\n');
  assert.equal(over.ok, false);
  assert.equal(over.stage, 'layout');
  assert.match(over.message, /HB0318/);
  const reserved = await wasm.checkLayout(100, 0xFFF0, null);
  assert.equal(reserved.ok, false);
  const plain = await wasm.checkLayout(100, 0x2000, null);
  assert.equal(plain.ok, true);
});

test('compile errors carry the line and column', async () => {
  const r = await wasm.compile('MAIN() {\n  A = ;\n}\n', 'x1native_slfs');
  assert.equal(r.ok, false);
  const error = r.diagnostics.find((d) => d.severity === 'error');
  assert.equal(error.file, 'PROGRAM.SL');
  assert.equal(error.line, 2);
  assert.ok(error.column > 0);
  assert.deepEqual(JSON.parse(JSON.stringify(wasm._parseLog([
    '/work/PROGRAM.SL:6:3: warning: something', '/slang/include/GRAPH.LIB:1:2: error: bad', 'slangc: error: cannot read', 'other',
  ]))), [
    { severity: 'warning', message: 'something', file: 'PROGRAM.SL', line: 6, column: 3 },
    { severity: 'error', message: 'bad', file: 'GRAPH.LIB', line: 1, column: 2 },
    { severity: 'error', message: 'cannot read', file: null, line: null, column: null },
  ]);
});

test('the x1native runtime branches on OS_TYPE, so a wrong value would silently assemble other code', () => {
  // libx1_base.asm and libx1_psg.asm use this form; X1Pen passes the manifest's checked osType.
  const source = '#IF NAME_SPACE_DEFAULT.OS_TYPE == 4\n NOP\n#ELSE\n HALT\n#ENDIF';
  assert.deepEqual([...page.X1PenZ80Asm.assemble(source, { OS_TYPE: 4 }).bytes], [0x00]);
  assert.deepEqual([...page.X1PenZ80Asm.assemble(source, { OS_TYPE: 0 }).bytes], [0x76]);
  const base = readFileSync(join(bundleDir, 'runtime', 'libx1_base.asm'), 'utf8');
  assert.match(base, /#IF NAME_SPACE_DEFAULT\.OS_TYPE == /);
});

test('the manifest check accepts only the environment values X1Pen boots', () => {
  const check = (mutate) => {
    const copy = JSON.parse(JSON.stringify(manifest));
    copy.dirty = false;
    mutate(copy, copy.envs.x1native_slfs, copy.envs.x1native_hufs);
    return () => wasm._checkManifest(copy);
  };
  assert.doesNotThrow(check(() => {}));
  assert.throws(check((m, e) => { e.osType = 0; }), /x1native_slfs\.osType/);
  assert.throws(check((m, e) => { e.envType = 2; }), /x1native_slfs\.envType/);
  assert.throws(check((m, e) => { e.defaultOrg = 0x100; }), /x1native_slfs\.defaultOrg/);
  assert.throws(check((m, e) => { delete e.defines.SLFS; }), /x1native_slfs\.defines\.SLFS/);
  assert.throws(check((m, e) => { e.diskTool = 'hufs-pack'; }), /x1native_slfs\.diskTool/);
  assert.throws(check((m) => { m.reservedStart = 0x10000; }), /reservedStart/);
  assert.throws(check((m, e) => { e.diskMainLoad = 0x100; }), /x1native_slfs\.diskMainLoad/);
  assert.throws(check((m, e) => { e.diskVolume = 'X'.repeat(17); }), /diskVolume/);
  assert.throws(check((m, e) => { e.libraries.push('liblsx_base.asm'); }), /x1native_slfs\.libraries/);
  assert.throws(check((m, e) => { e.libraries.push('../x.asm'); }), /libraries/);
  assert.throws(check((m, s, h) => { h.osType = 0; }), /x1native_hufs\.osType/);
  assert.throws(check((m, s, h) => { delete h.defines.HUFS; }), /x1native_hufs\.defines\.HUFS/);
  assert.throws(check((m, s, h) => { h.defines.SLFS = 1; }), /x1native_hufs\.defines\.SLFS/);
  assert.throws(check((m, s, h) => { h.diskTool = 'slfs-pack'; }), /x1native_hufs\.diskTool/);
  assert.throws(check((m, s, h) => { h.libraries.push('liblsx_file.asm'); }), /x1native_hufs\.libraries/);
  assert.throws(check((m) => { delete m.basFileAbi; }), /basFileAbi/);
  assert.throws(check((m) => { m.dirty = true; }), /uncommitted/);
  assert.throws(check((m) => { delete m.basAbi; }), /basAbi/);
  assert.throws(check((m) => { m.basAbi = 0; }), /basAbi/);
  assert.throws(check((m) => { delete m.envs.x1native_slfs; }), /x1native_slfs/);
  assert.throws(check((m) => { delete m.envs.x1native_hufs; }), /x1native_hufs/);
  // Local development may use a bundle built from uncommitted sources
  const dev = loadPage({ hostname: '127.0.0.1' });
  const dirty = JSON.parse(JSON.stringify(manifest));
  dirty.dirty = true;
  assert.doesNotThrow(() => dev.X1PenSlangWasm._checkManifest(dirty));
});

test('the converter output, the runtime and the manifest carry one BAS_ABI and one BAS_FABI', () => {
  const abi = manifest.basAbi;
  const runtime = runtimeText('x1native_hufs');
  for (const name of Object.keys(expected.programs)) {
    const sl = readFileSync(join(fixtureDir, `${name}.SL`), 'utf8');
    assert.match(sl, new RegExp(`\\bBAS_ABI_${abi}\\(\\)`), name);
    if (expected.programs[name].env === 'x1native_hufs') assert.match(sl, new RegExp(`\\bBAS_FABI_${manifest.basFileAbi}\\(\\)`), name);
  }
  assert.doesNotThrow(() => wasm._checkBasAbi(manifest, runtime, abi));
  assert.throws(() => wasm._checkBasAbi(manifest, runtime, abi + 1), /converter BAS_ABI/);
  assert.throws(() => wasm._checkBasAbi({ ...manifest, basAbi: abi + 1 }, runtime, abi + 1), /runtime BAS_ABI/);
  assert.throws(() => wasm._checkBasAbi({ ...manifest, basFileAbi: manifest.basFileAbi + 1 }, runtime, abi), /BAS_FABI/);
  const twice = { ...runtime, 'extra.asm': `; @name BAS_ABI_${abi}\nRET\n` };
  assert.throws(() => wasm._checkBasAbi(manifest, twice, abi), /runtime BAS_ABI/);
});

test('a program from another converter version does not build', async () => {
  const abi = manifest.basAbi;
  const sl = readFileSync(join(fixtureDir, 'HELLO.SL'), 'utf8').replace(`BAS_ABI_${abi}()`, `BAS_ABI_${abi + 1}()`);
  const compiled = await wasm.compile(sl, 'x1native_slfs');
  const env = manifest.envs.x1native_slfs;
  const failed = !compiled.ok ||
    page.X1PenZ80Asm.assemble(compiled.asm, { ENV_TYPE: env.envType, OS_TYPE: env.osType, ...env.defines },
      { allowTopLevelLocalLabels: true }).errors.length > 0;
  assert.ok(failed, 'a BAS_ABI mismatch must not build');
});

test('a bundle that does not match its directory, or is missing, is refused and can be retried', async () => {
  const wrong = loadPage({ fetchOverrides: { 'hubasic/current.json': JSON.stringify({ revision: 'f'.repeat(40) }) } });
  await assert.rejects(wrong.X1PenHuBasic.load(), (e) => e.code === 'HUBASIC_TOOLCHAIN_UNAVAILABLE');
  const overrides = { 'hubasic/current.json': 404 };
  const missing = loadPage({ fetchOverrides: overrides });
  await assert.rejects(missing.X1PenHuBasic.load(), /current\.json/);
  delete overrides['hubasic/current.json'];
  const info = await missing.X1PenHuBasic.load();
  assert.equal(info.revision, current.revision);
});

// The conversion options of the HuBASIC tab (html/x1pen_hubasic_options.js). Values from the vm
// context are compared as JSON (their objects belong to another realm).
const optionsContext = vm.createContext({});
optionsContext.window = optionsContext;
vm.runInContext(readFileSync(join(repoRoot, 'html', 'x1pen_hubasic_options.js'), 'utf8'), optionsContext);
const HuOptions = optionsContext.X1PenHuBasicOptions;
const json = (value) => JSON.parse(JSON.stringify(value));

test('untouched HuBASIC options pass nothing to the converter', () => {
  const defaults = HuOptions.defaults();
  assert.deepEqual(json(defaults), { wait: 'none', noLineNumbers: false, assumeDefint: false, stringLen: 255, dataBudget: 24576 });
  assert.deepEqual(json(HuOptions.changed(defaults)), {});
  assert.ok(HuOptions.isDefault(defaults));
  // Setting a value back to its default is the same as never setting it
  assert.deepEqual(json(HuOptions.changed(HuOptions.apply(defaults, { stringLen: 255, wait: 'none' }))), {});
});

test('HuBASIC options take the converter values, normalised', () => {
  const d = HuOptions.defaults();
  const changed = (patch) => json(HuOptions.changed(HuOptions.apply(d, patch)));
  assert.deepEqual(changed({ wait: 'line' }), { wait: 'line:1' });
  assert.deepEqual(changed({ wait: 'line:450' }), { wait: 'line:450' });
  assert.deepEqual(changed({ wait: 'frame:2' }), { wait: 'frame:2' });
  assert.deepEqual(changed({ wait: 'frame:65535' }), { wait: 'frame:65535' });
  assert.deepEqual(changed({ noLineNumbers: true, assumeDefint: true }), { noLineNumbers: true, assumeDefint: true });
  assert.deepEqual(changed({ stringLen: 1, dataBudget: 65535 }), { stringLen: 1, dataBudget: 65535 });
  assert.deepEqual(changed({ dataBudget: 1 }), { dataBudget: 1 });
  // null resets one key and leaves the others
  const set = HuOptions.apply(d, { wait: 'line:450', stringLen: 80 });
  assert.deepEqual(json(HuOptions.changed(HuOptions.apply(set, { wait: null }))), { stringLen: 80 });
  assert.deepEqual(json(HuOptions.parseWait('frame:3')), { mode: 'frame', count: 3 });
  assert.deepEqual(json(HuOptions.parseWait('none')), { mode: 'none', count: 0 });
});

test('a bad HuBASIC option is refused as a whole', () => {
  const current = HuOptions.apply(HuOptions.defaults(), { wait: 'line:450' });
  const before = JSON.stringify(current);
  const bad = [
    [{ wait: 'line:0' }, /wait/], [{ wait: 'line:65536' }, /wait/], [{ wait: 'line:x' }, /wait/],
    [{ wait: 'line:1:2' }, /wait/], [{ wait: 'none:1' }, /wait/], [{ wait: 5 }, /wait/], [{ wait: 'LINE:1' }, /wait/],
    [{ stringLen: 0 }, /stringLen/], [{ stringLen: 256 }, /stringLen/], [{ stringLen: 1.5 }, /stringLen/], [{ stringLen: '10' }, /stringLen/],
    [{ dataBudget: 0 }, /dataBudget/], [{ dataBudget: 65536 }, /dataBudget/], [{ dataBudget: NaN }, /dataBudget/],
    [{ noLineNumbers: 'true' }, /noLineNumbers/], [{ assumeDefint: 1 }, /assumeDefint/],
    [{ emitLineComments: true }, /unknown/], [{ inputEncoding: 'utf8' }, /unknown/],
    // A good key next to a bad one is not applied either
    [{ stringLen: 80, dataBudget: 0 }, /dataBudget/],
  ];
  for (const [patch, message] of bad) {
    assert.throws(() => HuOptions.apply(current, patch), message, JSON.stringify(patch));
  }
  for (const patch of [null, 'wait', [], undefined]) {
    assert.throws(() => HuOptions.apply(current, patch), /object/);
  }
  assert.equal(JSON.stringify(current), before);
});

test('saved HuBASIC options are read field by field and never throw', () => {
  const defaults = json(HuOptions.defaults());
  for (const saved of [null, undefined, 'x', 42, [], { wait: 'bogus', stringLen: 0, other: 1 }]) {
    assert.deepEqual(json(HuOptions.fromStored(saved)), defaults, JSON.stringify(saved));
  }
  assert.deepEqual(json(HuOptions.fromStored({ wait: 'line:450', stringLen: 999, noLineNumbers: true, extra: 'x' })),
    { ...defaults, wait: 'line:450', noLineNumbers: true });
});

// X1Pen ships SLANG-compiler's code in three places; both license notices must name them,
// and libfloat.asm (from z80float) is Apache 2.0, not MIT
test('the license notices cover the SLANG-compiler code X1Pen ships, with libfloat as Apache 2.0', () => {
  for (const path of [join(repoRoot, 'html', 'x1pen_slang_compiler.js'), join(repoRoot, 'assets', 'slang_runtime', 'libfloat.asm'),
    join(bundleDir, 'runtime', 'libfloat.asm'), join(bundleDir, '_framework', 'dotnet.js'),
    join(bundleDir, 'LICENSE'), join(bundleDir, 'LICENSE-APACHE-2.0.txt')]) {
    assert.ok(existsSync(path), path);
  }
  for (const file of ['THIRD_PARTY_LICENSES.md', 'html/licenses.html']) {
    const text = readFileSync(join(repoRoot, file), 'utf8');
    for (const word of ['SLANG-compiler', 'x1pen_slang_compiler.js', 'slang_runtime/', 'slang_include/', 'hubasic/',
      'libfloat.asm', 'z80float', 'Apache License 2.0', 'Copyright 2018 Zeda A.K. Thomas', '_framework/',
      'Copyright (c) .NET Foundation and Contributors',
      'YamlDotNet', 'Antoine Aubry and contributors',
      'third_party/slang-compiler/LICENSE.txt', 'third_party/slang-compiler/LICENSE-APACHE-2.0.txt']) {
      assert.ok(text.includes(word), `${file} names ${word}`);
    }
  }
  // Apache 2.0 wants the full text with the files, not a link: X1Pen ships SLANG-compiler's own copies
  const licenses = join(repoRoot, 'assets', 'third_party', 'slang-compiler');
  const apache = readFileSync(join(licenses, 'LICENSE-APACHE-2.0.txt'), 'utf8');
  assert.match(apache, /^\s*Apache License\s+Version 2\.0, January 2004/);
  assert.ok(apache.includes('TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION'));
  assert.ok(apache.includes('END OF TERMS AND CONDITIONS'));
  const license = readFileSync(join(licenses, 'LICENSE.txt'), 'utf8');
  for (const word of ['runtime/libfloat.asm', 'LICENSE-APACHE-2.0.txt', 'MIT License', 'Zeda A.K. Thomas']) {
    assert.ok(license.includes(word), `LICENSE.txt names ${word}`);
  }
  // into build/ (served locally) and dist/ (published), like licenses.html
  const build = readFileSync(join(repoRoot, 'build.sh'), 'utf8');
  assert.match(build, /cp -R "\$\{SCRIPT_DIR\}\/assets\/third_party" \.\/third_party/, 'the build puts them in build/');
  assert.match(build, /cp -R "\$\{SCRIPT_DIR\}\/assets\/third_party" "\$\{DIST_DIR\}\/third_party"/, 'the build publishes them');
});
