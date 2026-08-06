import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  const x1penSource = readFileSync(join(repoRoot, 'html/x1pen.js'), 'utf8');
  const vfs = {};
  for (const [variable, directory] of [
    ['runtimeFiles', 'assets/slang_runtime'],
    ['includeFiles', 'assets/slang_include'],
  ]) {
    for (const filename of extractVfsFiles(x1penSource, variable)) {
      vfs[filename] = readFileSync(join(repoRoot, directory, filename), 'utf8');
    }
  }
  return vfs;
}

function extractVfsFiles(source, variable) {
  const block = source.match(new RegExp(`var ${variable} = \\[([\\s\\S]*?)\\n\\s*\\];`));
  assert.ok(block, `${variable} must be present in x1pen.js`);
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function extractSlangIncludeSymbols(source) {
  const symbols = new Set();
  for (const block of source.matchAll(/^MACHINE\b([\s\S]*?);/gmi)) {
    for (const match of block[1].matchAll(/([@A-Za-z_][@A-Za-z0-9_$^]*)\s*\(/g)) {
      symbols.add(match[1]);
    }
  }
  for (const match of source.matchAll(/^([@A-Za-z_][@A-Za-z0-9_$^]*)\s*(?::(?:BYTE|WORD|FLOAT))?\s*\([^;\n]*\)/gmi)) {
    symbols.add(match[1]);
  }
  return symbols;
}

test('reference data has unique IDs and known profiles', () => {
  const validation = validateReferenceData();
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.manifest.schemaVersion, 2);
  assert.ok(validation.entries.length >= 50);
});

test('reference search is deterministic, filtered and summary-only', () => {
  const first = searchReference({ language: 'slang', query: 'FLOAT return', maxResults: 3 });
  const second = searchReference({ language: 'slang', query: 'FLOAT return', maxResults: 3 });
  assert.deepEqual(first, second);
  assert.ok(first.matches.length > 0);
  assert.equal(first.matchMode, 'all');
  assert.ok(first.matches.every((match) => match.language === 'slang'));
  assert.ok(first.matches.every((match) => match.syntax === undefined));
});

test('reference search finds exact symbols and falls back to partial terms', () => {
  for (const query of ['A%[I]', 'memory array', 'メモリ配列']) {
    const result = searchReference({ language: 'fuzzybasic', query, maxResults: 3 });
    assert.equal(result.matchMode, 'all');
    assert.equal(result.matches[0].id, 'fuzzybasic.memory.arrays');
  }

  const partial = searchReference({
    language: 'fuzzybasic',
    query: 'memory array term-that-does-not-exist',
    maxResults: 3,
  });
  assert.equal(partial.matchMode, 'partial');
  assert.equal(partial.matches[0].id, 'fuzzybasic.memory.arrays');
});

test('representative Japanese and English queries reach dedicated FuzzyBASIC entries', () => {
  const cases = new Map([
    ['PSG 音を鳴らす', 'fuzzybasic.x1.sound'],
    ['play sound', 'fuzzybasic.x1.sound'],
    ['ジョイスティック', 'fuzzybasic.x1.input'],
    ['open file', 'fuzzybasic.files.lsx'],
    ['配列', 'fuzzybasic.memory.arrays'],
    ['乱数', 'fuzzybasic.functions.math-bit'],
    ['random number', 'fuzzybasic.functions.math-bit'],
    ['サブルーチン', 'fuzzybasic.subroutines.proc'],
    ['線を描く', 'fuzzybasic.x1.graphics-magic'],
    ['draw line', 'fuzzybasic.x1.graphics-magic'],
    ['ファイルを開く', 'fuzzybasic.files.lsx'],
    ['文字列操作', 'fuzzybasic.functions.memory-text'],
    ['画面クリア', 'fuzzybasic.io.console'],
  ]);

  for (const [query, expectedId] of cases) {
    const result = searchReference({ language: 'fuzzybasic', query, maxResults: 3 });
    assert.equal(result.matches[0]?.id, expectedId, query);
  }
});

test('representative Japanese and English queries reach dedicated SLANG entries', () => {
  const cases = new Map([
    ['浮動小数点関数', 'slang.runtime.float'],
    ['square root', 'slang.runtime.float'],
    ['マシン語', 'slang.machine.calling-convention'],
    ['メモリ配列', 'slang.machine.system-access'],
    ['ファイルを読む', 'slang.runtime.lsx-io-files'],
    ['open file', 'slang.runtime.lsx-io-files'],
    ['音を鳴らす', 'slang.x1.psg'],
    ['play sound', 'slang.x1.psg'],
    ['タイルマップ', 'slang.include.tile-sprite'],
    ['線を描く', 'slang.include.graph-soroban'],
    ['圧縮データ', 'slang.x1.assets-compression'],
    ['垂直同期', 'slang.x1.timing'],
    ['ゲームライブラリ', 'slang.x1.sgl'],
  ]);

  for (const [query, expectedId] of cases) {
    const result = searchReference({ language: 'slang', query, maxResults: 3 });
    assert.equal(result.matches[0]?.id, expectedId, query);
  }
});

test('dedicated entries rank above the exhaustive keyword catalog', () => {
  for (const [language, query, expectedId] of [
    ['fuzzybasic', 'CIRCLE', 'fuzzybasic.x1.graphics-magic'],
    ['fuzzybasic', 'PEEK POKE', 'fuzzybasic.machine.memory-io'],
    ['slang', 'PSG_INIT', 'slang.x1.psg'],
    ['slang', 'TILE_SET_SCROLL', 'slang.include.tile-sprite'],
    ['slang', 'FSQRT', 'slang.runtime.float'],
  ]) {
    const result = searchReference({ language, query, maxResults: 3 });
    assert.equal(result.matches[0]?.id, expectedId, query);
  }
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
  assert.ok(examples.length >= 9);
  for (const example of examples) {
    const bytes = tokenizer.tokenizeProgram(example.source);
    assert.ok(bytes.length > 2, `${example.title} must produce program bytes`);
  }
});

test('every FuzzyBASIC reference entry is reachable through relatedIds', () => {
  const entries = validateReferenceData().entries
    .filter((entry) => entry.language === 'fuzzybasic');
  const incoming = new Map(entries.map((entry) => [entry.id, 0]));
  for (const entry of entries) {
    for (const relatedId of entry.relatedIds || []) {
      if (incoming.has(relatedId)) incoming.set(relatedId, incoming.get(relatedId) + 1);
    }
  }
  assert.deepEqual(
    [...incoming].filter(([, count]) => count === 0).map(([id]) => id),
    [],
  );
});

test('every SLANG reference entry is reachable through relatedIds', () => {
  const entries = validateReferenceData().entries
    .filter((entry) => entry.language === 'slang');
  const incoming = new Map(entries.map((entry) => [entry.id, 0]));
  for (const entry of entries) {
    for (const relatedId of entry.relatedIds || []) {
      if (incoming.has(relatedId)) incoming.set(relatedId, incoming.get(relatedId) + 1);
    }
  }
  assert.deepEqual(
    [...incoming].filter(([, count]) => count === 0).map(([id]) => id),
    [],
  );
});

test('every X1Pen FuzzyBASIC tokenizer keyword is covered by symbols', () => {
  const tokenizerSource = readFileSync(join(repoRoot, 'html/x1pen_tokenizer.js'), 'utf8');
  const table = tokenizerSource.match(/var RSVTBL = \[([\s\S]*?)\n\s*\];/);
  assert.ok(table, 'RSVTBL must be present');
  const keywords = [...table[1].matchAll(/\[0x[\dA-F]+,\s*0x[\dA-F]+,\s*'([^']+)'\]/g)]
    .map((match) => match[1].trim().replace(/\($/, ''));
  assert.ok(keywords.length >= 200);

  const { entries } = validateReferenceData();
  const documented = new Set(entries
    .filter((entry) => entry.language === 'fuzzybasic'
      && entry.id !== 'fuzzybasic.keywords.catalog')
    .flatMap((entry) => entry.symbols));
  for (const keyword of new Set(keywords)) {
    assert.ok(documented.has(keyword), `${keyword} must be covered by a dedicated FuzzyBASIC entry`);
  }
});

test('every X1Pen SLANG compiler keyword is covered by a dedicated entry', () => {
  const compilerSource = readFileSync(join(repoRoot, 'html/x1pen_slang_compiler.js'), 'utf8');
  const keywordBlock = compilerSource.match(/var kw = \{([\s\S]*?)\n\s*\};/);
  const stringBlock = compilerSource.match(/var STRING_FUNCS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(keywordBlock, 'SLANG keyword table must be present');
  assert.ok(stringBlock, 'SLANG string function table must be present');
  const keywords = [...keywordBlock[1].matchAll(/\b([A-Z][A-Z0-9]*)\s*:/g)]
    .map((match) => match[1]);
  const stringFunctions = [...stringBlock[1].matchAll(/'([^']+)'/g)]
    .map((match) => match[1]);
  assert.ok(keywords.length >= 45);

  const documented = new Set(validateReferenceData().entries
    .filter((entry) => entry.language === 'slang' && entry.kind !== 'catalog')
    .flatMap((entry) => entry.symbols));
  for (const symbol of new Set([...keywords, ...stringFunctions])) {
    assert.ok(documented.has(symbol), `${symbol} must be covered by a dedicated SLANG entry`);
  }
});

test('SLANG catalogs cover the exact runtime and include files loaded by X1Pen', () => {
  const x1penSource = readFileSync(join(repoRoot, 'html/x1pen.js'), 'utf8');
  const entries = validateReferenceData().entries;
  const runtimeCatalog = new Set(entries.find((entry) => entry.id === 'slang.runtime.catalog').symbols);
  const includeCatalog = new Set(entries.find((entry) => entry.id === 'slang.includes.catalog').symbols);

  for (const filename of extractVfsFiles(x1penSource, 'runtimeFiles')) {
    const source = readFileSync(join(repoRoot, 'assets/slang_runtime', filename), 'utf8');
    for (const match of source.matchAll(/^; @(?:name|alias) (\S+)/gm)) {
      assert.ok(runtimeCatalog.has(match[1]), `${match[1]} from ${filename} must be in the runtime catalog`);
    }
  }

  for (const filename of extractVfsFiles(x1penSource, 'includeFiles')) {
    const source = readFileSync(join(repoRoot, 'assets/slang_include', filename), 'utf8');
    for (const symbol of extractSlangIncludeSymbols(source)) {
      assert.ok(includeCatalog.has(symbol), `${symbol} from ${filename} must be in the include catalog`);
    }
  }
});

test('LSX-Dodgers-specific file limitations are documented', () => {
  const result = getReferenceEntries({
    ids: ['fuzzybasic.files.lsx'],
    maxCharacters: 8 * 1024,
  });
  const entry = result.entries[0];
  assert.match(entry.summary, /LSX-Dodgers/);
  assert.match(entry.notes.join(' '), /FSET and FRESET.*no-ops/);
  assert.match(entry.notes.join(' '), /DEVI and DEVO.*unsafe/);
});

test('FuzzyBASIC LOCAL and VSTACK syntax follows the LSX implementation', () => {
  const result = getReferenceEntries({
    ids: ['fuzzybasic.subroutines.proc', 'fuzzybasic.stack.variable'],
    maxCharacters: 16 * 1024,
  });
  const [proc, stack] = result.entries;
  assert.ok(proc.syntax.some((syntax) => syntax.startsWith('LOCAL "A"')));
  assert.ok(proc.notes.some((note) => /LOCAL "C" selects C through H/.test(note)));
  assert.ok(stack.syntax.includes('VSTACK startAddress,endAddress'));
});

test('bundled SLANG examples compile with the exact X1Pen compiler and VFS', () => {
  const compiler = loadBrowserGlobal('html/x1pen_slang_compiler.js', 'X1PenSlangCompiler');
  const vfs = loadSlangVfs();
  const { entries } = validateReferenceData();
  const examples = entries
    .filter((entry) => entry.language === 'slang')
    .flatMap((entry) => entry.examples || []);
  assert.ok(examples.length >= 6);
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
    'GRAPH.LIB': ['@INIT', '@LINE', '@CIRCLE'],
    'GRAPHF.LIB': ['@LINEC', '@TRIANGLEC', '@CIRCLEC'],
    'SOROBAN.LIB': ['@SINGLE', '@ADD', '@SQR'],
  };
  const documented = JSON.stringify(getReferenceEntries({
    ids: [
      'slang.include.tile-sprite',
      'slang.include.chiplib',
      'slang.include.ui',
      'slang.include.graph-soroban',
      'slang.include.soroban',
    ],
    maxCharacters: 32 * 1024,
  }).entries);

  for (const [filename, names] of Object.entries(selectedApis)) {
    const source = readFileSync(join(repoRoot, 'assets/slang_include', filename), 'utf8');
    for (const name of names) {
      assert.ok(source.includes(name), `${name} must exist in ${filename}`);
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
