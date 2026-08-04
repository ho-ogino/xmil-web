import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { test } from 'node:test';
import {
  getReferenceEntries,
  searchReference,
  validateReferenceData,
} from '../mcp/x1pen-reference.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadBrowserGlobal(filename, exportName) {
  const context = { window: {} };
  vm.runInNewContext(readFileSync(join(repoRoot, filename), 'utf8'), context, { filename });
  return context.window[exportName];
}

function loadSlangVfs() {
  const vfs = {};
  for (const directory of ['assets/slang_runtime', 'assets/slang_include']) {
    for (const filename of readdirSync(join(repoRoot, directory))) {
      if (/\.(?:asm|lib)$/i.test(filename)) {
        vfs[filename] = readFileSync(join(repoRoot, directory, filename), 'utf8');
      }
    }
  }
  return vfs;
}

test('reference data has unique IDs and known profiles', () => {
  const validation = validateReferenceData();
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.manifest.schemaVersion, 1);
  assert.ok(validation.entries.length >= 25);
});

test('reference search is deterministic, filtered and summary-only', () => {
  const first = searchReference({ language: 'slang', query: 'FLOAT return', maxResults: 3 });
  const second = searchReference({ language: 'slang', query: 'FLOAT return', maxResults: 3 });
  assert.deepEqual(first, second);
  assert.ok(first.matches.length > 0);
  assert.ok(first.matches.every((match) => match.language === 'slang'));
  assert.ok(first.matches.every((match) => match.syntax === undefined));
});

test('reference detail output honors maxCharacters', () => {
  const result = getReferenceEntries({
    ids: ['slang.program.structure', 'slang.include.graph-soroban'],
    maxCharacters: 900,
  });
  assert.ok(result.entries.length < 2);
  assert.ok(result.omittedIds.length > 0);
  assert.equal(result.truncated, true);
});

test('bundled FuzzyBASIC examples are accepted by the X1Pen tokenizer', () => {
  const tokenizer = loadBrowserGlobal('html/x1pen_tokenizer.js', 'X1PenTokenizer');
  const { entries } = validateReferenceData();
  const examples = entries
    .filter((entry) => entry.language === 'fuzzybasic')
    .flatMap((entry) => entry.examples || []);
  assert.ok(examples.length >= 2);
  for (const example of examples) {
    const bytes = tokenizer.tokenizeProgram(example.source);
    assert.ok(bytes.length > 2, `${example.title} must produce program bytes`);
  }
});

test('bundled SLANG examples compile with the exact X1Pen compiler and VFS', () => {
  const compiler = loadBrowserGlobal('html/x1pen_slang_compiler.js', 'X1PenSlangCompiler');
  const vfs = loadSlangVfs();
  const { entries } = validateReferenceData();
  const examples = entries
    .filter((entry) => entry.language === 'slang')
    .flatMap((entry) => entry.examples || []);
  assert.ok(examples.length >= 2);
  for (const example of examples) {
    const result = compiler.compile(example.source, vfs, {
      defaultOrg: 0x100,
      codeReadonly: false,
      defines: { ENV_TYPE: 1 },
    });
    assert.equal(result.errors.length, 0, `${example.title}: ${JSON.stringify(result.errors)}`);
    assert.ok(result.asm.length > 0, `${example.title} must generate ASM`);
  }
});

test('documented include API names exist in the bundled libraries', () => {
  const selectedApis = {
    'CHIPLIB.LIB': ['CHIP_INIT', 'CHIP_SET_MAP', 'CHIP_SPR_ADD'],
    'SPRLIB.LIB': ['SPR_INIT', 'SPR_SET_POS', 'SPR_UPDATE'],
    'TILELIB.LIB': ['TILE_INIT', 'TILE_SET_SCROLL', 'TILE_INVALIDATE'],
    'TILESPR.LIB': ['TILE_SYNC_SPR_PAGE'],
    'UILIB.LIB': ['UI_AT', 'UI_PUTS', 'UI_BOX'],
  };
  const documented = JSON.stringify(getReferenceEntries({
    ids: ['slang.include.tile-sprite', 'slang.include.chiplib', 'slang.include.ui'],
    maxCharacters: 32 * 1024,
  }).entries);

  for (const [filename, names] of Object.entries(selectedApis)) {
    const source = readFileSync(join(repoRoot, 'assets/slang_include', filename), 'utf8');
    for (const name of names) {
      assert.match(source, new RegExp(`\\b${name}\\b`), `${name} must exist in ${filename}`);
      assert.ok(documented.includes(name), `${name} must be covered by the reference`);
    }
  }
});

test('PCG reference matches the bundled X1 runtime contract', () => {
  const runtime = readFileSync(join(repoRoot, 'assets/slang_runtime/libx1_pcg.asm'), 'utf8');
  const details = JSON.stringify(getReferenceEntries({
    ids: ['fuzzybasic.x1.pcg-definition', 'slang.x1.pcg-definition', 'slang.include.tile-sprite'],
    maxCharacters: 32 * 1024,
  }).entries);
  for (const name of ['PCGDEF', 'PCGDEFS']) {
    assert.match(runtime, new RegExp(`; @name ${name}\\b`));
    assert.ok(details.includes(name));
  }
  assert.match(runtime, /HL = STARTIDX .* DE = ADDR \(24 bytes\/tile\), BC = COUNT/);
  assert.ok(details.includes('24-byte'));
  assert.ok(details.includes('Blue, Red, Green'));
});
