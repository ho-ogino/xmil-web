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

test('reference search matches punctuation-only symbols without changing token normalization', () => {
  for (const [language, query, expectedId] of [
    ['slang', '!=', 'slang.expressions.operators'],
    ['slang', '<<', 'slang.expressions.operators'],
    ['slang', '<>', 'slang.expressions.operators'],
    ['fuzzybasic', '<=', 'fuzzybasic.values.operators'],
    ['fuzzybasic', '>=', 'fuzzybasic.values.operators'],
  ]) {
    const result = searchReference({ language, query, maxResults: 3 });
    assert.equal(result.matchMode, 'symbol', query);
    assert.equal(result.matches[0]?.id, expectedId, query);
  }
  assert.throws(() => searchReference({ query: '   ' }), /searchable characters/);
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

test('representative Japanese and English queries reach dedicated X1 hardware entries', () => {
  const cases = new Map([
    ['I/O空間 VRAM', 'x1.architecture.address-spaces'],
    ['CPU memory versus video memory', 'x1.architecture.address-spaces'],
    ['バンクメモリ', 'x1.memory.cpu-banking'],
    ['turbo low memory bank', 'x1.memory.cpu-banking'],
    ['属性VRAM', 'x1.video.text-vram'],
    ['kanji VRAM mirror', 'x1.video.text-vram'],
    ['色プレーン', 'x1.video.graphics-vram'],
    ['simultaneous access', 'x1.video.graphics-vram'],
    ['表示バンク アクセスバンク', 'x1.video.screen-control'],
    ['screen control CRTC', 'x1.video.screen-control'],
    ['PCG パレット', 'x1.video.pcg-palette'],
    ['programmable character palette', 'x1.video.pcg-palette'],
    ['I/Oマップ', 'x1.io.dispatch-map'],
    ['キーボード サブCPU', 'x1.io.ppi-subcpu'],
    ['キー入力', 'x1.io.ppi-subcpu'],
    ['PSG ジョイスティック', 'x1.io.psg-joystick'],
    ['PSG clock tone period', 'x1.io.psg-joystick'],
    ['ジョイスティック ビット割り当て', 'x1.io.psg-joystick'],
    ['active-low input', 'x1.io.psg-joystick'],
    ['押下検出', 'x1.io.psg-joystick'],
    ['FM音源 OPM', 'x1.io.opm'],
    ['CTC タイマー', 'x1.io.ctc'],
    ['タイマー割り込み', 'x1.io.ctc'],
    ['DMA転送', 'x1.io.dma'],
    ['SIO マウス', 'x1.io.sio-mouse'],
    ['FDC フロッピー', 'x1.io.floppy'],
    ['SASI', 'x1.io.sasi'],
    ['EMM 拡張メモリ', 'x1.io.emm-rom'],
    ['漢字ROM', 'x1.io.kanji-rom'],
    ['turboZ 4096色', 'x1.video.turboz-controls'],
  ]);

  for (const [query, expectedId] of cases) {
    const result = searchReference({ language: 'x1', query, maxResults: 3 });
    assert.equal(result.matches[0]?.id, expectedId, query);
  }
});

test('representative Japanese and English queries reach X1Pen assembler entries', () => {
  const cases = new Map([
    ['アセンブラの書式', 'z80asm.syntax.source'],
    ['local label namespace', 'z80asm.syntax.source'],
    ['16進数 式', 'z80asm.syntax.expressions'],
    ['DB DW ORG', 'z80asm.directives.data'],
    ['等価定義', 'z80asm.directives.data'],
    ['条件アセンブル', 'z80asm.preprocessor.conditionals'],
    ['macro arguments', 'z80asm.macros'],
    ['Z80命令 IXH', 'z80asm.instructions'],
  ]);

  for (const [query, expectedId] of cases) {
    const result = searchReference({ language: 'z80asm', query, maxResults: 3 });
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

test('every X1 hardware reference entry is reachable through relatedIds', () => {
  const entries = validateReferenceData().entries
    .filter((entry) => entry.language === 'x1');
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

test('every X1Pen assembler reference entry is reachable through relatedIds', () => {
  const entries = validateReferenceData().entries
    .filter((entry) => entry.language === 'z80asm');
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

test('X1 hardware reference matches emulator memory and VRAM constants', () => {
  const x1Header = readFileSync(join(repoRoot, 'src/X1.H'), 'utf8');
  const crtcHeader = readFileSync(join(repoRoot, 'src/X1_CRTC.H'), 'utf8');
  const ioSource = readFileSync(join(repoRoot, 'src/X1_IO.CPP'), 'utf8');
  const vramSource = readFileSync(join(repoRoot, 'platform/x1_vram_port.cpp'), 'utf8');
  const ids = validateReferenceData().entries
    .filter((entry) => entry.language === 'x1')
    .map((entry) => entry.id);
  const details = JSON.stringify(getReferenceEntries({
    ids,
    maxCharacters: 128 * 1024,
  }).entries);

  assert.match(x1Header, /mBANK\[16\]\[0x8000\]/);
  assert.match(x1Header, /GRAM_BANK1\s+0x10000/);
  assert.match(ioSource, /ROM_TYPE >= 2.*hi == 0x0b/s);
  assert.match(ioSource, /if \(s8255\.IO_MODE\).*x1_grp_w2/s);
  assert.match(ioSource, /BYTE __fastcall Z80_In[\s\S]*?s8255\.IO_MODE = 0;/);
  assert.match(vramSource, /text_ports\[\] = \{ 0x3000, 0x2000, 0x3800 \}/);
  assert.match(vramSource, /plane_ports\[\] = \{ 0x4000, 0x8000, 0xC000 \}/);
  for (const [name, value] of [
    ['SCRN_DISPVRAM', '0x08'],
    ['SCRN_ACCESSVRAM', '0x10'],
    ['SCRN_PCGMODE', '0x20'],
  ]) {
    assert.match(crtcHeader, new RegExp(`#define\\s+${name}\\s+${value}`));
  }
  for (const fact of [
    '2000H-27FFH', '2800H-2FFFH', '3000H-37FFH', '3800H-3FFFH',
    '4000H-7FFFH', '8000H-BFFFH', 'C000H-FFFFH',
    'B+R+G', 'R+G', 'B+G', 'B+R', '0B00H-0BFFH',
    '0700H/0701H', '0704H-0707H', '0DxxH', '0E80H-0E83H',
    '0FD0H-0FD3H', '0FF8H-0FFFH', '1900H-19FFH', '1A00H-1A03H',
    '1BxxH/1CxxH', '1F80H-1F8FH', '1F90H-1F93H',
    '1FA0H-1FA3H', '1FA8H-1FABH', '1FB9H-1FBFH',
    '1FD0H/1FE0H', '1FF0H-1FFFH',
  ]) {
    assert.ok(details.includes(fact), `${fact} must remain documented`);
  }
});

test('PSG and joystick reference matches the emulator input contract', () => {
  const soundSource = readFileSync(join(repoRoot, 'src/OPMSOUND/Opmcore.cpp'), 'utf8');
  const x1SoundSource = readFileSync(join(repoRoot, 'src/X1_SOUND.CPP'), 'utf8');
  const joystickSource = readFileSync(join(repoRoot, 'platform/platform_joystick.cpp'), 'utf8');
  const entries = new Map(validateReferenceData().entries.map((entry) => [entry.id, entry]));
  const [contract] = getReferenceEntries({
    ids: ['x1.io.psg-joystick'],
    maxCharacters: 16 * 1024,
  }).entries;
  const details = JSON.stringify(contract);

  assert.match(soundSource, /AY8910_init\(2000000,/);
  const inputLabels = {
    UP: 'Up', DOWN: 'Down', LEFT: 'Left', RIGHT: 'Right',
    BTN4: 'Button 4', BTN2: 'Button 2 (B)', BTN1: 'Button 1 (A)', BTN3: 'Button 3',
  };
  const sourceInputs = new Map(
    [...joystickSource.matchAll(/^#define JOY_(UP|DOWN|LEFT|RIGHT|BTN[1-4])_BIT\s+(0x[0-9A-F]+)/gmi)]
      .map(([, name, mask]) => {
        const numericMask = Number.parseInt(mask, 16);
        return [Math.log2(numericMask), { mask: numericMask, input: inputLabels[name] }];
      }),
  );
  const documentedInputs = new Map(
    contract.syntax.flatMap((row) => {
      const match = row.match(/^(\d) \| ([0-9A-F]+)H \| (.+)$/);
      return match
        ? [[Number(match[1]), { mask: Number.parseInt(match[2], 16), input: match[3] }]]
        : [];
    }),
  );
  assert.deepEqual(documentedInputs, sourceInputs);
  assert.match(joystickSource,
    /int js_set_automation_pad\(int port, int bits\)[\s\S]*port < 1 \|\| port > 2 \|\| bits < 0 \|\| bits > 0xFF[\s\S]*automation_joyflag\[port - 1\]/);
  assert.match(joystickSource,
    /void joy_releaseautomation\(void\)[\s\S]*automation_joyflag\[0\] = 0xFF;[\s\S]*automation_joyflag\[1\] = 0xFF;/);
  assert.match(x1SoundSource,
    /if \(xmilcfg\.BTN_MODE\)[\s\S]*ret &= joy_getautomation\(\(BYTE\)\(psgreg - 0x0e\)\);/,
    'automation pad bits must be applied after the physical rapid/swap transforms');
  assert.match(x1SoundSource,
    /void x1_psg_reset\(void\)[\s\S]*joy_releaseautomation\(\);[\s\S]*opmreg = 0;/,
    'machine reset must release both automation pads');
  assert.match(x1SoundSource,
    /if \(psgreg < 0x0e\)[\s\S]*psg\[psgreg\] = value;/,
    'automation input must not replace the existing PSG sound-register write path');
  for (const fact of [
    '2,000,000 Hz', 'clock / (16 * frequency)', 'period 284',
    'register 0 (fine) = 1CH', 'register 1 (coarse) = 01H', 'limited to 12 bits',
    '14 | joystick 1', '15 | joystick 2', 'applies identically',
    'physical gamepad state into register 14', 'Buttons 3 and 4 are additional mappings',
    '0 means pressed', '255 (FFH) means that no direction or button is pressed',
    '(NEW XOR OLD) AND OLD',
  ]) {
    assert.ok(details.includes(fact), `${fact} must remain documented`);
  }
  assert.ok(entries.get('fuzzybasic.x1.input').relatedIds.includes('x1.io.psg-joystick'));
  assert.ok(entries.get('slang.runtime.lsx-io-files').relatedIds.includes('x1.io.psg-joystick'));
});

test('every X1 hardware example assembles with the bundled Z80 assembler', () => {
  const assembler = loadBrowserGlobal('html/x1pen_z80asm.js', 'X1PenZ80Asm');
  const entries = validateReferenceData().entries
    .filter((entry) => entry.language === 'x1');
  assert.ok(entries.length >= 6);
  for (const entry of entries) {
    assert.ok(entry.examples?.length > 0, `${entry.id} must include an example`);
    for (const example of entry.examples) {
      const result = assembler.assemble(example.source);
      assert.equal(result.errors.length, 0,
        `${entry.id}: ${example.title}: ${JSON.stringify(result.errors)}`);
      assert.ok(result.bytes.length > 0, `${entry.id}: ${example.title} must produce bytes`);
    }
  }
});

test('every X1Pen assembler example assembles with the bundled assembler', () => {
  const assembler = loadBrowserGlobal('html/x1pen_z80asm.js', 'X1PenZ80Asm');
  const entries = validateReferenceData().entries
    .filter((entry) => entry.language === 'z80asm');
  assert.ok(entries.length >= 6);
  for (const entry of entries) {
    assert.ok(entry.examples?.length > 0, `${entry.id} must include an example`);
    for (const example of entry.examples) {
      const result = assembler.assemble(example.source);
      assert.equal(result.errors.length, 0,
        `${entry.id}: ${example.title}: ${JSON.stringify(result.errors)}`);
      assert.ok(result.bytes.length > 0, `${entry.id}: ${example.title} must produce bytes`);
    }
  }
});

test('every assembler mnemonic is covered by the X1Pen assembler reference', () => {
  const source = readFileSync(join(repoRoot, 'html/x1pen_z80asm.js'), 'utf8');
  const block = source.match(/var KNOWN_MNEMONICS = \{\};([\s\S]*?)\.split\(' '\)/);
  assert.ok(block, 'KNOWN_MNEMONICS must be present');
  const mnemonics = [...block[1].matchAll(/'([^']*)'/g)]
    .flatMap((match) => match[1].trim().split(/\s+/).filter(Boolean));
  assert.ok(mnemonics.length >= 75);

  const documented = new Set(validateReferenceData().entries
    .filter((entry) => entry.language === 'z80asm')
    .flatMap((entry) => entry.symbols));
  for (const mnemonic of new Set(mnemonics)) {
    assert.ok(documented.has(mnemonic), `${mnemonic} must be covered by the assembler reference`);
  }
});

test('every implemented X1 I/O dispatcher has a dedicated reference entry', () => {
  const source = readFileSync(join(repoRoot, 'src/X1_IO.CPP'), 'utf8');
  const handlers = new Set([...source.matchAll(/\b(x1_[A-Za-z0-9_]+)\s*\(/g)]
    .map((match) => match[1]));
  assert.ok(handlers.size >= 50);

  const documented = new Set(validateReferenceData().entries
    .filter((entry) => entry.language === 'x1' && entry.kind !== 'catalog')
    .flatMap((entry) => entry.symbols));
  for (const handler of handlers) {
    assert.ok(documented.has(handler), `${handler} must have a dedicated X1 I/O reference entry`);
  }
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
  const runtimeImplementation = new Set();
  const includeImplementation = new Set();

  for (const filename of extractVfsFiles(x1penSource, 'runtimeFiles')) {
    const source = readFileSync(join(repoRoot, 'assets/slang_runtime', filename), 'utf8');
    for (const match of source.matchAll(/^; @(?:name|alias) (\S+)/gm)) {
      runtimeImplementation.add(match[1]);
      assert.ok(runtimeCatalog.has(match[1]), `${match[1]} from ${filename} must be in the runtime catalog`);
    }
  }

  for (const filename of extractVfsFiles(x1penSource, 'includeFiles')) {
    const source = readFileSync(join(repoRoot, 'assets/slang_include', filename), 'utf8');
    for (const symbol of extractSlangIncludeSymbols(source)) {
      includeImplementation.add(symbol);
      assert.ok(includeCatalog.has(symbol), `${symbol} from ${filename} must be in the include catalog`);
    }
  }

  assert.deepEqual(
    [...runtimeCatalog].filter((symbol) => !runtimeImplementation.has(symbol)),
    [],
    'runtime catalog must not include symbols outside the loaded VFS files',
  );
  assert.deepEqual(
    [...includeCatalog].filter((symbol) => !includeImplementation.has(symbol)),
    [],
    'include catalog must not include symbols outside the loaded VFS files',
  );
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

test('documented embedded M8A example compiles and assembles with its standalone dependencies', () => {
  const compiler = loadBrowserGlobal('html/x1pen_slang_compiler.js', 'X1PenSlangCompiler');
  const assembler = loadBrowserGlobal('html/x1pen_z80asm.js', 'X1PenZ80Asm');
  const vfs = loadSlangVfs();
  const entry = validateReferenceData().entries
    .find((candidate) => candidate.id === 'slang.x1.assets-compression');
  const example = entry.examples.find((candidate) => candidate.title.includes('embedded M8A'));
  assert.ok(example, 'the M8ALOAD reference must retain its executable embedded-data example');

  const compiled = compiler.compile(example.source, vfs, {
    defaultOrg: 0x100,
    codeReadonly: false,
    defines: { ENV_TYPE: 1 },
  });
  assert.equal(compiled.errors.length, 0, JSON.stringify(compiled.errors));
  assert.match(compiled.asm, /CALL\s+M8ALIB\.M8ALOAD/);
  assert.match(compiled.asm, /NAME_SPACE_DEFAULT\.AT_WIDTH/);

  const assembled = assembler.assemble(compiled.asm, { ENV_TYPE: 1 });
  assert.equal(assembled.errors.length, 0, JSON.stringify(assembled.errors));
  assert.ok(assembled.bytes.length > 0);
  assert.equal(assembled.symbols['M8ALIB.GVRAMADRS_LO'], undefined,
    'the shipped CALCSPEED=0 build must omit dormant address tables');
  assert.equal(assembled.symbols['M8ALIB.GVRAMADRS_HI'], undefined,
    'the shipped CALCSPEED=0 build must omit dormant address tables');
  assert.ok('NAME_SPACE_DEFAULT.AT_WIDTH' in assembled.symbols,
    'M8ALOAD must pull X1WORK without requiring the caller to use WIDTH first');
});

test('M8A runtime conditionals use supported syntax and preserve both dormant width tables', () => {
  const compiler = loadBrowserGlobal('html/x1pen_slang_compiler.js', 'X1PenSlangCompiler');
  const assembler = loadBrowserGlobal('html/x1pen_z80asm.js', 'X1PenZ80Asm');
  const vfs = loadSlangVfs();
  const runtimeDir = join(repoRoot, 'assets/slang_runtime');
  const unsupported = [];
  for (const filename of readdirSync(runtimeDir).filter((name) => name.endsWith('.asm'))) {
    const source = readFileSync(join(runtimeDir, filename), 'utf8');
    source.split(/\r?\n/).forEach((line, index) => {
      if (/^\s*#(?:IF|ELIF|ELSEIF)\b.*(?:&&|\|\|)/i.test(line)) {
        unsupported.push(`${filename}:${index + 1}`);
      }
    });
  }
  assert.deepEqual(unsupported, [], 'assembler runtime directives must avoid unsupported logical tokens');

  const m8aSource = vfs['libm8a.asm'];
  const magSource = vfs['libmag.asm'];
  assert.match(m8aSource, /^; @calls X1WORK$/m);
  assert.match(m8aSource, /^M8A_WIDTH\s+EQU\s+40$/m);
  assert.doesNotMatch(m8aSource, /^WIDTH\s+EQU\b/m);
  assert.doesNotMatch(magSource, /^\s*#(?:IF|ELIF|ELSEIF)\b.*(?:&&|\|\|)/mi);

  const minimalSource = [
    'ARRAY BYTE DATA[] = {$4D,$38,$41,$00,$01,$01,$49,$49,$49,$49};',
    'MAIN() BEGIN',
    '  M8ALOAD(DATA,0,0);',
    'END;',
  ].join('\n');
  for (const width of [40, 80]) {
    const variantVfs = {
      ...vfs,
      'libm8a.asm': m8aSource
        .replace(/^CALCSPEED\s+EQU\s+0\b/m, 'CALCSPEED\tEQU\t1')
        .replace(/^M8A_WIDTH\s+EQU\s+40\b/m, `M8A_WIDTH\tEQU\t${width}`),
    };
    const compiled = compiler.compile(minimalSource, variantVfs, {
      defaultOrg: 0x100,
      codeReadonly: false,
      defines: { ENV_TYPE: 1 },
    });
    assert.equal(compiled.errors.length, 0,
      `M8A_WIDTH=${width} must compile: ${JSON.stringify(compiled.errors)}`);
    const assembled = assembler.assemble(compiled.asm, { ENV_TYPE: 1 });
    assert.equal(assembled.errors.length, 0,
      `M8A_WIDTH=${width} must assemble: ${JSON.stringify(assembled.errors)}`);
    const tableAddress = assembled.symbols['M8ALIB.GVRAMADRS_LO'];
    assert.ok(Number.isInteger(tableAddress), `M8A_WIDTH=${width} must emit its low table`);
    assert.equal(assembled.bytes[tableAddress - assembled.org + 8], width === 40 ? 0x28 : 0x50,
      `M8A_WIDTH=${width} must select the matching table payload`);
  }
});

test('M8A runtime changes do not affect unused programs or MAGLOAD assembly', () => {
  const compiler = loadBrowserGlobal('html/x1pen_slang_compiler.js', 'X1PenSlangCompiler');
  const assembler = loadBrowserGlobal('html/x1pen_z80asm.js', 'X1PenZ80Asm');
  const vfs = loadSlangVfs();
  for (const [name, source, expectedRuntime] of [
    ['unused', 'MAIN() BEGIN END;', null],
    ['MAGLOAD', 'MAIN() BEGIN MAGLOAD("A:X.MAG",0,0); END;', 'MAGLOAD'],
  ]) {
    const compiled = compiler.compile(source, vfs, {
      defaultOrg: 0x100,
      codeReadonly: false,
      defines: { ENV_TYPE: 1 },
    });
    assert.equal(compiled.errors.length, 0,
      `${name} control must compile: ${JSON.stringify(compiled.errors)}`);
    assert.equal(compiled.asm.includes('[M8ALIB]'), false, `${name} must not pull M8ALOAD`);
    if (expectedRuntime) assert.ok(compiled.asm.includes(expectedRuntime));
    const assembled = assembler.assemble(compiled.asm, { ENV_TYPE: 1 });
    assert.equal(assembled.errors.length, 0,
      `${name} control must assemble: ${JSON.stringify(assembled.errors)}`);
    assert.ok(assembled.bytes.length > 0);
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
