import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import vm from 'node:vm';

// The SLANG tab's compiler: slangc of the committed SLANG-compiler bundle (assets/hubasic/<current>/)
// in its x1 environment, through the page's own loader, then X1Pen's assembler with the constants
// the SLANG tab passes. tests/fixtures/slang holds what slangbuild and AILZ80ASM made from the
// bundle's x1 testdata (written by scripts/import-hubasic-bundle.mjs); nothing here reads the
// bundle's source folder.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = join(repoRoot, 'tests', 'fixtures', 'slang');
const current = JSON.parse(readFileSync(join(repoRoot, 'assets', 'hubasic', 'current.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(fixtureDir, 'expected.json'), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');

function loadPage() {
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
  for (const file of ['x1pen_z80asm.js', 'x1pen_slang_wasm.js']) {
    vm.runInContext(readFileSync(join(repoRoot, 'html', file), 'utf8'), context, {
      filename: file, importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
    });
  }
  return context;
}

const page = loadPage();
const ready = page.X1PenSlangWasm.load();
// What the SLANG tab passes to the assembler (getPredefinedSymbols of the LSX-Dodgers cold state)
const SLANG_TAB_SYMBOLS = { OS_TYPE: 0, ENV_TYPE: 1 };

async function compile(source) {
  await ready;
  return page.X1PenSlangWasm.compile(source, 'x1');
}

async function build(source) {
  const compiled = await compile(source);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  const assembled = page.X1PenZ80Asm.assemble(compiled.asm, SLANG_TAB_SYMBOLS);
  assert.deepEqual([...assembled.errors.map((e) => `L${e.line}: ${e.msg}`)], []);
  return { asm: compiled.asm, bytes: Buffer.from(assembled.bytes), org: assembled.org };
}

// The body of one function in slangc's output, from its label to its RET
function functionBody(asm, label) {
  const start = asm.indexOf(`\n${label}:\n`);
  assert.ok(start >= 0, `${label} is in the output`);
  return asm.slice(start, asm.indexOf('\tRET', start));
}

test('the SLANG tab compiles in the x1 environment of the committed bundle', async () => {
  const info = await ready;
  assert.equal(info.revision, current.revision);
  assert.equal(expected.revision, current.revision, 'fixtures belong to another revision; re-run scripts/import-hubasic-bundle.mjs');
  assert.equal(expected.env, 'x1');
  const env = page.X1PenSlangWasm.env('x1');
  assert.deepEqual([env.envType, env.osType, env.defaultOrg], [1, 0, 0x100]);
});

for (const name of Object.keys(expected.programs)) {
  test(`${name}: the SLANG tab makes the same ASM and program as slangbuild and AILZ80ASM`, async () => {
    const source = readFileSync(join(fixtureDir, `${name}.SL`), 'utf8');
    const compiled = await compile(source);
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    assert.equal(compiled.asm, readFileSync(join(fixtureDir, `${name}.ASM`), 'utf8'), `${name}: slangc output`);
    const { bytes, org } = await build(source);
    assert.equal(org, 0x100);
    assert.equal(bytes.length, expected.programs[name].binLength);
    assert.equal(sha256(bytes), expected.programs[name].binSha256);
    assert.equal(Buffer.compare(bytes, readFileSync(join(fixtureDir, `${name}.bin`))), 0);
  });
}

test('there are SLANG fixtures to compare with', () => {
  assert.ok(Object.keys(expected.programs).length > 0, 'tests/fixtures/slang has no programs');
});

// What the SLANG compiler itself does, where the former X1Pen JS port did something else
test('\\N and \\0 in a string are CR and NUL', async () => {
  const { asm } = await build('MAIN()\n{\n  PRINT("A\\NB\\0C");\n}\n');
  assert.ok(asm.includes('DB\t"A",$0D,"B",$00,"C",0'), asm);
});

test('constant shifts fold like the compiler: 1 << 16 is 1, $8000 >> 16 is $8000', async () => {
  const { asm } = await build('CONST A = 1 << 16;\nCONST B = $8000 >> 16;\nVAR X, Y;\nMAIN()\n{\n  X = A; Y = B;\n}\n');
  const main = functionBody(asm, 'MAIN');
  assert.match(main, /LD\tHL,\$0001\n\tLD\t\(_V_X\),HL/);
  assert.match(main, /LD\tHL,\$8000\n\tLD\t\(_V_Y\),HL/);
});

test('EXIT(2) leaves two loops', async () => {
  const { asm } = await build([
    'VAR I, J, K;', 'MAIN()', '{', '  K = 0;', '  FOR I = 0 TO 3 {', '    FOR J = 0 TO 3 {',
    '      IF J == 1 THEN EXIT(2);', '      K++;', '    }', '    K = K + 100;', '  }', '  PRINT(K);', '}', '',
  ].join('\n'));
  const main = functionBody(asm, 'MAIN');
  // The jump of EXIT(2) goes past the outer loop's increment, to the code after both loops
  const exit = /JP\t(_L\d+)\n_L\d+:\n\tLD\tHL,\(_V_K\)\n\tINC\tHL/.exec(main);
  assert.ok(exit, main);
  const after = main.indexOf(`\n${exit[1]}:\n`);
  assert.ok(after > main.indexOf('LD\tDE,$0064'), 'EXIT(2) lands after the outer loop');
});

test('a post-increment gives the value before it', async () => {
  const { asm } = await build('VAR A, B;\nMAIN()\n{\n  A = 1;\n  B = A++ + 10;\n}\n');
  assert.match(functionBody(asm, 'MAIN'), /INC\tHL\n\tLD\t\(_V_A\),HL\n\tDEC\tHL\n\tLD\tDE,\$000A\n\tADD\tHL,DE/);
});

test('a parameter named like a global CONST is the parameter, and CONST works inside a function', async () => {
  const shadow = await build('CONST N = 5;\nVAR R;\nF(N)\n{\n  RETURN N * 2;\n}\nMAIN()\n{\n  R = F(3);\n}\n');
  const body = functionBody(shadow.asm, '_F_F');
  assert.match(body, /LD\tL,\(IY\+\$[0-9A-F]+\)/, 'reads the parameter');
  assert.doesNotMatch(body, /LD\tHL,\$000A/, 'does not use the constant');
  const local = await build('VAR R;\nMAIN()\n{\n  CONST K = 7;\n  R = K;\n}\n');
  assert.match(functionBody(local.asm, 'MAIN'), /LD\tHL,\$0007\n\tLD\t\(_V_R\),HL/);
});

test('a FLOAT condition and side effects in a compound assignment target are errors, with line and column', async () => {
  const float = await compile('FLOAT F;\nVAR I;\nMAIN()\n{\n  F = 1.5;\n  IF F THEN I = 1;\n}\n');
  assert.equal(float.ok, false);
  const floatError = float.diagnostics.find((d) => d.severity === 'error');
  assert.deepEqual([floatError.file, floatError.line, floatError.column], ['PROGRAM.SL', 6, 3]);
  assert.match(floatError.message, /FLOAT value cannot be used as a condition/);
  const index = await compile('ARRAY T[10];\nVAR I;\nMAIN()\n{\n  I = 0;\n  T[I++] += 1;\n}\n');
  assert.equal(index.ok, false);
  assert.match(index.diagnostics.find((d) => d.severity === 'error').message, /Side effects/);
});

test('#INCLUDE reads the bundle\'s include files', async () => {
  const { asm } = await build('#INCLUDE "GRAPH.LIB"\nMAIN()\n{\n}\n');
  assert.ok(asm.length > 0);
  const missing = await compile('#INCLUDE "NONE.LIB"\nMAIN()\n{\n}\n');
  assert.equal(missing.ok, false);
  assert.ok(missing.diagnostics.some((d) => d.severity === 'error'));
});

test('#INCLUDE finds the bundle\'s files whatever the case of the name, as X1Pen did before', async () => {
  // A spelling of its own for each form, so that each one depends on this compile finding it
  for (const line of ['#INCLUDE "graph.lib"', '#include Graph.Lib', '#INCLUDE "GRAPH.LIB"', '#INCLUDE"gRaph.lib"', 'VAR X; #INCLUDE "graPH.lib"']) {
    const compiled = await compile(`${line}\nMAIN()\n{\n}\n`);
    assert.equal(compiled.ok, true, `${line}: ${JSON.stringify(compiled.diagnostics)}`);
  }
});

test('a SLANG build gives the same result before and after HuBASIC builds and disks', async () => {
  // Paths into the bundle's file system where other operations write their files
  const forms = ['#INCLUDE "../hufs/0"', '#INCLUDE "/work/hufs/0"', '#INCLUDE "/work/x1native_hufs/PROGRAM.SL"',
    '#include ../x1native_slfs/PROGRAM.SL', 'VAR Y; #INCLUDE"../hufs/1"', '#INCLUDE "NOFILE.LIB"'];
  const results = async () => {
    const out = [];
    for (const form of forms) {
      const compiled = await compile(`${form}\nMAIN()\n{\n  LEAKED = 1;\n}\n`);
      out.push([form, compiled.ok, compiled.diagnostics.map((d) => `${d.severity} ${d.line}:${d.column} ${d.message}`).join('|')]);
    }
    return out;
  };
  const before = await results();
  // Nothing defines LEAKED: every one of them fails
  for (const [form, ok] of before) assert.equal(ok, false, form);

  const hubasic = await page.X1PenSlangWasm.compile('VAR LEAKED;\nMAIN()\n{\n}\n', 'x1native_hufs');
  assert.equal(hubasic.ok, true, JSON.stringify(hubasic.diagnostics));
  assert.deepEqual(await results(), before, 'after a HuBASIC compile');
  const leak = [{ name: 'LEAK.TXT', kind: 'raw', bytes: new TextEncoder().encode('VAR LEAKED;\n') },
    { name: 'MORE.TXT', kind: 'raw', bytes: new TextEncoder().encode('VAR LEAKED;\n') }];
  const built = await page.X1PenSlangWasm.buildHufsDisk(new Uint8Array([0xC9]), { mainName: 'PROG', files: leak });
  assert.equal(built.ok, true, built.error);
  assert.deepEqual(await results(), before, 'after a disk');
  // A disk that cannot be built, after its files were put in place
  const failed = await page.X1PenSlangWasm.buildHufsDisk(new Uint8Array(70000), { mainName: 'PROG', files: leak });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /65535/);
  assert.deepEqual(await results(), before, 'after a failed disk');
});

test('directive-like text in comments, strings and inactive #IF branches is just text', async () => {
  const sources = [
    'MAIN()\n{\n  // #INCLUDE "/work/hufs/0"\n}\n',
    'MAIN()\n{\n  /* #INCLUDE "../x" */\n}\n',
    'MAIN()\n{\n  PRINT("#INCLUDE \\"/a/b\\"");\n}\n',
    '#IF 0\n#INCLUDE "/no/such/file"\n#ENDIF\nMAIN()\n{\n}\n',
  ];
  for (const source of sources) {
    const compiled = await compile(source);
    assert.equal(compiled.ok, true, `${JSON.stringify(source)}: ${JSON.stringify(compiled.diagnostics)}`);
  }
});

test('an included library read twice stops at its duplicate labels, as the reference says', async () => {
  // slangc reads an #INCLUDE file each time it is named, also inside another include; X1Pen's
  // assembler then stops at the first label made twice. The first error, or 'ok'.
  const firstError = async (source) => {
    const compiled = await compile(source);
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    const errors = page.X1PenZ80Asm.assemble(compiled.asm, SLANG_TAB_SYMBOLS).errors;
    return errors.length ? errors[0].msg : 'ok';
  };
  const program = (libs, head = '') => `${head}${libs.map((lib) => `#INCLUDE "${lib}"\n`).join('')}MAIN()\n{\n}\n`;
  const duplicate = /^Duplicate label: /;
  // Every bundled library makes labels
  for (const lib of ['CHIPLIB.LIB', 'GRAPH.LIB', 'GRAPHF.LIB', 'SOROBAN.LIB', 'SPRLIB.LIB', 'TILELIB.LIB', 'TILESPR.LIB', 'UILIB.LIB']) {
    assert.equal(await firstError(program([lib])), 'ok', lib);
    assert.match(await firstError(program([lib, lib])), duplicate, `${lib} twice`);
  }
  // TILESPR.LIB reads TILELIB.LIB and SPRLIB.LIB: the duplicate is found before any JR goes out of range
  assert.match(await firstError(program(['SPRLIB.LIB', 'TILESPR.LIB'])), /^Duplicate label: SPR_GVRAM /);
  assert.match(await firstError(program(['TILELIB.LIB', 'TILESPR.LIB'])), /^Duplicate label: TILE_TVRAM /);
  // GRAPH.LIB reads SOROBAN.LIB only with _FLOAT=1
  assert.equal(await firstError(program(['SOROBAN.LIB', 'GRAPH.LIB'])), 'ok');
  assert.equal(await firstError(program(['GRAPH.LIB'], 'CONST _FLOAT=1;\n')), 'ok');
  assert.match(await firstError(program(['GRAPH.LIB', 'SOROBAN.LIB'], 'CONST _FLOAT=1;\n')), duplicate);
  // GRAPHF.LIB is GRAPH.LIB's FLOAT and color version, not an addition to it
  assert.match(await firstError(program(['GRAPH.LIB', 'GRAPHF.LIB'])), duplicate);
});

test('CHIPLIB.LIB and TILELIB.LIB multiply with the runtime MULHLDE, once with the program\'s own', async () => {
  // Their top-level #ASM asks for it with a ; @calls MULHLDE line, so a library alone builds too
  for (const [libs, body] of [
    [['CHIPLIB.LIB'], ''],
    [['TILELIB.LIB'], ''],
    [['TILESPR.LIB'], ''],
    [['CHIPLIB.LIB', 'TILESPR.LIB'], '    VAR A, B;\n    A = A * B;\n'],
  ]) {
    const source = `${libs.map((lib) => `#INCLUDE "${lib}"\n`).join('')}MAIN()\n{\n${body}}\n`;
    const compiled = await compile(source);
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    assert.equal((compiled.asm.match(/^MULHLDE:/gm) || []).length, 1, `${libs} has one MULHLDE`);
    assert.doesNotMatch(compiled.asm, /_ChipMulHLDE|_TileMulHLDE/, `${libs} has no multiply of its own`);
    assert.deepEqual([...page.X1PenZ80Asm.assemble(compiled.asm, SLANG_TAB_SYMBOLS).errors].map((e) => e.msg), [], libs.join('+'));
  }
});

test('a program that includes CHIPLIB.LIB, TILELIB.LIB or TILESPR.LIB cannot name a function MULHLDE', async () => {
  // The libraries call the runtime MULHLDE; slangc stops rather than let their CALL reach the program's function
  const own = 'MULHLDE(A, B)\n{\n    RETURN A;\n}\nMAIN()\n{\n    PRINT(MULHLDE(2, 3));\n}\n';
  for (const lib of ['CHIPLIB.LIB', 'TILELIB.LIB', 'TILESPR.LIB']) {
    const compiled = await compile(`#INCLUDE "${lib}"\n${own}`);
    assert.equal(compiled.ok, false, lib);
    assert.match(compiled.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message).join('\n'),
      /@calls MULHLDE: MULHLDE is a user function/, lib);
  }
  // Without them the name is the program's own
  const alone = await compile(own);
  assert.equal(alone.ok, true, JSON.stringify(alone.diagnostics));
});

