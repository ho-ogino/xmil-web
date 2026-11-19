import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

// The SLANG tab compiles with slangc from the SLANG-compiler bundle (assets/hubasic/<current>/)
// in its x1 environment: the runtime libraries manifest.envs.x1 lists and the include/ files.
const SLANG_PROFILE = 'x1pen-slang-x1';
const slangRevision = JSON.parse(readFileSync(join(repoRoot, 'assets/hubasic/current.json'), 'utf8')).revision;
const slangBundleDir = join(repoRoot, 'assets/hubasic', slangRevision);
const slangBundleManifest = JSON.parse(readFileSync(join(slangBundleDir, 'manifest.json'), 'utf8'));
const slangRuntimeFiles = slangBundleManifest.envs.x1.libraries;
// The include files the page puts into slangc's file system (x1pen_slang_wasm.js)
const slangIncludeFiles = slangBundleManifest.files
  .map((file) => file.path)
  .filter((path) => /^include\/[A-Za-z0-9_.-]+$/.test(path))
  .map((path) => path.slice('include/'.length));
const readSlangRuntime = (filename) => readFileSync(join(slangBundleDir, 'runtime', filename), 'utf8');
const readSlangInclude = (filename) => readFileSync(join(slangBundleDir, 'include', filename), 'utf8');

// The compiler assembly of the bundle; .NET 10 puts a content hash in the file name
function slangCompilerWasm() {
  const dir = join(slangBundleDir, '_framework');
  const names = readdirSync(dir).filter((name) => /^SLANGCompiler\.Core(\.[a-z0-9]+)?\.wasm$/.test(name));
  assert.equal(names.length, 1, `one SLANGCompiler.Core assembly in ${dir}`);
  return readFileSync(join(dir, names[0]));
}

