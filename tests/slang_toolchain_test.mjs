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
  for (const line of ['#INCLUDE "graph.lib"', '#include Graph.Lib', '#INCLUDE "GRAPH.LIB"', '#INCLUDE"graph.lib"', 'VAR X; #INCLUDE "graph.lib"']) {
    const compiled = await compile(`${line}\nMAIN()\n{\n}\n`);
    assert.equal(compiled.ok, true, `${line}: ${JSON.stringify(compiled.diagnostics)}`);
  }
});

test('a SLANG program cannot include what the HuBASIC tab put on a disk', async () => {
  await ready;
  const disk = await page.X1PenSlangWasm.buildHufsDisk(new Uint8Array([0xC9]), {
    mainName: 'PROG', files: [{ name: 'LEAK.TXT', kind: 'raw', bytes: new TextEncoder().encode('VAR LEAKED;\n') }],
  });
  assert.equal(disk.ok, true, disk.error);
  for (const path of ['../hufs/0', '/work/hufs/0']) {
    const compiled = await compile(`#INCLUDE "${path}"\nMAIN()\n{\n  LEAKED = 1;\n}\n`);
    assert.equal(compiled.ok, false, `${path} must not give the attachment back`);
  }
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
