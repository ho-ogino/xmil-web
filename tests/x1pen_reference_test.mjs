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

test('reference search matches punctuation-only symbols without changing token normalization', () => {
  for (const [language, query, expectedId] of [
    ['slang', '!=', 'slang.expressions.operators'],
    ['slang', '<<', 'slang.expressions.operators'],
    ['slang', '<>', 'slang.expressions.operators'],
    ['z80asm', '&&', 'z80asm.syntax.expressions'],
    ['z80asm', '||', 'z80asm.syntax.expressions'],
    ['z80asm', '!', 'z80asm.syntax.expressions'],
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
    ['INKEY non-blocking', 'slang.x1.inkey'],
    ['キー入力 ノンブロッキング', 'slang.x1.inkey'],
    ['inline assembly', 'slang.machine.inline-assembly'],
    ['埋め込みアセンブラ', 'slang.machine.inline-assembly'],
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

test('MCP SLANG reference prefers brace bodies while retaining the BEGIN compatibility index', () => {
  const entries = validateReferenceData().entries;
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const structure = byId.get('slang.program.structure');
  const guidance = [
    structure.summary,
    ...structure.syntax,
    ...byId.get('slang.functions.typed').syntax,
    ...byId.get('slang.x1.timing').syntax,
  ];

  assert.ok(structure.symbols.includes('BEGIN'));
  assert.ok(structure.aliases.includes('BEGIN END'));
  assert.match(structure.summary, /Prefer \{ \.\.\. \} for new function bodies/);
  assert.match(structure.summary, /legacy BEGIN \.\.\. END; blocks remain accepted/);
  assert.equal(guidance.filter((text) => /\bBEGIN\b/.test(text)).length, 1);
  assert.equal(guidance.filter((text) => /\bEND\s*;/.test(text)).length, 1);

  for (const entry of entries.filter((candidate) => candidate.language === 'slang')) {
    for (const example of entry.examples || []) {
      assert.doesNotMatch(example.source, /\bBEGIN\b|\bEND\s*;/,
        `${entry.id}: ${example.title} must prefer brace-delimited function bodies`);
    }
  }
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

test('X1Pen assembler reference pins the portable logical-expression contract', () => {
  const assembler = loadBrowserGlobal('html/x1pen_z80asm.js', 'X1PenZ80Asm');
  const entries = new Map(validateReferenceData().entries.map((entry) => [entry.id, entry]));
  const expressions = entries.get('z80asm.syntax.expressions');
  const conditionals = entries.get('z80asm.preprocessor.conditionals');
  const expressionText = JSON.stringify(expressions);
  const conditionalText = JSON.stringify(conditionals);

  for (const symbol of ['!', '&&', '||', '^']) assert.ok(expressions.symbols.includes(symbol));
  for (const fact of [
    'comparisons; &&; ||',
    'masking to 16 bits',
    'left-associative',
    'eager',
    'DB, DW, DS',
    'only conditional preprocessing substitutes zero',
  ]) assert.ok(expressionText.includes(fact), `${fact} must remain documented`);
  for (const fact of [
    '#IF UNKNOWN==0 is true',
    'real symbol table',
    'leaves the chain unsatisfied',
    'CALCSPEED != 0 && M8A_WIDTH == 40',
  ]) assert.ok(conditionalText.includes(fact), `${fact} must remain documented`);

  const assembled = assembler.assemble(conditionals.examples[0].source);
  assert.equal(assembled.errors.length, 0);
  assert.deepEqual(Array.from(assembled.bytes), [0x3E, 0x02, 0xC9]);
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

test('SLANG runtime arity metadata matches the reviewed VFS and compiler builtin catalog', () => {
  const compiler = loadBrowserGlobal('html/x1pen_slang_compiler.js', 'X1PenSlangCompiler');
  const x1penSource = readFileSync(join(repoRoot, 'html/x1pen.js'), 'utf8');
  const compilerSource = readFileSync(join(repoRoot, 'html/x1pen_slang_compiler.js'), 'utf8');
  const runtimeFiles = extractVfsFiles(x1penSource, 'runtimeFiles');
  const manager = compiler._RuntimeManager();
  const definitions = new Map();

  for (const filename of runtimeFiles) {
    const source = readFileSync(join(repoRoot, 'assets/slang_runtime', filename), 'utf8');
    const functions = compiler._RuntimeParser.parse(source, filename);
    manager.loadFromString(source, filename);
    for (const func of functions) {
      const key = func.name.toLowerCase();
      if (!definitions.has(key)) definitions.set(key, []);
      definitions.get(key).push(func);
    }
  }

  const nullable = compiler._RuntimeParser.parse([
    '; @name LEGACY',
    '; @alias LEGACY_ALIAS',
    'RET',
    '; @name EXPLICIT_ZERO',
    '; @param_count 0',
    'RET',
  ].join('\n'), 'arity-probe.asm');
  assert.equal(nullable[0].paramCount, null);
  assert.equal(nullable[0].aliases.join(','), 'LEGACY_ALIAS');
  assert.equal(nullable[1].paramCount, 0);

  const expectedSignatures = new Map([
    ['ABS', 1],
    ['ADECI', 0],
    ['AT_VRCALC', 1],
    ['BEEP', 0],
    ['GETKY_DOINIT', 0],
    ['GETL', 1],
    ['GETLIN', 2],
    ['GETREG', 0],
    ['INKEY', 1],
    ['INPUT', 0],
    ['LINPUT', 2],
    ['lLOC1', 0],
    ['LOCATE', 2],
    ['MULHLDE', 2],
    ['P10', 1],
    ['P10to5', 1],
    ['P10toN', 2],
    ['PCGDEFS', 3],
    ['PCR', 1],
    ['PCR1', 1],
    ['PCRONE', 0],
    ['PHEX', 1],
    ['PHEX2', 1],
    ['PHEX4', 1],
    ['PRMODE', 1],
    ['PRT', 1],
    ['PSIGN', 1],
    ['PSPC', 1],
    ['PSTR', 2],
    ['PSTR2', 2],
    ['PTAB', 1],
    ['RBIT', 2],
    ['RCALL', 1],
    ['RESET', 2],
    ['RND', 1],
    ['RSET', 2],
    ['sASC', 0],
    ['sBOOT', 0],
    ['sBRKEY', 0],
    ['sCAP', 0],
    ['SCREEN', 2],
    ['sCSR', 0],
    ['sCTRL', 0],
    ['SEX', 1],
    ['sFGETL', 0],
    ['sFLGET', 0],
    ['sGETKY', 0],
    ['sGETL', 0],
    ['SGN', 1],
    ['sHEX', 0],
    ['sHLHEX', 0],
    ['sINKBF', 0],
    ['sINKEY', 0],
    ['sKYBFC', 0],
    ['sLOC', 0],
    ['sLPRNT', 0],
    ['sLPTOF', 0],
    ['sLPTON', 0],
    ['sLTNL', 0],
    ['sMPRNT', 0],
    ['sMSG', 0],
    ['sMSX', 0],
    ['sNL', 0],
    ['sPAUSE', 0],
    ['sPCLR', 0],
    ['sPRINT', 0],
    ['sPRINTS', 0],
    ['sPRNT0', 0],
    ['SRAND', 1],
    ['sSCRN', 0],
    ['sSYSTEM', 0],
    ['STICK', 1],
    ['STOP', 0],
    ['sWIDCH', 0],
    ['sWORK', 0],
    ['sZPRINT', 0],
    ['TATTR', 1],
    ['VSYNC', 1],
    ['VTOS', 2],
    ['WIDTH', 1],
  ].map(([name, count]) => [name.toLowerCase(), count]));
  const actualSignatures = new Map();
  for (const func of new Set(Object.values(manager.functions))) {
    if (func.paramCount !== null) actualSignatures.set(func.name.toLowerCase(), func.paramCount);
  }
  assert.deepEqual([...actualSignatures].sort(), [...expectedSignatures].sort());

  for (const [name, funcs] of definitions) {
    const explicitCounts = new Set(funcs
      .filter((func) => func.paramCount !== null)
      .map((func) => func.paramCount));
    assert.ok(explicitCounts.size <= 1,
      `${name} has conflicting explicit @param_count values across loaded runtime files`);
  }

  const builtinBlock = compilerSource.match(/var builtinFuncs = \[([\s\S]*?)\n\s*\];/);
  assert.ok(builtinBlock);
  const builtins = [...builtinBlock[1].matchAll(/\['([^']+)',(\d+)\]/g)]
    .map((match) => [match[1], Number(match[2])]);
  assert.equal(builtins.length, 21);
  for (const [name, count] of builtins) {
    const runtime = manager.getFunction(name);
    assert.ok(runtime, `${name} compiler builtin must resolve through the bundled runtime`);
    assert.notEqual(runtime.paramCount, null, `${name} runtime must explicitly declare its arity`);
    assert.equal(runtime.paramCount, count, `${name} compiler/runtime arity must agree`);
  }
});

test('SLANG runtime arity validation rejects typed mismatches and preserves legacy calls', () => {
  const compiler = loadBrowserGlobal('html/x1pen_slang_compiler.js', 'X1PenSlangCompiler');
  const assembler = loadBrowserGlobal('html/x1pen_z80asm.js', 'X1PenZ80Asm');
  const vfs = loadSlangVfs();
  const options = {
    defaultOrg: 0x100,
    codeReadonly: false,
    defines: { ENV_TYPE: 1 },
  };
  const compile = (source, customVfs = vfs) => compiler.compile(source, customVfs, options);
  const assertArityError = (source, expected) => {
    const result = compile(source);
    assert.equal(result.asm, '');
    assert.equal(result.errors.length, 1, JSON.stringify(result.errors));
    assert.equal(result.errors[0].severity, 'Error');
    assert.equal(result.errors[0].message, expected);
    assert.ok(result.errors[0].span.start.line >= 1);
  };

  assertArityError(
    'MAIN() BEGIN\n  VSYNC();\nEND;',
    "Runtime function 'VSYNC' expected 1 argument, got 0",
  );
  assertArityError(
    'MAIN() BEGIN\n  VSYNC(1,2);\nEND;',
    "Runtime function 'VSYNC' expected 1 argument, got 2",
  );
  assertArityError(
    'MAIN() BEGIN\n  BEEP(1);\nEND;',
    "Runtime function 'BEEP' expected 0 arguments, got 1",
  );
  assertArityError(
    'MAIN() BEGIN\n  BIT(1);\nEND;',
    "Runtime function 'BIT' expected 2 arguments, got 1",
  );
  assertArityError(
    'MAIN() BEGIN\n  CALL();\nEND;',
    "Runtime function 'CALL' expected 1 argument, got 0",
  );

  const valid = compile([
    'VSYNC_PROC() BEGIN',
    'END;',
    'MAIN() BEGIN',
    '  MEM[$4000]=$5A;',
    '  VSYNC(1);',
    '  MEM[$4001]=$A5;',
    '  LOOP { }',
    'END;',
  ].join('\n'));
  assert.equal(valid.errors.length, 0, JSON.stringify(valid.errors));
  const assembled = assembler.assemble(valid.asm, { ENV_TYPE: 1 });
  assert.equal(assembled.errors.length, 0, JSON.stringify(assembled.errors));
  assert.ok(assembled.symbols['NAME_SPACE_DEFAULT.SLANG_PROG_END'] < 0x4000);
  assert.ok(assembled.symbols['NAME_SPACE_DEFAULT.__WORKEND__'] < 0x4000);

  const legacyVfs = {
    ...vfs,
    'legacy-untyped.asm': '; @name LEGACY_RUNTIME\nLD HL,$1234\nRET\n',
  };
  const legacyRuntime = compile([
    'MAIN() BEGIN',
    '  LEGACY_RUNTIME();',
    '  LEGACY_RUNTIME(1);',
    '  LEGACY_RUNTIME(1,2);',
    'END;',
  ].join('\n'), legacyVfs);
  assert.equal(legacyRuntime.errors.length, 0, JSON.stringify(legacyRuntime.errors));
  assert.equal(assembler.assemble(legacyRuntime.asm, { ENV_TYPE: 1 }).errors.length, 0);

  const legacyMachine = compile('MACHINE LEGACY_MACHINE; MAIN() BEGIN LEGACY_MACHINE(1,2); END;');
  assert.equal(legacyMachine.errors.length, 0, JSON.stringify(legacyMachine.errors));

  const userFunction = [
    'VSYNC(WORD A, WORD B) BEGIN',
    '  RETURN(A+B);',
    'END;',
  ].join('\n');
  const userCall = 'MAIN() BEGIN\n  VSYNC(1,2);\nEND;';
  for (const shadowSource of [
    `${userFunction}\n${userCall}`,
    `${userCall}\n${userFunction}`,
  ]) {
    const shadow = compile(shadowSource);
    assert.equal(shadow.errors.length, 0, JSON.stringify(shadow.errors));
    assert.equal(assembler.assemble(shadow.asm, { ENV_TYPE: 1 }).errors.length, 0);
  }

  for (const machineShadow of [
    'MACHINE VSYNC(2);\nMAIN() BEGIN VSYNC(1,2); END;',
    'MAIN() BEGIN VSYNC(1,2); END;\nMACHINE VSYNC(2);',
  ]) {
    const shadow = compile(machineShadow);
    assert.equal(shadow.errors.length, 0, JSON.stringify(shadow.errors));
  }
});

test('SLANG TATTR reference matches the runtime, editor and PCG contract', () => {
  const entries = validateReferenceData().entries;
  const tattr = entries.find((entry) => entry.id === 'slang.x1.text-attribute');
  assert.ok(tattr);
  assert.deepEqual(tattr.symbols, ['TATTR']);
  const details = [tattr.summary, ...tattr.syntax, ...tattr.notes].join(' ');
  for (const expected of [
    '0000H through 00FFH', 'HL=0', 'HL returns 1',
    '7=X2', '6=Y2', '5=PCG', '4=blink', '3=reverse', '2..0=BRG',
    'current LSX text cursor cell', 'does not move the cursor',
    '2000H', 'exactly one OUT', '2800H mirror', 'ANK text VRAM', 'kanji VRAM',
    '0 through 999', '0 through 1999', 'default 80-column width',
    'clobbers A, flags, BC and DE', 'preserves IX, IY, SP',
    'interrupt enable state is unchanged', 'issue TATTR again after a clear',
  ]) {
    assert.match(details, new RegExp(expected.replace(/[()]/g, '\\$&')));
  }
  for (const id of ['x1.video.text-vram', 'x1.video.pcg-palette']) {
    assert.ok(tattr.relatedIds.includes(id));
    assert.ok(entries.find((entry) => entry.id === id).relatedIds.includes(tattr.id));
  }

  const pcg = entries.find((entry) => entry.id === 'slang.x1.pcg-definition');
  assert.ok(pcg.symbols.includes('TATTR'));
  assert.match(pcg.notes.join(' '), /attribute bit 5/);
  const pcgSource = pcg.examples[0].source;
  assert.match(pcgSource, /LOCATE\(0, 0\);[\s\S]*TATTR\(\$27\);[\s\S]*PRINT\(CHR\$\(128\)/);

  const ui = entries.find((entry) => entry.id === 'slang.include.ui');
  assert.match([ui.summary, ...ui.notes].join(' '), /graphics VRAM[\s\S]*does not write X1 text attribute VRAM/);

  const editorLanguage = readFileSync(join(repoRoot, 'src/x1pen_slang_lang.js'), 'utf8');
  const builtinBlock = editorLanguage.match(/var SLANG_BUILTINS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(builtinBlock);
  assert.match(builtinBlock[1], /'TATTR'/);

  const runtime = readFileSync(join(repoRoot, 'assets/slang_runtime/libx1_print.asm'), 'utf8');
  const runtimeBlock = runtime.match(/^; @name TATTR\n([\s\S]*?)^; @name AT_VRCALC$/m);
  assert.ok(runtimeBlock);
  assert.match(runtimeBlock[1], /^; @param_count 1$/m);
  assert.match(runtimeBlock[1], /^; @calls sWORK,X1WORK$/m);
  assert.match(runtimeBlock[1], /LD HL,\(_TXADR\)[\s\S]*LD A,\(AT_WIDTH\)[\s\S]*LD BC,1000[\s\S]*LD BC,2000/);
  assert.equal((runtimeBlock[1].match(/OUT\s+\(C\),A/g) || []).length, 1);
  assert.doesNotMatch(runtimeBlock[1], /\bIN\s+|DI|EI|LD\s+\(_TXADR\),/);
});

test('SLANG TATTR compiles, assembles and stays dependency-pruned', () => {
  const compiler = loadBrowserGlobal('html/x1pen_slang_compiler.js', 'X1PenSlangCompiler');
  const assembler = loadBrowserGlobal('html/x1pen_z80asm.js', 'X1PenZ80Asm');
  const vfs = loadSlangVfs();
  const options = {
    defaultOrg: 0x100,
    codeReadonly: false,
    defines: { ENV_TYPE: 1 },
  };

  const unused = compiler.compile('MAIN() { LOOP { } }', vfs, options);
  assert.equal(unused.errors.length, 0, JSON.stringify(unused.errors));
  assert.doesNotMatch(unused.asm, /^TATTR:$/m);

  const probe = compiler.compile([
    'MAIN()',
    '{',
    '  MEM[$4000]=TATTR($27);',
    '  MEM[$4001]=TATTR($FF);',
    '  MEM[$4002]=TATTR($100);',
    '  LOOP { }',
    '}',
  ].join('\n'), vfs, options);
  assert.equal(probe.errors.length, 0, JSON.stringify(probe.errors));
  assert.match(probe.asm, /^TATTR:$/m);
  const assembled = assembler.assemble(probe.asm, { ENV_TYPE: 1 });
  assert.equal(assembled.errors.length, 0, JSON.stringify(assembled.errors));
  assert.ok(assembled.symbols['NAME_SPACE_DEFAULT.TATTR'] >= assembled.org);
  assert.ok(assembled.symbols['NAME_SPACE_DEFAULT.SLANG_PROG_END'] < 0x4000);
  assert.ok(assembled.symbols['NAME_SPACE_DEFAULT.__WORKEND__'] < 0x4000);
});

test('SLANG STICK reference matches the X1 runtime and editor contract', () => {
  const entries = validateReferenceData().entries;
  const stick = entries.find((entry) => entry.id === 'slang.x1.input');
  assert.ok(stick);
  assert.deepEqual(stick.symbols, ['STICK']);
  assert.ok(stick.syntax.includes('STICK(0)  // joystick 1, PSG register 14'));
  assert.ok(stick.syntax.includes('STICK(1)  // joystick 2, PSG register 15'));
  const details = [stick.summary, ...stick.syntax, ...stick.notes].join(' ');
  for (const expected of [
    'active-low', '255', 'Up', 'Down', 'Left', 'Right',
    'Button 4', 'Button 2 (B)', 'Button 1 (A)', 'Button 3',
    '(NEW XOR OLD) AND OLD', 'register 7', 'interrupts enabled',
  ]) {
    assert.match(details, new RegExp(expected.replace(/[()]/g, '\\$&')));
  }
  assert.ok(stick.relatedIds.includes('x1.io.psg-joystick'));
  const hardware = entries.find((entry) => entry.id === 'x1.io.psg-joystick');
  assert.ok(hardware.relatedIds.includes('slang.x1.input'));

  const editorLanguage = readFileSync(join(repoRoot, 'src/x1pen_slang_lang.js'), 'utf8');
  const builtinBlock = editorLanguage.match(/var SLANG_BUILTINS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(builtinBlock);
  assert.match(builtinBlock[1], /'STICK'/);

  const runtime = readFileSync(join(repoRoot, 'assets/slang_runtime/libx1_base.asm'), 'utf8');
  const runtimeBlock = runtime.match(/^; @name STICK\n([\s\S]*?)^; @name SETUPCTC$/m);
  assert.ok(runtimeBlock);
  assert.match(runtimeBlock[1], /^; @param_count 1$/m);
  assert.match(runtimeBlock[1], /DI[\s\S]*LD BC,\$1C00[\s\S]*OUT \(C\),A[\s\S]*LD B,\$1B[\s\S]*IN L,\(C\)[\s\S]*LD H,0[\s\S]*EI[\s\S]*RET/);
  assert.doesNotMatch(runtimeBlock[1], /LD A,I/);
});

test('SLANG STICK compiles, assembles and stays dependency-pruned', () => {
  const compiler = loadBrowserGlobal('html/x1pen_slang_compiler.js', 'X1PenSlangCompiler');
  const assembler = loadBrowserGlobal('html/x1pen_z80asm.js', 'X1PenZ80Asm');
  const vfs = loadSlangVfs();
  const options = {
    defaultOrg: 0x100,
    codeReadonly: false,
    defines: { ENV_TYPE: 1 },
  };

  const unused = compiler.compile('MAIN() { LOOP { } }', vfs, options);
  assert.equal(unused.errors.length, 0, JSON.stringify(unused.errors));
  assert.doesNotMatch(unused.asm, /^STICK:$/m);

  const probe = compiler.compile([
    'MAIN()',
    '{',
    '  VAR I, BASE;',
    '  I=0; BASE=3;',
    '  LOOP',
    '  {',
    '    MEM[$4000+I]=BASE+STICK(0)*2;',
    '    I=I+1;',
    '    IF I==8 THEN EXIT;',
    '  }',
    '  MEM[$4008]=STICK(2);',
    '  MEM[$4009]=STICK($100);',
    '  MEM[$400A]=STICK($FFFF);',
    '  LOOP { }',
    '}',
  ].join('\n'), vfs, options);
  assert.equal(probe.errors.length, 0, JSON.stringify(probe.errors));
  assert.match(probe.asm, /^STICK:$/m);
  assert.doesNotMatch(probe.asm, /\[PSGLIB\]/);
  const assembled = assembler.assemble(probe.asm, { ENV_TYPE: 1 });
  assert.equal(assembled.errors.length, 0, JSON.stringify(assembled.errors));
  assert.ok(assembled.symbols['NAME_SPACE_DEFAULT.STICK'] >= assembled.org);
  assert.ok(assembled.symbols['NAME_SPACE_DEFAULT.SLANG_PROG_END'] < 0x4000);
  assert.ok(assembled.symbols['NAME_SPACE_DEFAULT.__WORKEND__'] < 0x4000);
});

test('SLANG VSYNC, INKEY and inline-assembly references match shipped contracts', () => {
  const entries = new Map(validateReferenceData().entries.map((entry) => [entry.id, entry]));
  const timing = entries.get('slang.x1.timing');
  const inkey = entries.get('slang.x1.inkey');
  const machine = entries.get('slang.machine.calling-convention');
  const inline = entries.get('slang.machine.inline-assembly');
  const files = entries.get('slang.runtime.lsx-io-files');
  const preprocessor = entries.get('slang.preprocessor.includes');
  assert.ok(timing && inkey && machine && inline && files && preprocessor);

  const timingDetails = [timing.summary, ...timing.syntax, ...timing.notes].join(' ');
  assert.match(timingDetails, /VSYNC\(frames\).*exactly one argument/);
  assert.match(timingDetails, /must define VSYNC_PROC/);
  assert.match(timingDetails, /once for every counted frame/);
  for (const relatedId of ['slang.include.tile-sprite', 'slang.include.chiplib', 'slang.x1.sgl']) {
    assert.ok(timing.relatedIds.includes(relatedId));
  }

  const inkeyDetails = [inkey.summary, ...inkey.syntax, ...inkey.notes].join(' ');
  for (const expected of [
    'Mode 0 is non-blocking', 'returns 0', 'held key may be returned on consecutive calls',
    'Mode 1 blocks', 'direct-input result', 'not a one-physical-press edge guarantee',
    'auto-repeat', 'mode value 2 or greater',
    'Right/Left/Up/Down return $1C/$1D/$1E/$1F', 'F1', '$71', '$61',
  ]) assert.ok(inkeyDetails.includes(expected), expected);
  assert.ok(inkey.relatedIds.includes('slang.runtime.lsx-io-files'));
  assert.ok(files.relatedIds.includes('slang.x1.inkey'));
  assert.equal(files.symbols.includes('INKEY'), false);

  const machineDetails = [machine.summary, ...machine.syntax, ...machine.notes].join(' ');
  const inlineDetails = [inline.summary, ...inline.syntax, ...inline.notes].join(' ');
  for (const details of [machineDetails, inlineDetails]) {
    assert.match(details, /explicit argument count/i);
    assert.match(details, /unreliable calls/i);
  }
  for (const expected of [
    'pushed left-to-right', 'argument 4 is at SP+2', 'argument 1 at SP+8',
    'exchanges HL with DE', 'restored to HL after cleanup',
    '2 bytes per argument', 'IX is not a preserved compiler work pointer',
    'IY must be preserved', 'interrupt-enable state unchanged',
  ]) assert.ok(inlineDetails.includes(expected), expected);
  assert.ok(machine.relatedIds.includes('slang.machine.inline-assembly'));
  assert.ok(preprocessor.relatedIds.includes('slang.machine.inline-assembly'));

  for (const id of ['slang.include.tile-sprite', 'slang.include.chiplib', 'slang.x1.sgl']) {
    const consumer = entries.get(id);
    assert.ok(consumer.relatedIds.includes('slang.x1.timing'), `${id} must link the timing contract`);
    for (const example of consumer.examples || []) {
      if (/\b(?:VSYNC|SGL_VSYNC)\s*\(/.test(example.source)) {
        assert.match(example.source, /\bVSYNC_PROC\s*\(/,
          `${id} examples driving the vertical-blank hook must define VSYNC_PROC`);
      }
    }
  }
  assert.match(entries.get('slang.include.tile-sprite').notes.join(' '), /TILE_ANIM_TICK from VSYNC_PROC/);
  assert.match(entries.get('slang.include.chiplib').notes.join(' '), /CHIP_ANIM_TICK from the program's VSYNC_PROC/);
  assert.match(entries.get('slang.x1.sgl').notes.join(' '), /invokes the program's VSYNC_PROC hook/);

  const inputRuntime = readFileSync(join(repoRoot, 'assets/slang_runtime/liblsx_input.asm'), 'utf8');
  assert.match(inputRuntime,
    /^; @name INKEY[\s\S]*LD A,L[\s\S]*CP 1[\s\S]*CALL sGETKY[\s\S]*CALL sFLGET[\s\S]*CALL sINKEY/m);
  const baseRuntime = readFileSync(join(repoRoot, 'assets/slang_runtime/liblsx_base.asm'), 'utf8');
  assert.match(baseRuntime, /^; @name sGETKY[\s\S]*LD\s+E,\$FF[\s\S]*LD\s+C,INPOUT/m);
  assert.match(baseRuntime, /^; @name sFLGET[\s\S]*LD\s+C,DIRIN/m);
  assert.match(baseRuntime, /^; @name sINKEY[\s\S]*CALL\s+sGETKY[\s\S]*JR\s+Z,sINKEY/m);

  const inputSource = readFileSync(join(repoRoot, 'src/Input.cpp'), 'utf8');
  for (const [physical, result] of [['0xcd', '0x1c'], ['0xcb', '0x1d'], ['0xc8', '0x1e'], ['0xd0', '0x1f']]) {
    assert.match(inputSource, new RegExp(`KEY_CHR == ${physical}[\\s\\S]*?data\\[1\\] = ${result}`));
  }
  const baseTable = inputSource.match(/BYTE CHR_TBL0\[\]=\{([\s\S]*?)\n\};/);
  assert.ok(baseTable);
  assert.match(baseTable[1], /\/\* Alt, SPC, Cap, f\.1,[\s\S]*?0x00, ' ',0x00, 'q'/);
  assert.match(baseTable[1], /\/\*  Ｏ,  Ｐ,[\s\S]*?0x0d,0x00, 'a', 's'/);
});

test('documented VSYNC, INKEY and inline-assembly examples compile and assemble', () => {
  const compiler = loadBrowserGlobal('html/x1pen_slang_compiler.js', 'X1PenSlangCompiler');
  const assembler = loadBrowserGlobal('html/x1pen_z80asm.js', 'X1PenZ80Asm');
  const vfs = loadSlangVfs();
  const entries = new Map(validateReferenceData().entries.map((entry) => [entry.id, entry]));
  const options = { defaultOrg: 0x100, codeReadonly: false, defines: { ENV_TYPE: 1 } };

  for (const id of ['slang.x1.timing', 'slang.x1.inkey', 'slang.machine.inline-assembly']) {
    const example = entries.get(id).examples[0];
    const compiled = compiler.compile(example.source, vfs, options);
    assert.equal(compiled.errors.length, 0, `${id}: ${JSON.stringify(compiled.errors)}`);
    const assembled = assembler.assemble(compiled.asm, { ENV_TYPE: 1 });
    assert.equal(assembled.errors.length, 0, `${id}: ${JSON.stringify(assembled.errors)}`);
    assert.ok(assembled.bytes.length > 0, id);
    if (id === 'slang.machine.inline-assembly') {
      assert.match(compiled.asm, /LD\s+HL,\$0064\s+CALL\s+ASMROUTINE/);
      assert.match(compiled.asm, /^ASMROUTINE:/m);
    }
  }

  const abiProbe = compiler.compile([
    'MACHINE ZERO(0):ZERO_ROUTINE;',
    'MACHINE ONE(1):ONE_ROUTINE;',
    'MACHINE TWO(2):TWO_ROUTINE;',
    'MACHINE THREE(3):THREE_ROUTINE;',
    'MACHINE FOUR(4):FOUR_ROUTINE;',
    'MACHINE NUMERIC(0):$1234;',
    'MAIN() BEGIN',
    '  ZERO(); ONE(1); TWO(1,2); THREE(1,2,3); FOUR(1,2,3,4); NUMERIC();',
    'END;',
    '#ASM',
    'ZERO_ROUTINE: RET',
    'ONE_ROUTINE: RET',
    'TWO_ROUTINE: RET',
    'THREE_ROUTINE: RET',
    'FOUR_ROUTINE: RET',
    '#END',
  ].join('\n'), vfs, options);
  assert.equal(abiProbe.errors.length, 0, JSON.stringify(abiProbe.errors));
  assert.match(abiProbe.asm, /CALL\s+ZERO_ROUTINE/);
  assert.match(abiProbe.asm, /LD\s+HL,\$0001\s+CALL\s+ONE_ROUTINE/);
  assert.match(abiProbe.asm, /LD\s+HL,\$0001\s+LD\s+DE,\$0002\s+CALL\s+TWO_ROUTINE/);
  assert.match(abiProbe.asm,
    /LD\s+HL,\$0001\s+LD\s+DE,\$0002\s+LD\s+BC,\$0003\s+CALL\s+THREE_ROUTINE/);
  assert.match(abiProbe.asm,
    /LD\s+HL,\$0001\s+PUSH\s+HL\s+LD\s+HL,\$0002\s+PUSH\s+HL\s+LD\s+HL,\$0003\s+PUSH\s+HL\s+LD\s+HL,\$0004\s+PUSH\s+HL\s+CALL\s+FOUR_ROUTINE\s+EX\s+DE,HL\s+LD\s+HL,8\s+ADD\s+HL,SP\s+LD\s+SP,HL\s+EX\s+DE,HL/);
  assert.match(abiProbe.asm, /CALL\s+\$1234/);
  assert.match(abiProbe.asm, /LD IY,__IYWORK/);
  assert.doesNotMatch(abiProbe.asm, /\bIX\b/,
    'the compiler must not retain an IX work value across MACHINE calls');
  const assembledProbe = assembler.assemble(abiProbe.asm, { ENV_TYPE: 1 });
  assert.equal(assembledProbe.errors.length, 0, JSON.stringify(assembledProbe.errors));
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

test('M8A runtime conditionals preserve both dormant width tables', () => {
  const compiler = loadBrowserGlobal('html/x1pen_slang_compiler.js', 'X1PenSlangCompiler');
  const assembler = loadBrowserGlobal('html/x1pen_z80asm.js', 'X1PenZ80Asm');
  const vfs = loadSlangVfs();
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