test('a top-level #ASM asks for a runtime routine with ; @calls', async () => {
  const asm = '#ASM\n; @calls MULHLDE\nTIMES3:\n\tld de,3\n\tcall MULHLDE\n\tret\n#END\n';
  const asked = await compile(`MACHINE T3(1):TIMES3;\nMAIN()\n{\n    PRINT(T3(5));\n}\n${asm}`);
  assert.equal(asked.ok, true, JSON.stringify(asked.diagnostics));
  assert.deepEqual([...page.X1PenZ80Asm.assemble(asked.asm, SLANG_TAB_SYMBOLS).errors].map((e) => e.msg), []);
  // Without the line, the CALL in a top-level #ASM does not bring the routine in
  const notAsked = await compile(`MACHINE T3(1):TIMES3;\nMAIN()\n{\n    PRINT(T3(5));\n}\n${asm.replace('; @calls MULHLDE\n', '')}`);
  assert.equal(notAsked.ok, true, JSON.stringify(notAsked.diagnostics));
  assert.match(page.X1PenZ80Asm.assemble(notAsked.asm, SLANG_TAB_SYMBOLS).errors.map((e) => e.msg).join('\n'), /MULHLDE/);
});

test('a warning comes back with its place and does not stop the build', async () => {
  const compiled = await compile('MAIN()\n{\n}\n#CHAIN "SOROBAN.LIB"\nVAR X;\n');
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  const warning = compiled.diagnostics.find((d) => d.severity === 'warning');
  assert.deepEqual([warning.file, warning.line, warning.column], ['PROGRAM.SL', 5, 1]);
  assert.match(warning.message, /Text after #CHAIN is not read/);
});

test('STICK and TATTR come from the bundle\'s x1 runtime', async () => {
  const { asm } = await build('VAR S;\nMAIN()\n{\n  S = STICK(0);\n  TATTR($07);\n}\n');
  assert.match(asm, /^STICK:/m);
  assert.match(asm, /^TATTR:/m);
});

test('runtime functions are not checked for their number of arguments, as in slangc', async () => {
  // The former X1Pen-only check refused this; slangc passes the call on as written
  const compiled = await compile('MAIN()\n{\n  VSYNC(1, 2);\n}\n');
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
});
