import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import vm from 'node:vm';

// X1Pen's JS toolchain (SLANG compiler, Z80 assembler, SLFS disk builder) against the real
// SLANG-compiler tools: tests/fixtures/hubasic holds hubasic2sl output (.SL) and slangbuild
// results for the bundle revision in assets/hubasic/current.json
// (written by scripts/import-hubasic-bundle.mjs from the bundle's testdata).

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = join(repoRoot, 'tests', 'fixtures', 'hubasic');
const current = JSON.parse(readFileSync(join(repoRoot, 'assets', 'hubasic', 'current.json'), 'utf8'));
const bundleDir = join(repoRoot, 'assets', 'hubasic', current.revision);
const manifest = JSON.parse(readFileSync(join(bundleDir, 'manifest.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(fixtureDir, 'expected.json'), 'utf8'));
const env = manifest.envs.x1native_slfs;

function loadScripts(locationHost) {
  const context = { console, TextEncoder, URL, URLSearchParams, location: { hostname: locationHost, search: '' } };
  context.window = context;
  vm.createContext(context);
  for (const file of ['x1pen_slang_compiler.js', 'x1pen_z80asm.js', 'x1pen_slfs_disk.js', 'x1pen_hubasic.js']) {
    vm.runInContext(readFileSync(join(repoRoot, 'html', file), 'utf8'), context, { filename: file });
  }
  return context;
}

const page = loadScripts('x1.example.test');
const runtimeVfs = Object.fromEntries(env.libraries.map((lib) => [lib, readFileSync(join(bundleDir, 'runtime', lib), 'utf8')]));

// The same constants x1pen_hubasic.js passes (and slangc/slangbuild use) for both stages
const constants = { ENV_TYPE: env.envType, OS_TYPE: env.osType, ...env.defines };

function buildFixture(name, predefined = constants) {
  const compiled = page.X1PenSlangCompiler.compile(readFileSync(join(fixtureDir, `${name}.SL`), 'utf8'), runtimeVfs, {
    defaultOrg: env.defaultOrg, codeReadonly: false, defines: constants,
  });
  assert.equal(compiled.errors.length, 0, `${name}: SLANG compile errors ${JSON.stringify(compiled.errors)}`);
  return page.X1PenZ80Asm.assemble(compiled.asm, predefined, { allowTopLevelLocalLabels: true });
}

// Nearest work-area symbol at or below an address, as [name, offset]
function workSymbolAt(table, address) {
  let best = null;
  for (const [name, at] of Object.entries(table)) {
    if (name === '__WORKEND__' || at > address) continue;
    if (!best || at > best[1]) best = [name, at];
  }
  return best && address - best[1] < 0x400 ? `${best[0]}+${address - best[1]}` : null;
}

test('the committed bundle and fixtures belong to one clean SLANG-compiler revision', () => {
  assert.equal(manifest.slangCompilerRevision, current.revision);
  assert.equal(expected.revision, current.revision,
    'fixtures belong to another revision; re-run scripts/import-hubasic-bundle.mjs');
  assert.equal(manifest.dirty, false, 'assets/hubasic must not contain a bundle built from uncommitted sources');
  assert.equal(expected.basAbi, manifest.basAbi);
  assert.ok(existsSync(join(bundleDir, '_framework', 'dotnet.js')));
});

for (const name of Object.keys(expected.programs)) {
  test(`${name}: JS toolchain matches slangbuild except for the work-area order`, () => {
    const want = expected.programs[name];
    const ref = readFileSync(join(fixtureDir, `${name}.bin`));
    const result = buildFixture(name);
    // One assembler error shifts every later address, so compare only the first one.
    assert.equal(result.errors[0], undefined, `${name}: first assembler error`);
    const got = Buffer.from(result.bytes);
    assert.equal(result.org, manifest.loadAddress);
    assert.equal(got.length, want.binLength);
    assert.equal(result.symbols['NAME_SPACE_DEFAULT.__WORKEND__'], want.workSymbols.__WORKEND__);

    const jsWork = {};
    for (const symbol of Object.keys(want.workSymbols)) {
      const at = result.symbols[`NAME_SPACE_DEFAULT.${symbol}`];
      if (typeof at === 'number') jsWork[symbol] = at;
    }
    const unexplained = [];
    for (let i = 0; i < got.length; i++) {
      if (got[i] === ref[i]) continue;
      // The differing byte is the low or the high byte of an address operand
      const start = [i - 1, i].find((at) => {
        if (at < 0 || at + 1 >= got.length) return false;
        const refName = workSymbolAt(want.workSymbols, ref.readUInt16LE(at));
        return refName !== null && refName === workSymbolAt(jsWork, got.readUInt16LE(at));
      });
      if (start === undefined) {
        unexplained.push(`$${(manifest.loadAddress + i).toString(16)}`);
      } else {
        i = start + 1;
      }
    }
    assert.deepEqual(unexplained, [], `${name}: bytes that are not the same work-area symbol`);
  });

  test(`${name}: SLFS disk image is byte-identical to slangbuild`, () => {
    const d88 = page.X1PenSlfsDisk.buildSlfsD88(readFileSync(join(fixtureDir, `${name}.bin`)), {
      mainName: expected.programs[name].diskMainName,
      loadAddr: env.diskMainLoad,
      execAddr: env.diskMainExec,
      volumeName: env.diskVolume,
    });
    assert.equal(d88.byteLength, 348848);
    assert.equal(createHash('sha256').update(Buffer.from(d88)).digest('hex'), expected.programs[name].d88Sha256);
  });
}

test('the x1native runtime branches on OS_TYPE, so a wrong value would silently assemble other code', () => {
  // libx1_base.asm and libx1_psg.asm use this form; X1Pen passes the manifest's checked osType.
  const source = '#IF NAME_SPACE_DEFAULT.OS_TYPE == 4\n NOP\n#ELSE\n HALT\n#ENDIF';
  assert.deepEqual([...page.X1PenZ80Asm.assemble(source, { OS_TYPE: env.osType }).bytes], [0x00]);
  assert.deepEqual([...page.X1PenZ80Asm.assemble(source, { OS_TYPE: 0 }).bytes], [0x76]);
  const base = readFileSync(join(bundleDir, 'runtime', 'libx1_base.asm'), 'utf8');
  assert.match(base, /#IF NAME_SPACE_DEFAULT\.OS_TYPE == /);
});

test('the manifest check accepts only the x1native_slfs values X1Pen boots', () => {
  const check = (mutate) => {
    const copy = JSON.parse(JSON.stringify(manifest));
    copy.dirty = false;
    mutate(copy, copy.envs.x1native_slfs);
    return () => page.X1PenHuBasic._checkManifest(copy);
  };
  assert.doesNotThrow(check(() => {}));
  assert.throws(check((m, e) => { e.osType = 0; }), /osType/);
  assert.throws(check((m, e) => { e.envType = 2; }), /envType/);
  assert.throws(check((m, e) => { e.defaultOrg = 0x100; }), /defaultOrg/);
  assert.throws(check((m, e) => { delete e.defines.SLFS; }), /defines\.SLFS/);
  assert.throws(check((m) => { m.reservedStart = 0x10000; }), /reservedStart/);
  assert.throws(check((m, e) => { e.diskMainLoad = 0x100; }), /diskMainLoad/);
  assert.throws(check((m, e) => { e.diskVolume = 'X'.repeat(17); }), /diskVolume/);
  assert.throws(check((m, e) => { e.libraries.push('liblsx_base.asm'); }), /libraries/);
  assert.throws(check((m, e) => { e.libraries.push('../x.asm'); }), /libraries/);
  assert.throws(check((m) => { m.dirty = true; }), /uncommitted/);
  assert.throws(check((m) => { delete m.basAbi; }), /basAbi/);
  assert.throws(check((m) => { m.basAbi = 0; }), /basAbi/);
  assert.throws(check((m) => { delete m.envs.x1native_slfs; }), /x1native_slfs/);
  // Local development may use a bundle built from uncommitted sources
  const dev = loadScripts('127.0.0.1');
  const dirty = JSON.parse(JSON.stringify(manifest));
  dirty.dirty = true;
  assert.doesNotThrow(() => dev.X1PenHuBasic._checkManifest(dirty));
});

test('the converter output, the runtime and the manifest carry one BAS_ABI number', () => {
  const abi = manifest.basAbi;
  for (const name of Object.keys(expected.programs)) {
    assert.match(readFileSync(join(fixtureDir, `${name}.SL`), 'utf8'), new RegExp(`\\bBAS_ABI_${abi}\\(\\)`), name);
  }
  assert.doesNotThrow(() => page.X1PenHuBasic._checkBasAbi(manifest, runtimeVfs, abi));
  assert.throws(() => page.X1PenHuBasic._checkBasAbi(manifest, runtimeVfs, abi + 1), /converter BAS_ABI/);
  assert.throws(() => page.X1PenHuBasic._checkBasAbi({ ...manifest, basAbi: abi + 1 }, runtimeVfs, abi + 1), /runtime BAS_ABI/);
  const twice = { ...runtimeVfs, 'extra.asm': `; @name BAS_ABI_${abi}\nRET\n` };
  assert.throws(() => page.X1PenHuBasic._checkBasAbi(manifest, twice, abi), /runtime BAS_ABI/);

  // A program from another converter version stops at compile or assemble, never runs
  const sl = readFileSync(join(fixtureDir, 'HELLO.SL'), 'utf8').replace(`BAS_ABI_${abi}()`, `BAS_ABI_${abi + 1}()`);
  const compiled = page.X1PenSlangCompiler.compile(sl, runtimeVfs, { defaultOrg: env.defaultOrg, codeReadonly: false, defines: constants });
  const failed = compiled.errors.length > 0 ||
    page.X1PenZ80Asm.assemble(compiled.asm, constants, { allowTopLevelLocalLabels: true }).errors.length > 0;
  assert.ok(failed, 'a BAS_ABI mismatch must not build');
});