// The page's own loader (html/x1pen_slang_wasm.js) with the committed bundle, as the SLANG tab
// runs it: the page fetches hubasic/... next to x1pen.html, served here from assets/hubasic/.
function loadSlangPage() {
  const context = {
    console, TextEncoder, TextDecoder, URL, URLSearchParams, atob,
    // The page has one realm; the .NET runtime checks byte arrays with instanceof Uint8Array
    Uint8Array, ArrayBuffer,
    location: { hostname: 'x1.example.test', search: '', href: pathToFileURL(join(repoRoot, 'assets', 'x1pen.html')).href },
    fetch: async (url) => {
      const path = String(url);
      const file = join(repoRoot, 'assets', path);
      if (!path.startsWith('hubasic/') || !existsSync(file)) return { ok: false, status: 404 };
      const bytes = readFileSync(file);
      return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(join(repoRoot, 'html', 'x1pen_slang_wasm.js'), 'utf8'), context, {
    filename: 'x1pen_slang_wasm.js',
    // x1pen_slang_wasm.js imports the bundle's dotnet.js
    importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
  });
  return context;
}

// The bundle is started once for this file and shared by every SLANG test
let slangPagePromise = null;
function slangBundle() {
  if (!slangPagePromise) {
    slangPagePromise = (async () => {
      const page = loadSlangPage();
      await page.X1PenSlangWasm.load();
      return page;
    })();
  }
  return slangPagePromise;
}

// slangc in the x1 environment, as the SLANG tab calls it: { ok, asm, diagnostics }
async function compileSlang(source) {
  const page = await slangBundle();
  return page.X1PenSlangWasm.compile(source, 'x1');
}

const slangAssembler = loadBrowserGlobal('html/x1pen_z80asm.js', 'X1PenZ80Asm');
// The SLANG tab assembles slangc's output with exactly these predefined symbols
const assembleSlang = (asm) => slangAssembler.assemble(asm, { ENV_TYPE: 1, OS_TYPE: 0 });

const slangErrors = (result) => result.diagnostics.filter((d) => d.severity === 'error');

// A runtime routine: from its "; @name" line up to the next one (or the end of the file)
function slangRoutine(source, name) {
  const start = source.indexOf(`; @name ${name}\n`);
  assert.ok(start >= 0, `${name} must be in the runtime`);
  const next = source.indexOf('\n; @name ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

// The instructions of a routine without its comments (the "; @" metadata included)
const slangCode = (routine) => routine.split('\n').map((line) => line.replace(/;.*$/, '')).join('\n');

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

// The reference describes one slangc bundle. Importing another bundle
// (scripts/import-hubasic-bundle.mjs) fails here until the SLANG reference is reviewed and re-stamped.
test('the SLANG reference is stamped with the bundled slangc revision', () => {
  const { manifest, entries } = validateReferenceData();
  const profile = manifest.profiles.find((candidate) => candidate.id === SLANG_PROFILE);
  assert.ok(profile, 'manifest must declare the SLANG profile X1Pen reports');
  assert.equal(manifest.defaultProfiles.slang, SLANG_PROFILE);
  assert.equal(profile.compilerRevision, slangRevision,
    'assets/hubasic changed: review mcp/reference/slang.json and slang-catalogs.json against the new slangc, then update compilerRevision and sourceUrls');
  assert.equal(profile.compilerRevision, slangBundleManifest.slangCompilerRevision);
  assert.equal(profile.slangcVersion, slangBundleManifest.slangcVersion);
  assert.equal(profile.environment.ENV_TYPE, slangBundleManifest.envs.x1.envType);
  assert.equal(profile.environment.OS_TYPE, slangBundleManifest.envs.x1.osType);
  assert.equal(profile.environment.defaultOrg, slangBundleManifest.envs.x1.defaultOrg);

  for (const entry of entries.filter((candidate) => candidate.language === 'slang')) {
    assert.deepEqual(entry.profiles, [SLANG_PROFILE], entry.id);
    assert.ok(entry.sourceUrls.length > 0, entry.id);
    for (const url of entry.sourceUrls) {
      // The runtime and include files are the bundle's (SLANG-compiler URLs), and the compiler is slangc
      if (url.includes('/ho-ogino/xmil-web/')) assert.doesNotMatch(url, /\/assets\/|compiler/, `${entry.id}: ${url}`);
      if (url.includes('/h-o-soft/SLANG-compiler/')) {
        assert.ok(url.includes(`/${slangRevision}`), `${entry.id}: ${url}`);
        const path = url.split(`/${slangRevision}`)[1].replace(/^\//, '');
        if (path) {
          const [area, ...rest] = path.split('/');
          if (area === 'runtime' && rest.length === 1) assert.ok(slangRuntimeFiles.includes(rest[0]), `${entry.id}: ${url}`);
          if (area === 'include' && rest.length === 1) assert.ok(slangIncludeFiles.includes(rest[0]), `${entry.id}: ${url}`);
        }
      }
    }
  }
});

// The SLANG keywords, predefined constants and string functions of docs/SLANG-spec.md at the
// compiler revision (there is no compiler table in X1Pen to read them from)
const SLANG_SPEC_WORDS = [
  'VAR', 'BYTE', 'WORD', 'FLOAT', 'ARRAY', 'CONST', 'MACHINE', 'CODE', 'ASM',
  'IF', 'THEN', 'ELSE', 'ELSEIF', 'EF', 'ENDIF', 'FOR', 'TO', 'DOWNTO', 'DO', 'NEXT',
  'WHILE', 'WEND', 'REPEAT', 'UNTIL', 'LOOP', 'CASE', 'OF', 'OTHERS',
  'EXIT', 'CONTINUE', 'RETURN', 'GOTO', 'BEGIN', 'END', 'MAIN',
  'ORG', 'WORK', 'OFFSET', 'PRINT', 'HIGH', 'LOW', 'NOT', 'CPL', 'MOD', 'AND', 'OR', 'XOR',
  'TRUE', 'FALSE',
  'FORM$', 'DECI$', 'PN$', 'HEX2$', 'HEX4$', 'MSG$', 'MSX$', 'STR$', 'CHR$', 'SPC$', 'CR$', 'TAB$', 'FL$',
  '#INCLUDE', '#CHAIN', '#IF', '#ELSE', '#ENDIF', '#ASM', '#MODULE',
];

test('every SLANG keyword of the specification is covered by a dedicated entry and known to slangc', () => {
  assert.ok(SLANG_SPEC_WORDS.length >= 45);
  const documented = new Set(validateReferenceData().entries
    .filter((entry) => entry.language === 'slang' && entry.kind !== 'catalog')
    .flatMap((entry) => entry.symbols));
  // .NET keeps the lexer's keyword, string-function and directive names as UTF-16 string literals
  // (directives without '#'). Short words can also match inside a longer literal, so this only
  // catches a word slangc has dropped altogether.
  const compiler = slangCompilerWasm();
  for (const word of SLANG_SPEC_WORDS) {
    assert.ok(documented.has(word), `${word} must be covered by a dedicated SLANG entry`);
    const literal = word.replace(/^#/, '');
    assert.ok(compiler.includes(Buffer.from(literal, 'utf16le')), `${literal} is not in SLANGCompiler.Core.wasm`);
  }
  const catalog = new Set(validateReferenceData().entries.find((entry) => entry.id === 'slang.compiler.catalog').symbols);
  for (const word of SLANG_SPEC_WORDS) assert.ok(catalog.has(word), `${word} must be in the compiler catalog`);
});

test('SLANG catalogs cover the exact runtime and include files of the x1 environment', () => {
  const entries = validateReferenceData().entries;
  const runtimeCatalog = new Set(entries.find((entry) => entry.id === 'slang.runtime.catalog').symbols);
  const includeCatalog = new Set(entries.find((entry) => entry.id === 'slang.includes.catalog').symbols);
  const runtimeImplementation = new Set();
  const includeImplementation = new Set();

  assert.ok(slangRuntimeFiles.includes('libx1_arkos.asm') && slangRuntimeFiles.includes('libx1_banjo.asm'));
  assert.deepEqual([...slangIncludeFiles].sort(), readdirSync(join(slangBundleDir, 'include')).sort());
  assert.equal(slangIncludeFiles.length, 8);

  for (const filename of slangRuntimeFiles) {
    for (const match of readSlangRuntime(filename).matchAll(/^; @(?:name|alias) (\S+)/gm)) {
      runtimeImplementation.add(match[1]);
      assert.ok(runtimeCatalog.has(match[1]), `${match[1]} from ${filename} must be in the runtime catalog`);
    }
  }

  for (const filename of slangIncludeFiles) {
    for (const symbol of extractSlangIncludeSymbols(readSlangInclude(filename))) {
      includeImplementation.add(symbol);
      assert.ok(includeCatalog.has(symbol), `${symbol} from ${filename} must be in the include catalog`);
    }
  }

  assert.deepEqual(
    [...runtimeCatalog].filter((symbol) => !runtimeImplementation.has(symbol)),
    [],
    'runtime catalog must not include symbols outside the x1 environment libraries',
  );
  assert.deepEqual(
    [...includeCatalog].filter((symbol) => !includeImplementation.has(symbol)),
    [],
    'include catalog must not include symbols outside the bundled include files',
  );
});

test('documented slangc language behavior matches the bundled compiler', async () => {
  const entries = new Map(validateReferenceData().entries.map((entry) => [entry.id, entry]));
  const text = (id) => JSON.stringify(entries.get(id));

  // String escapes: \N is $0D and \0 is $00
  const escapes = await compileSlang('MAIN()\n{\n  PRINT("A\\NB\\0C");\n}');
  assert.equal(escapes.ok, true, JSON.stringify(escapes.diagnostics));
  assert.match(escapes.asm, /DB\s+"A",\$0D,"B",\$00,"C",0/);
  assert.ok(text('slang.output.print-strings').includes('PRINT(\\"A\\\\NB\\\\0C\\")'));

  // Shift counts use their low 4 bits, and constants fold to the run-time value
  const folding = await compileSlang([
    'CONST A = 1 << 16;',
    'CONST B = $8000 >> 16;',
    'MAIN()',
    '{',
    '  PRINT(A, " ", B, " ", -7 / 2, " ", -2 >> 1, /);',
    '}',
  ].join('\n'));
  assert.equal(folding.ok, true, JSON.stringify(folding.diagnostics));
  const main = folding.asm.slice(folding.asm.indexOf('\nMAIN:'), folding.asm.indexOf('_MAIN_EXIT:'));
  assert.deepEqual([...main.matchAll(/LD\s+HL,(\$[0-9A-F]{4})/g)].map((match) => match[1]),
    ['$0001', '$8000', '$7FFC', '$7FFF']);
  for (const fact of ['1 << 16 is 1', '$8000 >> 16 is $8000', 'CONST A = 1 << 16; makes A equal to 1',
    '-7 / 2 is $7FFC', '-2 >> 1 is $7FFF', 'B = A++ + 10; sets B to 11']) {
    assert.ok(text('slang.expressions.operators').includes(fact), fact);
  }

  // A parameter named like a global CONST is the parameter, not the constant
  const shadow = entries.get('slang.functions.typed').examples
    .find((example) => example.title.includes('global CONST'));
  const shadowed = await compileSlang(shadow.source);
  assert.equal(shadowed.ok, true, JSON.stringify(shadowed.diagnostics));
  const twice = shadowed.asm.slice(shadowed.asm.indexOf('\nTWICE:'), shadowed.asm.indexOf('_TWICE_EXIT:'));
  assert.match(twice, /\(IY\+\$6E\)/);
  assert.doesNotMatch(twice, /\$0005/);

  // CONST inside a function, but not with a global name
  assert.equal((await compileSlang('MAIN()\n{\n  CONST K = 7;\n  PRINT(K, /);\n}')).ok, true);
  const clash = await compileSlang('CONST K = 1;\nMAIN()\n{\n  CONST K = 7;\n  PRINT(K, /);\n}');
  assert.match(slangErrors(clash)[0].message, /CONST 'K' in function 'MAIN' has the same name as a global name/);
  assert.ok(text('slang.data.types-declarations').includes("CONST 'K' in function 'MAIN' has the same name as a global name"));

  // EXIT(n) leaves n loops; it cannot exceed the enclosing loops
  assert.equal((await compileSlang(entries.get('slang.control.flow').examples[0].source)).ok, true);
  const tooDeep = await compileSlang('MAIN()\n{\n  LOOP { EXIT(2); }\n}');
  assert.match(slangErrors(tooDeep)[0].message, /EXIT\(2\) exceeds the loop nesting/);

  // Errors slangc reports
  const floatCondition = await compileSlang('MAIN()\n{\n  VAR FLOAT F;\n  F = 1.5;\n  IF F THEN PRINT(1);\n}');
  assert.match(slangErrors(floatCondition)[0].message, /^A FLOAT value cannot be used as a condition/);
  assert.ok(text('slang.control.flow').includes('A FLOAT value cannot be used as a condition'));
  const sideEffect = await compileSlang('ARRAY T[3];\nMAIN()\n{\n  VAR I;\n  I = 0;\n  T[I++] += 1;\n}');
  assert.match(slangErrors(sideEffect)[0].message, /^Side effects .* are not allowed in the index of the target of \+\+\/--/);
  assert.ok(text('slang.expressions.operators').includes('T[I++] += 1'));
  assert.ok(text('slang.limits.gotchas').includes('IF F THEN'));
});

test('slangc checks MACHINE, built-in and user argument counts but not runtime function counts', async () => {
  const entries = new Map(validateReferenceData().entries.map((entry) => [entry.id, entry]));
  const firstError = async (source) => slangErrors(await compileSlang(source))[0]?.message;

  assert.equal(await firstError('MACHINE P():$1234;\nMAIN()\n{\n  P(1);\n}'), "Function 'P' expects 0 arguments, got 1");
  assert.equal(await firstError('MACHINE P(2):$1234;\nMAIN()\n{\n  P(1);\n}'), "Function 'P' expects 2 arguments, got 1");
  assert.equal(await firstError('MAIN()\n{\n  BEEP(1);\n}'), "Function 'BEEP' expects 0 arguments, got 1");
  assert.equal(await firstError('MAIN()\n{\n  WIDTH();\n}'), "Function 'WIDTH' expects 1 arguments, got 0");
  assert.equal(await firstError('G(X) { RETURN(X); }\nMAIN()\n{\n  PRINT(G(1,2), /);\n}'), "Function 'G' expects 1 arguments, got 2");
  assert.equal(await firstError('MAIN()\n{\n  VAR FLOAT F;\n  F = FSIN(1.0, 2.0);\n}'), "Function 'FSIN' expects 1 arguments, got 2");

  // Runtime functions are called with the arguments given; their "; @param_count" is not checked
  const runtime = await compileSlang('VSYNC_PROC() { }\nMAIN()\n{\n  VSYNC();\n  VSYNC(1,2);\n  STICK();\n  TATTR(1,2);\n}');
  assert.equal(runtime.ok, true, JSON.stringify(runtime.diagnostics));
  assert.match(readSlangRuntime('libx1_print.asm'), /^; @name TATTR\n; @resident shared\n; @param_count 1$/m);

  const machine = JSON.stringify(entries.get('slang.machine.calling-convention'));
  assert.ok(machine.includes('passing any argument to it is an error'));
  assert.ok(machine.includes('does not check how many there are'));
  for (const id of ['slang.x1.timing', 'slang.x1.input', 'slang.x1.text-attribute', 'slang.limits.gotchas']) {
    assert.match(JSON.stringify(entries.get(id)), /not check|not checked/, id);
  }
  // Nothing claims that runtime argument counts are validated
  for (const entry of validateReferenceData().entries.filter((candidate) => candidate.language === 'slang')) {
    assert.doesNotMatch(JSON.stringify(entry), /param_count|arity metadata|Runtime function '/, entry.id);
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
    'part of the x1 environment',
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

  const routine = slangRoutine(readSlangRuntime('libx1_print.asm'), 'TATTR');
  assert.match(routine, /^; @calls sWORK,X1WORK$/m);
  const code = slangCode(routine);
  assert.match(code, /LD\s+A,H\s+OR\s+A\s+JR\s+NZ,\.tattr_ng/);
  assert.match(code, /LD\s+A,\(AT_WIDTH\)[\s\S]*LD\s+BC,1000[\s\S]*CP\s+41[\s\S]*LD\s+BC,2000[\s\S]*LD\s+HL,\(_TXADR\)/);
  assert.match(code, /SET\s+5,B/);
  assert.equal((code.match(/OUT\s+\(C\),A/g) || []).length, 1);
  assert.doesNotMatch(code, /\bIN\s+|\bDI\b|\bEI\b|LD\s+\(_TXADR\),/);
});

test('SLANG TATTR compiles, assembles and stays dependency-pruned', async () => {
  const unused = await compileSlang('MAIN() { LOOP { } }');
  assert.equal(unused.ok, true, JSON.stringify(unused.diagnostics));
  assert.doesNotMatch(unused.asm, /^TATTR:$/m);

  const probe = await compileSlang([
    'MAIN()',
    '{',
    '  MEM[$4000]=TATTR($27);',
    '  MEM[$4001]=TATTR($FF);',
    '  MEM[$4002]=TATTR($100);',
    '  LOOP { }',
    '}',
  ].join('\n'));
  assert.equal(probe.ok, true, JSON.stringify(probe.diagnostics));
  assert.match(probe.asm, /^TATTR:$/m);
  const assembled = assembleSlang(probe.asm);
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
    'active-low', '255 ($00FF)', 'Up', 'Down', 'Left', 'Right',
    'Button 4', 'Button 2 (B)', 'Button 1 (A)', 'Button 3',
    '(NEW XOR OLD) AND OLD', 'PSG register 7', 'bit 6 for port A, bit 7 for port B',
    'writes register 7 back with its previous value',
    'restores the interrupt state it was called with', "after the caller's DI it returns with interrupts still disabled",
    'LD A,I', 'NMI handler',
  ]) {
    assert.ok(details.includes(expected), expected);
  }
  assert.doesNotMatch(details, /returns with interrupts enabled|does not rewrite register 7/);
  assert.ok(stick.relatedIds.includes('x1.io.psg-joystick'));
  const hardware = entries.find((entry) => entry.id === 'x1.io.psg-joystick');
  assert.ok(hardware.relatedIds.includes('slang.x1.input'));

  const editorLanguage = readFileSync(join(repoRoot, 'src/x1pen_slang_lang.js'), 'utf8');
  const builtinBlock = editorLanguage.match(/var SLANG_BUILTINS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(builtinBlock);
  assert.match(builtinBlock[1], /'STICK'/);

  const code = slangCode(slangRoutine(readSlangRuntime('libx1_base.asm'), 'STICK'));
  // 0 or 1 only; anything else is $00FF with no I/O
  assert.match(code, /LD A,H\s+OR A\s+JR NZ,\.STICK_INVALID\s+LD A,L\s+CP 2\s+JR NC,\.STICK_INVALID/);
  assert.match(code, /\.STICK_INVALID\s+LD HL,\$00FF\s+RET/);
  // The interrupt state comes from LD A,I and is restored: EI only when it was enabled
  assert.match(code, /LD A,I\s+JP PE,\.STICK_ON[\s\S]*LD D,0[\s\S]*\.STICK_ON\s+LD D,1\s+\.STICK_READ\s+DI/);
  // Register 7 is read, the port's bit cleared for input, the port read, then register 7 restored
  assert.match(code, /LD BC,\$1C00\s+LD A,7\s+OUT \(C\),A\s+LD B,\$1B\s+IN E,\(C\)[\s\S]*LD A,\$BF[\s\S]*LD A,\$7F[\s\S]*AND E\s+OUT \(C\),A/);
  assert.match(code, /ADD A,\$0E\s+OUT \(C\),A\s+LD B,\$1B\s+IN L,\(C\)\s+LD B,\$1C\s+LD A,7\s+OUT \(C\),A\s+LD B,\$1B\s+OUT \(C\),E\s+LD H,0\s+LD A,D\s+OR A\s+RET Z\s+EI\s+RET/);
});

test('SLANG STICK compiles, assembles and stays dependency-pruned', async () => {
  const unused = await compileSlang('MAIN() { LOOP { } }');
  assert.equal(unused.ok, true, JSON.stringify(unused.diagnostics));
  assert.doesNotMatch(unused.asm, /^STICK:$/m);

  const probe = await compileSlang([
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
  ].join('\n'));
  assert.equal(probe.ok, true, JSON.stringify(probe.diagnostics));
  assert.match(probe.asm, /^STICK:$/m);
  assert.doesNotMatch(probe.asm, /\[PSGLIB\]/);
  const assembled = assembleSlang(probe.asm);
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
  assert.match(timingDetails, /undefined VSYNC_PROC and assembly fails/);
  for (const relatedId of ['slang.include.tile-sprite', 'slang.include.chiplib', 'slang.x1.sgl']) {
    assert.ok(timing.relatedIds.includes(relatedId));
  }

  const inkeyDetails = [inkey.summary, ...inkey.syntax, ...inkey.notes].join(' ');
  for (const expected of [
    'Mode 0 is non-blocking', 'returns 0', 'held key may be returned on consecutive calls',
    'Mode 1 delegates', 'LSX DIRIN', 'buffered input result', 'empty buffer',
    'not a one-physical-press edge guarantee', 'key repeat', 'mode value 2 or greater',
    'Right/Left/Up/Down return $1C/$1D/$1E/$1F', 'F1', '$71', '$61',
  ]) assert.ok(inkeyDetails.includes(expected), expected);
  assert.ok(inkey.relatedIds.includes('slang.runtime.lsx-io-files'));
  assert.ok(files.relatedIds.includes('slang.x1.inkey'));
  assert.equal(files.symbols.includes('INKEY'), false);

  const machineDetails = [machine.summary, ...machine.syntax, ...machine.notes].join(' ');
  const inlineDetails = [inline.summary, ...inline.syntax, ...inline.notes].join(' ');
  for (const details of [machineDetails, inlineDetails]) {
    assert.match(details, /explicit argument count/i);
    assert.match(details, /passing any argument to it is an error/);
    assert.doesNotMatch(details, /unreliable calls/i);
  }
  for (const expected of [
    'pushed left-to-right', 'argument 4 is at SP+2', 'argument 1 at SP+8',
    'exchanges HL with DE', 'restored to HL after cleanup',
    '2 bytes per argument', 'IX is not a preserved compiler work pointer',
    'IY must be preserved', 'interrupt-enable state unchanged', '_F_<name>',
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

  assert.match(slangRoutine(readSlangRuntime('libx1_base.asm'), 'VSYNC_CHECK'), /JP !VSYNC_PROC/);
  const inputRuntime = readSlangRuntime('liblsx_input.asm');
  assert.match(inputRuntime,
    /^; @name INKEY[\s\S]*LD A,L[\s\S]*CP 1[\s\S]*CALL sGETKY[\s\S]*CALL sFLGET[\s\S]*CALL sINKEY/m);
  const baseRuntime = readSlangRuntime('liblsx_base.asm');
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

test('documented VSYNC, INKEY and inline-assembly examples compile and assemble', async () => {
  const entries = new Map(validateReferenceData().entries.map((entry) => [entry.id, entry]));

  for (const id of ['slang.x1.timing', 'slang.x1.inkey', 'slang.machine.inline-assembly']) {
    const example = entries.get(id).examples[0];
    const compiled = await compileSlang(example.source);
    assert.equal(compiled.ok, true, `${id}: ${JSON.stringify(compiled.diagnostics)}`);
    const assembled = assembleSlang(compiled.asm);
    assert.equal(assembled.errors.length, 0, `${id}: ${JSON.stringify(assembled.errors)}`);
    assert.ok(assembled.bytes.length > 0, id);
    if (id === 'slang.machine.inline-assembly') {
      assert.match(compiled.asm, /LD\s+HL,\$0064\s+CALL\s+ASMROUTINE/);
      assert.match(compiled.asm, /^ASMROUTINE:/m);
    }
  }

  // VSYNC without the VSYNC_PROC hook compiles, but its output does not assemble
  const noHook = await compileSlang('MAIN()\n{\n  VSYNC(1);\n}');
  assert.equal(noHook.ok, true, JSON.stringify(noHook.diagnostics));
  assert.ok(assembleSlang(noHook.asm).errors.some((error) => /VSYNC_PROC/.test(error.msg)));

  const abiProbe = await compileSlang([
    'MACHINE ZERO(0):ZERO_ROUTINE;',
    'MACHINE ONE(1):ONE_ROUTINE;',
    'MACHINE TWO(2):TWO_ROUTINE;',
    'MACHINE THREE(3):THREE_ROUTINE;',
    'MACHINE FOUR(4):FOUR_ROUTINE;',
    'MACHINE NUMERIC(0):$1234;',
    'MAIN()',
    '{',
    '  ZERO(); ONE(1); TWO(1,2); THREE(1,2,3); FOUR(1,2,3,4); NUMERIC();',
    '}',
    '#ASM',
    'ZERO_ROUTINE: RET',
    'ONE_ROUTINE: RET',
    'TWO_ROUTINE: RET',
    'THREE_ROUTINE: RET',
    'FOUR_ROUTINE: RET',
    '#END',
  ].join('\n'));
  assert.equal(abiProbe.ok, true, JSON.stringify(abiProbe.diagnostics));
  assert.match(abiProbe.asm, /CALL\s+ZERO_ROUTINE/);
  assert.match(abiProbe.asm, /LD\s+HL,\$0001\s+CALL\s+ONE_ROUTINE/);
  assert.match(abiProbe.asm, /LD\s+HL,\$0001\s+LD\s+DE,\$0002\s+CALL\s+TWO_ROUTINE/);
  assert.match(abiProbe.asm,
    /LD\s+HL,\$0001\s+LD\s+DE,\$0002\s+LD\s+BC,\$0003\s+CALL\s+THREE_ROUTINE/);
  assert.match(abiProbe.asm,
    /LD\s+HL,\$0001\s+PUSH\s+HL\s+LD\s+HL,\$0002\s+PUSH\s+HL\s+LD\s+HL,\$0003\s+PUSH\s+HL\s+LD\s+HL,\$0004\s+PUSH\s+HL\s+CALL\s+FOUR_ROUTINE\s+EX\s+DE,HL\s+LD\s+HL,8\s+ADD\s+HL,SP\s+LD\s+SP,HL\s+EX\s+DE,HL/);
  assert.match(abiProbe.asm, /CALL\s+\$1234/);
  assert.match(abiProbe.asm, /LD IY,__IYWORK/);
  const program = abiProbe.asm.slice(abiProbe.asm.indexOf('\nMAIN:'), abiProbe.asm.indexOf('_MAIN_EXIT:'));
  assert.doesNotMatch(program, /\bIX\b/,
    'the compiler must not retain an IX work value across MACHINE calls');
  const assembledProbe = assembleSlang(abiProbe.asm);
  assert.equal(assembledProbe.errors.length, 0, JSON.stringify(assembledProbe.errors));

  // A function named like a Z80 instruction gets the _F_ entry label
  const renamed = await compileSlang('ADD(X) { RETURN(X+1); }\nMAIN()\n{\n  PRINT(ADD(1), /);\n}');
  assert.equal(renamed.ok, true, JSON.stringify(renamed.diagnostics));
  assert.match(renamed.asm, /^_F_ADD:$/m);
  assert.match(renamed.asm, /CALL\s+_F_ADD/);
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

test('every SLANG example compiles with the bundled slangc and assembles', async () => {
  const { entries } = validateReferenceData();
  const examples = entries
    .filter((entry) => entry.language === 'slang')
    .flatMap((entry) => (entry.examples || []).map((example) => [entry.id, example]));
  assert.ok(examples.length >= 6);
  for (const [id, example] of examples) {
    const result = await compileSlang(example.source);
    assert.equal(result.ok, true, `${id}: ${example.title}: ${JSON.stringify(result.diagnostics)}`);
    assert.equal(result.diagnostics.length, 0, `${id}: ${example.title} must compile without warnings: ${JSON.stringify(result.diagnostics)}`);
    const assembled = assembleSlang(result.asm);
    assert.equal(assembled.errors.length, 0, `${id}: ${example.title}: ${JSON.stringify(assembled.errors)}`);
    assert.ok(assembled.bytes.length > 0, `${id}: ${example.title} must produce bytes`);
  }
});

test('documented embedded M8A example compiles and assembles with its dependencies', async () => {
  const entry = validateReferenceData().entries
    .find((candidate) => candidate.id === 'slang.x1.assets-compression');
  const example = entry.examples.find((candidate) => candidate.title.includes('embedded M8A'));
  assert.ok(example, 'the M8ALOAD reference must retain its executable embedded-data example');
  assert.match(example.source, /MAIN\(\)\s*\{\s*M8ALOAD\(/, 'M8ALOAD is the only X1 call of the example');

  const compiled = await compileSlang(example.source);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  assert.match(compiled.asm, /CALL\s+M8ALIB\.M8ALOAD/);
  assert.match(compiled.asm, /NAME_SPACE_DEFAULT\.AT_WIDTH/);

  const assembled = assembleSlang(compiled.asm);
  assert.equal(assembled.errors.length, 0, JSON.stringify(assembled.errors));
  assert.ok(assembled.bytes.length > 0);
  assert.equal(assembled.symbols['M8ALIB.GVRAMADRS_LO'], undefined,
    'the shipped CALCSPEED=0 build must omit dormant address tables');
  assert.equal(assembled.symbols['M8ALIB.GVRAMADRS_HI'], undefined,
    'the shipped CALCSPEED=0 build must omit dormant address tables');
  assert.ok('NAME_SPACE_DEFAULT.AT_WIDTH' in assembled.symbols);

  // M8ALOAD reads AT_WIDTH and links the X1 work area itself
  assert.match(slangRoutine(readSlangRuntime('libm8a.asm'), 'M8ALOAD'), /^; @calls .*X1WORK/m);
  assert.match(entry.notes.join(' '), /links that area itself/);
});

test('M8A runtime conditionals preserve both dormant width tables', async () => {
  const m8aSource = readSlangRuntime('libm8a.asm');
  assert.match(m8aSource, /^CALCSPEED\s+EQU\s+0\b/m);
  assert.match(m8aSource, /^WIDTH\s+EQU\s+40\b/m);
  assert.match(m8aSource, /^#IF CALCSPEED != 0 && WIDTH == 40$/m);
  assert.match(m8aSource, /^#ELIF CALCSPEED != 0 && WIDTH == 80$/m);

  const compiled = await compileSlang([
    'ARRAY BYTE DATA[] = {$4D,$38,$41,$00,$01,$01,$49,$49,$49,$49};',
    'MAIN()',
    '{',
    '  WIDTH(40);',
    '  M8ALOAD(DATA,0,0);',
    '}',
  ].join('\n'));
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  // The library's switches are in the generated source; X1Pen's assembler must take either table
  for (const width of [40, 80]) {
    const variant = compiled.asm
      .replace(/^CALCSPEED\s+EQU\s+0\b/m, 'CALCSPEED\tEQU\t1')
      .replace(/^WIDTH\s+EQU\s+40\b/m, `WIDTH\tEQU\t${width}`);
    assert.notEqual(variant, compiled.asm);
    const assembled = assembleSlang(variant);
    assert.equal(assembled.errors.length, 0,
      `WIDTH=${width} must assemble: ${JSON.stringify(assembled.errors)}`);
    const tableAddress = assembled.symbols['M8ALIB.GVRAMADRS_LO'];
    assert.ok(Number.isInteger(tableAddress), `WIDTH=${width} must emit its low table`);
    assert.equal(assembled.bytes[tableAddress - assembled.org + 8], width === 40 ? 0x28 : 0x50,
      `WIDTH=${width} must select the matching table payload`);
  }
});

test('M8A runtime does not affect unused programs or MAGLOAD assembly', async () => {
  for (const [name, source, expectedRuntime] of [
    ['unused', 'MAIN() { }', null],
    ['MAGLOAD', 'MAIN() { MAGLOAD("A:X.MAG",0,0); }', 'MAGLOAD'],
  ]) {
    const compiled = await compileSlang(source);
    assert.equal(compiled.ok, true,
      `${name} control must compile: ${JSON.stringify(compiled.diagnostics)}`);
    assert.equal(compiled.asm.includes('[M8ALIB]'), false, `${name} must not pull M8ALOAD`);
    if (expectedRuntime) assert.ok(compiled.asm.includes(expectedRuntime));
    const assembled = assembleSlang(compiled.asm);
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
    const source = readSlangInclude(filename);
    for (const name of names) {
      assert.ok(source.includes(name), `${name} must exist in ${filename}`);
      assert.ok(documented.includes(name), `${name} must be covered by the reference`);
    }
  }
  // The documented argument counts are the libraries' MACHINE declarations, which slangc checks
  const tile = getReferenceEntries({ ids: ['slang.include.tile-sprite'] }).entries[0];
  for (const [name, count] of [['TILE_SET_MAP', 3], ['TILE_SET_SCROLL', 2], ['SPR_SET_POS', 3]]) {
    const library = name.startsWith('SPR') ? 'SPRLIB.LIB' : 'TILELIB.LIB';
    assert.match(readSlangInclude(library), new RegExp(`^MACHINE ${name}\\(${count}\\):`, 'm'));
    assert.ok(tile.syntax.join(' ').includes(`${name}(${count} args)`), name);
  }
});

test('PCG reference matches the bundled X1 runtime contract', () => {
  const runtime = readSlangRuntime('libx1_pcg.asm');
  const details = JSON.stringify(getReferenceEntries({
    ids: ['fuzzybasic.x1.pcg-definition', 'slang.x1.pcg-definition', 'slang.include.tile-sprite'],
    maxCharacters: 32 * 1024,
  }).entries);
  for (const name of ['PCGDEF', 'PCGDEFS', 'GETCGROM']) {
    assert.match(runtime, new RegExp(`; @name ${name}\\b`));
    assert.ok(details.includes(name));
  }
  assert.match(runtime, /HL = STARTIDX .* DE = ADDR \(24 bytes\/tile\), BC = COUNT/);
  assert.match(runtime, /HL = CODE \(ANK; 実際は L のみ使用、H は無視\), DE = ADR \(格納先、 8 バイト書込\)/);
  assert.ok(details.includes('24-byte'));
  assert.ok(details.includes('Blue, Red, Green'));
});

const HUBASIC_PROFILE = 'x1pen-hubasic-x1native';

// The converter assembly of a bundle; .NET 10 puts a content hash in the file name
function converterWasm(bundleDir) {
  const dir = join(bundleDir, '_framework');
  const names = readdirSync(dir).filter((name) => /^hubasic2sl-wasm(\.[a-z0-9]+)?\.wasm$/.test(name));
  assert.equal(names.length, 1, `one hubasic2sl-wasm assembly in ${dir}`);
  return readFileSync(join(dir, names[0]));
}

function hubasicEntries() {
  return validateReferenceData().entries.filter((entry) => entry.language === 'hubasic');
}

test('representative Japanese and English queries reach dedicated HuBASIC entries', () => {
  const cases = new Map([
    ['VSYNC', 'hubasic.timing.vsync-wait'],
    ["'#VSYNC", 'hubasic.timing.vsync-wait'],
    ['ウェイト', 'hubasic.timing.vsync-wait'],
    ['DEFCHR$', 'hubasic.pcg.defchr'],
    ['PCG 定義', 'hubasic.pcg.defchr'],
    ['PCGDEF', 'hubasic.pcg.defchr'],
    ['LABEL', 'hubasic.flow.jumps-labels'],
    ['CIRCLE', 'hubasic.unsupported'],
    ['\\xHH', 'hubasic.program.text-form'],
    ['エスケープ', 'hubasic.program.text-form'],
    ['ジョイスティック', 'hubasic.input.keys'],
    ['塗りつぶし', 'hubasic.graphics.line-paint'],
    ['conversion options', 'hubasic.x1pen.run'],
  ]);

  for (const [query, expectedId] of cases) {
    const result = searchReference({ language: 'hubasic', query, maxResults: 3 });
    assert.equal(result.matches[0]?.id, expectedId, query);
  }
});

test('every HuBASIC reference entry is reachable through relatedIds', () => {
  const entries = hubasicEntries();
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

// The reference describes one hubasic2sl bundle. Importing another bundle
// (scripts/import-hubasic-bundle.mjs) fails here until the reference is reviewed and re-stamped.
test('the HuBASIC reference is stamped with the bundled hubasic2sl revision', () => {
  const { manifest } = validateReferenceData();
  const current = JSON.parse(readFileSync(join(repoRoot, 'assets/hubasic/current.json'), 'utf8'));
  const bundle = JSON.parse(readFileSync(join(repoRoot, 'assets/hubasic', current.revision, 'manifest.json'), 'utf8'));
  const profile = manifest.profiles.find((candidate) => candidate.id === HUBASIC_PROFILE);
  assert.ok(profile, 'manifest must declare the HuBASIC profile X1Pen reports');
  assert.equal(manifest.defaultProfiles.hubasic, HUBASIC_PROFILE);
  assert.equal(profile.runtimeRevision, current.revision,
    'assets/hubasic changed: review mcp/reference/hubasic.json against the new hubasic2sl, then update runtimeRevision and sourceUrls');
  assert.equal(profile.runtimeRevision, bundle.slangCompilerRevision);
  assert.equal(profile.hubasic2slVersion, bundle.hubasic2slVersion);
  assert.match(readFileSync(join(repoRoot, 'html/x1pen.js'), 'utf8'), new RegExp(`id: '${HUBASIC_PROFILE}'`));

  for (const entry of hubasicEntries()) {
    assert.deepEqual(entry.profiles, [HUBASIC_PROFILE], entry.id);
    const slangUrls = entry.sourceUrls.filter((url) => url.includes('/h-o-soft/SLANG-compiler/'));
    assert.ok(slangUrls.length > 0, `${entry.id}: must name the SLANG-compiler source it was written from`);
    for (const url of slangUrls) assert.ok(url.includes(`/${current.revision}/`), `${entry.id}: ${url}`);
  }
});

test('every HuBASIC catalog word is a keyword string of the bundled converter', () => {
  const current = JSON.parse(readFileSync(join(repoRoot, 'assets/hubasic/current.json'), 'utf8'));
  const converter = converterWasm(join(repoRoot, 'assets/hubasic', current.revision));
  const [catalog] = getReferenceEntries({ ids: ['hubasic.keywords.catalog'] }).entries;
  const groups = catalog.syntax.map((line) => line.slice(line.indexOf(':') + 1).trim().split(/\s+/));
  const grouped = groups.flat();
  // MID$ and TIME are both a statement and a function; every other word has one group
  assert.deepEqual(grouped.filter((word, index) => grouped.indexOf(word) !== index).sort(), ['MID$', 'TIME']);
  assert.deepEqual([...new Set(grouped)].sort(), [...catalog.symbols].sort());
  for (const word of catalog.symbols) {
    // .NET keeps string literals as UTF-16; POKE@/PEEK@ are POKE/PEEK plus '@' in the lexer
    const literal = word.replace(/@$/, '');
    assert.ok(converter.includes(Buffer.from(literal, 'utf16le')), `${word} is not in hubasic2sl-wasm.wasm`);
  }

  const dedicated = new Set(hubasicEntries()
    .filter((entry) => entry.kind !== 'catalog')
    .flatMap((entry) => entry.symbols));
  const [statements, noop, functions] = groups;
  assert.deepEqual([...statements, ...noop, ...functions].filter((word) => !dedicated.has(word)), []);
});

test('HuBASIC DEFCHR$ reference matches the bundled runtime byte order', () => {
  const current = JSON.parse(readFileSync(join(repoRoot, 'assets/hubasic/current.json'), 'utf8'));
  const runtime = readFileSync(join(repoRoot, 'assets/hubasic', current.revision, 'runtime/libx1_basic.asm'), 'utf8');
  const routine = runtime.slice(runtime.indexOf('; @name BAS_DEFCHR'), runtime.indexOf('; @name BAS_SCGPAT'));
  assert.match(routine, /青 8・赤 8・緑 8 の面ごとの並び/);
  assert.match(routine, /PCGDEF が受け取る「行ごとに青・赤・緑」の並びに組み替えて書く/);
  assert.match(routine, /p\*8\+r\) を、先 r\*3\+p へ/);

  const [defchr] = getReferenceEntries({ ids: ['hubasic.pcg.defchr'] }).entries;
  assert.match(defchr.summary, /8 blue rows, then 8 red rows, then 8 green rows/);
  assert.match(defchr.summary, /blue 16, red 16, green 16/);
  assert.match(defchr.summary, /PCGDEF/);
  assert.ok(defchr.relatedIds.includes('fuzzybasic.x1.pcg-definition'));
});

test('HuBASIC VSYNC reference matches the converter wait contract', () => {
  const [entry] = getReferenceEntries({ ids: ['hubasic.timing.vsync-wait'] }).entries;
  const text = JSON.stringify(entry);
  assert.match(entry.summary, /VSYNC \[n\]/);
  assert.match(entry.summary, /'#VSYNC n waits n frames only when the X1Pen HuBASIC option wait is frame mode/);
  // The example tool calls use values x1pen_set_hubasic_options accepts
  const options = loadBrowserGlobal('html/x1pen_hubasic_options.js', 'X1PenHuBasicOptions');
  for (const match of text.matchAll(/\\"wait\\":\\"([^\\"]+)\\"/g)) {
    assert.doesNotThrow(() => options.apply(options.defaults(), { wait: match[1] }), match[1]);
  }
  assert.match(text, /frame:1/);
});

test('HuBASIC INIT reference keeps the screen width, as the bundled runtime does', () => {
  const current = JSON.parse(readFileSync(join(repoRoot, 'assets/hubasic/current.json'), 'utf8'));
  const runtime = readFileSync(join(repoRoot, 'assets/hubasic', current.revision, 'runtime/libx1_basic.asm'), 'utf8');
  const routine = runtime.slice(runtime.indexOf('; @name BAS_INIT2'), runtime.indexOf('; @name BAS_SETPAL'));
  assert.match(routine, /INIT 文: 色・表示モード・装飾を戻す \(WIDTH は戻さない\)/);
  assert.match(routine, /JP BAS_INITSTATE/);
  const [screen] = getReferenceEntries({ ids: ['hubasic.text.screen'] }).entries;
  assert.ok(screen.notes.some((note) => /INIT .*keeps the screen width/.test(note)));
  assert.ok(!JSON.stringify(screen).includes('WIDTH 40, default palette'));
});

test('HuBASIC MIRROR$ and HEXCHR$ reference matches the bundled converter and runtime', () => {
  const current = JSON.parse(readFileSync(join(repoRoot, 'assets/hubasic/current.json'), 'utf8'));
  const bundle = join(repoRoot, 'assets/hubasic', current.revision);
  const runtime = readFileSync(join(bundle, 'runtime/libx1_basic.asm'), 'utf8');
  const converter = converterWasm(bundle);
  const routine = (name) => runtime.slice(runtime.indexOf(`; @name ${name}\n`), runtime.indexOf('; @name ', runtime.indexOf(`; @name ${name}\n`) + 1));

  // A variable argument goes to BAS_SMIRRORV, which reverses it in place; other arguments are copied by BAS_SMIRROR
  assert.match(routine('BAS_SMIRRORV'), /本物の MIRROR\$ は、引数が変数なら変数も書き換え/);
  assert.match(routine('BAS_SMIRROR'), /一時領域に写してから/);
  for (const name of ['BAS_SMIRRORV', 'BAS_SMIRROR']) {
    assert.ok(converter.includes(Buffer.from(name, 'utf16le')), `${name} is not in hubasic2sl-wasm.wasm`);
  }
  const [mirror] = getReferenceEntries({ ids: ['hubasic.functions.mirror'] }).entries;
  assert.match(mirror.title, /rewrites a variable argument in place/);
  assert.match(mirror.summary, /also rewrites that variable in place/);
  assert.ok(mirror.syntax.some((line) => /MIRROR\$\(A\$\+""\)\s+B\$ is reversed, A\$ is unchanged/.test(line)));

  // HEXCHR$ skips spaces only, takes a lone digit as a byte and refuses the empty string
  const hexchr = routine('BAS_SHEX');
  assert.match(hexchr, /スペースは区切りとして飛ばし、\s*; スペースか終わりの前の 1 桁は 1 バイトにする/);
  assert.match(hexchr, /空の文字列・16 進でもスペースでもない文字はエラー 5/);
  assert.match(hexchr, /CP ' '/);
  const [entry] = getReferenceEntries({ ids: ['hubasic.functions.hexchr'] }).entries;
  assert.match(entry.summary, /Spaces are separators/);
  assert.match(entry.summary, /a single digit before a space or at the end becomes one byte/);
  assert.match(entry.summary, /An empty string.*is error 5/);
  // The rule before 55e7271 must not survive anywhere
  for (const other of hubasicEntries()) assert.ok(!/odd length/i.test(JSON.stringify(other)), other.id);

  // Dedicated entries come first for the new words
  for (const [query, id] of [['MIRROR$', 'hubasic.functions.mirror'], ['HEXCHR$', 'hubasic.functions.hexchr'], ['MUSIC', 'hubasic.sound.play']]) {
    assert.equal(searchReference({ query, language: 'hubasic' }).matches[0].id, id, query);
  }
});

test('HuBASIC CONSOLE reference matches the bundled converter and runtime', () => {
  const current = JSON.parse(readFileSync(join(repoRoot, 'assets/hubasic/current.json'), 'utf8'));
  const bundle = join(repoRoot, 'assets/hubasic', current.revision);
  const runtime = readFileSync(join(bundle, 'runtime/libx1_basic.asm'), 'utf8');
  const converter = converterWasm(bundle);
  const routine = (name) => runtime.slice(runtime.indexOf(`; @name ${name}\n`), runtime.indexOf('; @name ', runtime.indexOf(`; @name ${name}\n`) + 1));

  // The window limits output, but LOCATE and the PRINT , stops keep absolute screen coordinates
  assert.match(routine('BAS_CONSOLE'), /ys 0〜24、yl 1〜25-ys、xs 0〜桁数-1、xl 1〜桁数-xs を外れたらエラー 5/);
  assert.match(routine('BAS_LOCATE'), /画面の絶対の座標。テキストの窓 \(CONSOLE。ふだんは全画面\) の外はエラー 5/);
  assert.match(routine('BAS_PZONE'), /次の 10 桁区切り \(画面の絶対の桁\)/);
  assert.match(routine('BAS_PZONE'), /窓の右端まで空白を出して折り返し/);
  assert.match(routine('BAS_PCHR'), /\$0E 上へ詰める、\$0F 下へ空ける/);
  assert.match(routine('BAS_PCHR'), /CP \$0E\nJP Z, \.bp_rup\nCP \$0F\nJP Z, \.bp_rdn/);
  for (const name of ['BAS_CONSOLE0', 'BAS_CONSOLEY', 'BAS_CONSOLE']) {
    assert.ok(converter.includes(Buffer.from(name, 'utf16le')), `${name} is not in hubasic2sl-wasm.wasm`);
  }

  const [consoleEntry] = getReferenceEntries({ ids: ['hubasic.text.console'] }).entries;
  assert.match(consoleEntry.title, /LOCATE, TAB and PRINT , use absolute screen coordinates/);
  assert.match(consoleEntry.summary, /coordinates are NOT relative to the window/);
  assert.match(consoleEntry.summary, /LOCATE to a cell outside the window is error 5/);
  assert.ok(consoleEntry.syntax.some((line) => /top-left cell is LOCATE 10,5, not LOCATE 0,0/.test(line)));
  assert.ok(consoleEntry.notes.some((note) => /ys 0-24, yl 1 to 25-ys, xs 0 to width-1, xl 1 to width-xs/.test(note)));
  const [print] = getReferenceEntries({ ids: ['hubasic.text.print'] }).entries;
  assert.match(print.summary, /CHR\$\(14\) and CHR\$\(15\) shift rows/);
  assert.ok(print.notes.some((note) => /absolute screen columns 0, 10, 20, 30/.test(note) && /overwritten/.test(note)));
  const [screen] = getReferenceEntries({ ids: ['hubasic.text.screen'] }).entries;
  assert.ok(screen.notes.some((note) => /outside the CONSOLE window, is error 5/.test(note)));

  for (const [query, id] of [['CONSOLE', 'hubasic.text.console'], ['CHR$(14)', 'hubasic.text.print'], ['text window', 'hubasic.text.console']]) {
    assert.equal(searchReference({ query, language: 'hubasic' }).matches[0].id, id, query);
  }
});

test('HuBASIC V16 envelope, WIDTH rows and KEYLIST/KLIST/KMODE reference matches the bundled converter and runtime', () => {
  const current = JSON.parse(readFileSync(join(repoRoot, 'assets/hubasic/current.json'), 'utf8'));
  const bundle = join(repoRoot, 'assets/hubasic', current.revision);
  const runtime = readFileSync(join(bundle, 'runtime/libx1_basic.asm'), 'utf8');
  const converter = converterWasm(bundle);
  const routine = (name) => runtime.slice(runtime.indexOf(`; @name ${name}\n`), runtime.indexOf('; @name ', runtime.indexOf(`; @name ${name}\n`) + 1));

  // MML V is 0-16 (16 is the PSG envelope); every note rewrites R13 so the envelope restarts
  const note = routine('BAS_PLNOTE');
  assert.match(note, /音量 0-16 \(16 は PSG のエンベロープ\)/);
  assert.match(note, /V17 は 1、V107 は 10、V255 は 2/);
  assert.match(note, /エンベロープの形 \(R13\) を PSG から読んで同じ値を書き直す/);
  assert.match(note, /LD A, 13\nOUT \(C\), A\nLD B, \$1B\nIN A, \(C\)\nOUT \(C\), A/);
  for (const literal of ['KEYLIST', 'KLIST', 'KMODE', 'HB0705', 'HB0706']) {
    assert.ok(converter.includes(Buffer.from(literal, 'utf16le')), `${literal} is not in hubasic2sl-wasm.wasm`);
  }

  const [sound] = getReferenceEntries({ ids: ['hubasic.sound.play'] }).entries;
  assert.match(sound.summary, /MML volume V is 0-16, not 0-15/);
  assert.match(sound.summary, /V16 uses the PSG hardware envelope/);
  assert.ok(sound.notes.some((note) => /V17 is volume 1, V107 is 10, V255 is 2/.test(note)));
  assert.ok(sound.notes.some((note) => /SOUND 13,n/.test(note) && /restarts on each note/.test(note) && /SOUND 11,n and SOUND 12,n/.test(note)));
  const [screen] = getReferenceEntries({ ids: ['hubasic.text.screen'] }).entries;
  assert.ok(screen.notes.some((note) => /always 25 rows/.test(note) && /HB0705/.test(note) && /HB0703/.test(note)));
  const [keys] = getReferenceEntries({ ids: ['hubasic.input.keys'] }).entries;
  for (const word of ['KEYLIST', 'KLIST', 'KMODE']) assert.ok(keys.symbols.includes(word), word);
  assert.ok(keys.notes.some((note) => /supported statements that do nothing/.test(note) && /HB0706/.test(note) && /HB0301/.test(note)));

  for (const [query, id] of [['V16', 'hubasic.sound.play'], ['envelope', 'hubasic.sound.play'], ['KEYLIST', 'hubasic.input.keys'],
    ['KLIST', 'hubasic.input.keys'], ['KMODE', 'hubasic.input.keys']]) {
    assert.equal(searchReference({ query, language: 'hubasic' }).matches[0].id, id, query);
  }
});

test('HuBASIC BIN$, two-dimensional arrays and the --string-len hints reference matches the bundled converter and runtime', () => {
  const current = JSON.parse(readFileSync(join(repoRoot, 'assets/hubasic/current.json'), 'utf8'));
  const bundle = join(repoRoot, 'assets/hubasic', current.revision);
  const runtime = readFileSync(join(bundle, 'runtime/libx1_basic.asm'), 'utf8');
  const converter = converterWasm(bundle);
  const routine = (name) => runtime.slice(runtime.indexOf(`; @name ${name}\n`), runtime.indexOf('; @name ', runtime.indexOf(`; @name ${name}\n`) + 1));

  // BIN$ is the 16-bit value in binary without leading zeros ("0" for 0)
  assert.match(routine('BAS_SBINS'), /2 進 \(頭の 0 なし。0 は "0"\)/);
  // 3-D is HB0303, mixed rank HB0314; HB0305 has a generic --string-len hint (no number), and the 2-D
  // undimensioned case and HB0309 name a value
  for (const literal of ['3 次元以上の配列は未対応です', 'HB0314', '--string-len で 1 本を短くすると上限が増えます',
    '以下にしてください', '以下にすると収まります']) {
    assert.ok(converter.includes(Buffer.from(literal, 'utf16le')), `${literal} is not in hubasic2sl-wasm.wasm`);
  }

  const [strings] = getReferenceEntries({ ids: ['hubasic.functions.string'] }).entries;
  assert.ok(strings.symbols.includes('BIN$'));
  assert.match(strings.summary, /BIN\$\(5\) is "101" \(not "0000000000000101"\)/);
  assert.match(strings.summary, /WITHOUT leading zeros/);
  assert.match(strings.summary, /BIN\$\(-1\) is sixteen 1s/);
  assert.ok(strings.notes.every((note) => !/BIN\$.*HB0302/.test(note)));
  const [arrays] = getReferenceEntries({ ids: ['hubasic.values.arrays'] }).entries;
  assert.match(arrays.summary, /one or two dimensions/);
  assert.match(arrays.summary, /three or more are error HB0303/);
  assert.match(arrays.summary, /11x11 = 121 elements/);
  assert.ok(arrays.notes.some((note) => /HB0314/.test(note) && /Duplicate definition/.test(note)));
  assert.ok(arrays.notes.some((note) => /134 or less/.test(note)));
  assert.ok(arrays.notes.some((note) => /without a number/.test(note) && /names 134/.test(note) && /HB0309/.test(note)));
  const [diagnostics] = getReferenceEntries({ ids: ['hubasic.diagnostics'] }).entries;
  assert.ok(diagnostics.syntax.some((line) => /HB0303/.test(line) && /HB0314/.test(line) && /HB0305/.test(line)));
  assert.ok(diagnostics.notes.some((note) => /--string-len/.test(note) && /stringLen/.test(note) && /without a number/.test(note)));
  const [run] = getReferenceEntries({ ids: ['hubasic.x1pen.run'] }).entries;
  assert.ok(run.notes.some((note) => /stringLen is hubasic2sl's --string-len/.test(note)));
  const [unsupported] = getReferenceEntries({ ids: ['hubasic.unsupported'] }).entries;
  assert.ok(!unsupported.symbols.includes('BIN$'));
  assert.ok(!unsupported.summary.includes('BIN$'));
  const [catalog] = getReferenceEntries({ ids: ['hubasic.keywords.catalog'] }).entries;
  assert.ok(catalog.syntax.find((line) => line.startsWith('functions:')).split(/\s+/).includes('BIN$'));
  assert.ok(!catalog.syntax.find((line) => line.startsWith('reserved, not supported:')).split(/\s+/).includes('BIN$'));

  for (const [query, id] of [['BIN$', 'hubasic.functions.string'], ['binary digits', 'hubasic.functions.string'],
    ['two-dimensional array', 'hubasic.values.arrays'], ['2 次元', 'hubasic.values.arrays']]) {
    assert.equal(searchReference({ query, language: 'hubasic' }).matches[0].id, id, query);
  }
  // Both entries explain these: the code list and hints, and the arrays or the option
  for (const [query, ids] of [['HB0314', ['hubasic.diagnostics', 'hubasic.values.arrays']],
    ['--string-len', ['hubasic.diagnostics', 'hubasic.x1pen.run']]]) {
    assert.deepEqual(searchReference({ query, language: 'hubasic' }).matches.slice(0, 2).map((match) => match.id).sort(), ids, query);
  }
});
