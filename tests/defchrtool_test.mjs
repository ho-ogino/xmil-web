import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import vm from 'node:vm';
import {
  HOST_ANCHOR, HOST_LINE, checkLicenseSection, importDefchrtool, injectHost, localReferences, parseArgs,
} from '../scripts/import-defchrtool.mjs';

// DEFCHR TOOL for Web (PCG tab): the committed build in assets/defchrtool, the import script, and
// what X1Pen inserts for the tool's "X1Pen に挿入" (html/x1pen_pcg_export.js).

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolDir = join(repoRoot, 'assets', 'defchrtool');
const source = JSON.parse(readFileSync(join(toolDir, 'source.json'), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const context = { console };
context.window = context;
vm.createContext(context);
for (const file of ['x1pen_pcg_export.js', 'x1pen_z80asm.js', 'x1pen_slang_compiler.js']) {
  vm.runInContext(readFileSync(join(repoRoot, 'html', file), 'utf8'), context, { filename: file });
}
const pcg = context.X1PenPcgExport;
const plain = (value) => JSON.parse(JSON.stringify(value));

// A Blob stand-in from another window: the right shape, not this realm's Blob
function blobOf(data) {
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  return {
    size: bytes.length,
    type: '',
    text: async () => bytes.toString('utf8'),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
  };
}

function request(fields) {
  return { version: 1, target: 'asm', format: 'asm3', start: 0x41, end: 0x41, fileName: 'pcg.asm', blob: blobOf('x\n'), ...fields };
}

// Bytes that tell the planes and rows apart: B=$00..$07, R=$10..$17, G=$20..$27 (+ $40 per character)
function charsBytes(count, rowOrder) {
  const out = [];
  for (let c = 0; c < count; c++) {
    if (rowOrder) for (let r = 0; r < 8; r++) out.push(0x40 * c + r, 0x40 * c + 0x10 + r, 0x40 * c + 0x20 + r);
    else for (const plane of [0, 0x10, 0x20]) for (let r = 0; r < 8; r++) out.push(0x40 * c + plane + r);
  }
  return out.map((b) => b & 0xff);
}

async function inserted(fields, slangSource = '') {
  const checked = pcg.checkRequest(fields);
  if (!checked.ok) return plain(checked);
  const planned = pcg.plan(checked);
  if (!planned.ok) return plain(planned);
  const data = planned.read === 'text' ? await fields.blob.text() : new Uint8Array(await fields.blob.arrayBuffer());
  return plain(pcg.build(checked, planned, data, slangSource));
}

test('assets/defchrtool is one build of DEFCHR TOOL, unchanged except the host adapter line', () => {
  assert.equal(source.repository, 'https://github.com/h-o-soft/defchrtool');
  assert.equal(source.commit, '07fa3388984be6476ff57bc6d8a2845426a20133');
  assert.equal(source.build.command, 'npm ci && npx vite build --base ./');
  assert.deepEqual(source.injected, { path: 'index.html', line: HOST_LINE, before: HOST_ANCHOR });
  const present = listFiles(toolDir).map((path) => relative(toolDir, path).split('\\').join('/')).sort();
  assert.deepEqual(present, [...Object.keys(source.files), 'source.json'].sort());
  for (const [path, { sha256: digest, size }] of Object.entries(source.files)) {
    let bytes = readFileSync(join(toolDir, path));
    if (path === 'index.html') {
      const html = bytes.toString('utf8');
      assert.equal(html.split(HOST_LINE).length, 2, 'the host line is added once');
      assert.ok(html.includes(HOST_LINE + HOST_ANCHOR), 'right before the module script');
      bytes = Buffer.from(html.replace(HOST_LINE, ''), 'utf8');
    }
    assert.equal(bytes.length, size, `${path} size`);
    assert.equal(sha256(bytes), digest, `${path} sha256`);
  }
  for (const path of ['LICENSE', 'README.md', 'index.html', 'assets/fonts/X1font.png']) assert.ok(source.files[path], path);
  checkLicenseSection(readFileSync(join(toolDir, 'README.md'), 'utf8'));
  const html = readFileSync(join(toolDir, 'index.html'), 'utf8');
  for (const ref of localReferences(html)) {
    if (ref !== 'x1pen-host.js') assert.ok(source.files[ref], `index.html loads ${ref}, which is copied`);
  }
});

test('the import command takes a checkout and an optional --expect commit', () => {
  const commit = 'a'.repeat(40);
  assert.deepEqual(parseArgs(['dir']), { checkout: 'dir', expect: undefined });
  assert.deepEqual(parseArgs(['dir', '--expect', commit]), { checkout: 'dir', expect: commit });
  assert.equal(parseArgs([]), null);
  assert.equal(parseArgs(['dir', '--expect', 'abc']), null);
  assert.equal(parseArgs(['dir', 'other']), null);
  assert.equal(parseArgs(['dir', '--skip-build']), null);
});

test('the import script refuses a README without the MIT section and pages loading other places', () => {
  assert.doesNotThrow(() => checkLicenseSection('# T\n\n## ライセンス\n\nMIT License\n\nCopyright\n'));
  assert.throws(() => checkLicenseSection('# T\n\nMIT License\n'), /no "## ライセンス" section/);
  assert.throws(() => checkLicenseSection('## ライセンス\n\nGPL\n\n## 次\n\nMIT License\n'), /not the MIT License/);
  assert.deepEqual(localReferences('<script type="module" crossorigin src="./assets/a.js"></script><link rel="icon" href="assets/i.png">'),
    ['assets/a.js', 'assets/i.png']);
  assert.throws(() => localReferences('<script src="/defchrtool/assets/a.js"></script>'), /not a relative path/);
  assert.throws(() => localReferences('<script src="https://cdn.example/a.js"></script>'), /not a relative path/);
  assert.throws(() => localReferences('<link href="../x.css">'), /outside the build/);
  assert.equal(injectHost(`<p>${HOST_ANCHOR} src="a.js">`), `<p>${HOST_LINE}${HOST_ANCHOR} src="a.js">`);
  assert.throws(() => injectHost('<p>no module'), /exactly once/);
  assert.throws(() => injectHost(`${HOST_ANCHOR}>${HOST_ANCHOR}>`), /exactly once/);
  assert.throws(() => injectHost(`<script src="x1pen-host.js"></script>${HOST_ANCHOR}>`), /already loads/);
});

test('the import script builds one clean commit and refuses anything else', async () => {
  const work = mkdtempSync(join(tmpdir(), 'defchrtool-import-'));
  try {
    const repo = join(work, 'repo');
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
    const commitAll = (message) => git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '-am', message);
    mkdirSync(repo);
    git('init', '-q');
    writeFileSync(join(repo, 'LICENSE'), 'MIT License\n');
    writeFileSync(join(repo, 'README.md'), '# DEFCHR\n\n## ライセンス\n\nMIT License\n');
    writeFileSync(join(repo, '.gitignore'), 'out/\n');
    git('add', '.');
    commitAll('x');
    const commit = git('rev-parse', 'HEAD').toString().trim();
    const target = join(work, 'assets', 'defchrtool');
    let files = {
      'index.html': `<head>${HOST_ANCHOR} crossorigin src="./assets/index-1.js"></script></head>`,
      'assets/index-1.js': 'load("./assets/fonts/X1font.png")',
      'assets/fonts/X1font.png': 'png',
    };
    let builds = 0;
    const build = (checkout, outDir) => {
      builds++;
      assert.equal(checkout, repo);
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(outDir, path)), { recursive: true });
        writeFileSync(join(outDir, path), text);
      }
      return { node: 'v0', npm: '0' };
    };

    assert.equal(await importDefchrtool(repo, { expect: commit, target, build }), commit);
    const copied = JSON.parse(readFileSync(join(target, 'source.json'), 'utf8'));
    assert.equal(copied.commit, commit);
    assert.deepEqual(copied.build, { command: 'npm ci && npx vite build --base ./', node: 'v0', npm: '0' });
    assert.deepEqual(Object.keys(copied.files).sort(), ['LICENSE', 'README.md', 'assets/fonts/X1font.png', 'assets/index-1.js', 'index.html']);
    assert.equal(copied.files['index.html'].sha256, sha256(Buffer.from(files['index.html'])), 'the build as it was made');
    assert.equal(readFileSync(join(target, 'index.html'), 'utf8'),
      `<head>${HOST_LINE}${HOST_ANCHOR} crossorigin src="./assets/index-1.js"></script></head>`);
    assert.equal(readFileSync(join(target, 'README.md'), 'utf8'), '# DEFCHR\n\n## ライセンス\n\nMIT License\n');
    assert.deepEqual(readdirSync(join(work, 'assets')), ['defchrtool'], 'no build or temporary directory is left');

    const refuses = async (pattern, options = {}) => {
      await assert.rejects(importDefchrtool(repo, { target, build, ...options }), pattern);
      assert.equal(JSON.parse(readFileSync(join(target, 'source.json'), 'utf8')).commit, commit, 'the previous copy stays');
      assert.deepEqual(readdirSync(join(work, 'assets')), ['defchrtool']);
    };
    await refuses(/expected/, { expect: '0'.repeat(40) });
    const good = files;
    files = { ...good, 'index.html': '<head><script src="./assets/index-1.js"></script></head>' };
    await refuses(/exactly once/);
    files = { ...good, 'index.html': `<head>${HOST_ANCHOR} src="/defchrtool/assets/index-1.js"></script></head>` };
    await refuses(/not a relative path/);
    files = { ...good, 'index.html': `<head>${HOST_ANCHOR} src="./assets/missing.js"></script></head>` };
    await refuses(/does not have/);
    files = { ...good, 'source.json': '{}' };
    await refuses(/only index\.html and assets\//);
    files = { 'assets/index-1.js': '' };
    await refuses(/no index\.html/);
    files = good;
    // A build that writes into the checkout's tracked files is not the commit any more
    const dirtyBuild = (checkout, outDir) => { writeFileSync(join(repo, 'LICENSE'), 'changed\n'); return build(checkout, outDir); };
    await refuses(/changed tracked files/, { build: dirtyBuild });
    await refuses(/uncommitted/);
    git('checkout', '-q', '--', 'LICENSE');
    writeFileSync(join(repo, 'README.md'), '# DEFCHR\n');
    commitAll('y');
    const before = builds;
    await refuses(/no "## ライセンス" section/);
    assert.equal(builds, before, 'the license is checked before building');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('the import command runs from the command line', () => {
  const work = mkdtempSync(join(tmpdir(), 'defchrtool-cli-'));
  try {
    const run = (...args) => {
      try {
        execFileSync(process.execPath, [join(repoRoot, 'scripts', 'import-defchrtool.mjs'), ...args], { stdio: 'pipe' });
        return 0;
      } catch (e) {
        return e.status;
      }
    };
    assert.equal(run(), 2, 'no checkout is a usage error');
    assert.equal(run(work), 1, 'a directory that is not a checkout fails the import itself');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('requests are checked by their shape before anything is read', () => {
  assert.equal(pcg.checkRequest(request({})).ok, true);
  assert.equal(pcg.checkRequest(request({ target: 'fuzzybasic', format: 'bas', basFormat: 'asc', start: 0, end: 255 })).count, 256);
  for (const bad of [
    null, 'x', request({ version: 2 }), request({ target: 'basic' }), request({ format: 'png' }),
    request({ format: 'bas' }), request({ format: 'bas', basFormat: 'txt' }),
    request({ start: -1 }), request({ end: 256 }), request({ start: 1.5, end: 2 }), request({ start: 3, end: 2 }),
    request({ start: '0' }), request({ blob: null }), request({ blob: { size: 1, text() {} } }),
    request({ blob: { ...blobOf('x'), size: 1024 * 1024 + 1 } }),
  ]) {
    const result = plain(pcg.checkRequest(bad));
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.equal(result.code, 'invalid');
    assert.equal(typeof result.message, 'string');
  }
});

test('each target and format goes where X1Pen and DEFCHR TOOL agreed', () => {
  const expected = {
    fuzzybasic: { image: null, bin: 'asm/bytes', bin3: 'asm/bytes', basasc: 'asm/text', basbin: null, asm: 'asm/text', asm3: 'asm/text' },
    asm: { image: null, bin: 'asm/bytes', bin3: 'asm/bytes', basasc: 'asm/text', basbin: null, asm: 'asm/text', asm3: 'asm/text' },
    slang: { image: null, bin: 'slang/bytes', bin3: 'slang/bytes', basasc: 'slang/text', basbin: null, asm: 'slang/text', asm3: 'slang/text' },
    hubasic: { image: null, bin: null, bin3: null, basasc: null, basbin: null, asm: null, asm3: null },
  };
  for (const [target, row] of Object.entries(expected)) {
    for (const [key, where] of Object.entries(row)) {
      const format = key.startsWith('bas') ? 'bas' : key;
      const checked = pcg.checkRequest(request({ target, format, basFormat: key.startsWith('bas') ? key.slice(3) : undefined }));
      const planned = plain(pcg.plan(checked));
      if (where === null) {
        assert.deepEqual([planned.ok, planned.code], [false, 'unsupported'], `${target} ${key}`);
      } else {
        assert.equal(`${planned.editor}/${planned.read}`, where, `${target} ${key}`);
      }
    }
  }
  assert.match(pcg.plan(pcg.checkRequest(request({ target: 'hubasic', format: 'bas', basFormat: 'asc' }))).message, /HuBASIC/);
});

test('text formats go in as they are, with CR, CRLF and LF read as lines', async () => {
  assert.deepEqual(await inserted(request({ blob: blobOf('; CHR $41\r\tDB\t$00\r') })), { ok: true, text: '; CHR $41\n\tDB\t$00\n' });
  assert.deepEqual(await inserted(request({ blob: blobOf('a\r\nb') })), { ok: true, text: 'a\nb\n' });
  assert.deepEqual(await inserted(request({ target: 'slang', format: 'bas', basFormat: 'asc', blob: blobOf('60960DEFCHR$(65)=HEXCHR$("00")\r') })),
    { ok: true, text: '60960DEFCHR$(65)=HEXCHR$("00")\n' });
  assert.equal((await inserted(request({ blob: blobOf(' \r\n') }))).code, 'invalid');
});

test('BIN and BIN(x3) keep their byte order as DB lines and as a SLANG array', async () => {
  const rows = charsBytes(2, true);
  const planes = charsBytes(2, false);
  const dollar = (bytes) => bytes.map((b) => '$' + b.toString(16).toUpperCase().padStart(2, '0')).join(',');
  assert.deepEqual(await inserted(request({ format: 'bin3', end: 0x42, blob: blobOf(rows) })), { ok: true, text: [
    '; DEFCHR TOOL: CHR $41-$42 (rows of B,R,G)',
    '; CHR $41', `\tDB\t${dollar(rows.slice(0, 24))}`,
    '; CHR $42', `\tDB\t${dollar(rows.slice(24))}`, ''].join('\n') });
  assert.ok(rows.slice(0, 6).join() === [0x00, 0x10, 0x20, 0x01, 0x11, 0x21].join());
  assert.deepEqual(await inserted(request({ target: 'fuzzybasic', format: 'bin', end: 0x42, blob: blobOf(planes) })), { ok: true, text: [
    '; DEFCHR TOOL: CHR $41-$42 (B[8],R[8],G[8])',
    '; CHR $41', `\tDB\t${dollar(planes.slice(0, 24))}`,
    '; CHR $42', `\tDB\t${dollar(planes.slice(24))}`, ''].join('\n') });
  assert.deepEqual(await inserted(request({ target: 'slang', format: 'bin3', start: 0xff, end: 0xff, blob: blobOf(rows.slice(0, 24)) })), { ok: true, text: [
    '// DEFCHR TOOL: CHR $FF (rows of B,R,G)',
    'ARRAY BYTE PCGFF[] = {',
    `    ${dollar(rows.slice(0, 24))} // $FF`,
    '};', ''].join('\n') });
  assert.deepEqual(await inserted(request({ target: 'slang', format: 'bin', start: 0, end: 1, blob: blobOf(planes) })), { ok: true, text: [
    '// DEFCHR TOOL: CHR $00-$01 (B[8],R[8],G[8])',
    'ARRAY BYTE PCG00[] = {',
    `    ${dollar(planes.slice(0, 24))}, // $00`,
    `    ${dollar(planes.slice(24))} // $01`,
    '};', ''].join('\n') });
  // 256 characters, and a length that does not fit the range
  const all = new Array(256 * 24).fill(0);
  assert.equal((await inserted(request({ format: 'bin3', start: 0, end: 255, blob: blobOf(all) }))).text.split('\tDB\t').length, 257);
  assert.equal((await inserted(request({ format: 'bin3', end: 0x42, blob: blobOf(rows.slice(0, 24)) }))).code, 'invalid');
  assert.equal((await inserted(request({ target: 'slang', format: 'bin', blob: blobOf([]) }))).code, 'invalid');
});

test('the SLANG array name is PCG and the start code, numbered when the program has it', () => {
  assert.equal(pcg.slangArrayName('', 0x41), 'PCG41');
  assert.equal(pcg.slangArrayName('ARRAY BYTE PCG410[] = {0};', 0x41), 'PCG41', 'a longer word is another name');
  assert.equal(pcg.slangArrayName('ARRAY BYTE MYPCG41[] = {0};', 0x41), 'PCG41');
  assert.equal(pcg.slangArrayName('ARRAY BYTE PCG41[] = {0};', 0x41), 'PCG41_2');
  assert.equal(pcg.slangArrayName('pcg41 // and PCG41_2(\n', 0x41), 'PCG41_3', 'any case');
  assert.equal(pcg.slangArrayName('PCGDEF(0, PCG0A);', 0x0a), 'PCG0A_2');
});

test('the inserted DB lines assemble and the SLANG array compiles to the same bytes', async () => {
  const rows = charsBytes(2, true);
  const asm = (await inserted(request({ format: 'bin3', end: 0x42, blob: blobOf(rows) }))).text;
  const assembled = context.X1PenZ80Asm.assemble(`\tORG\t$C000\n${asm}`);
  assert.deepEqual(plain(assembled.errors), []);
  assert.deepEqual([...assembled.bytes], rows);

  const slang = (await inserted(request({ target: 'slang', format: 'bin3', end: 0x42, blob: blobOf(rows) }))).text;
  const runtimeDir = join(repoRoot, 'assets', 'slang_runtime');
  const vfs = Object.fromEntries(readdirSync(runtimeDir).map((name) => [name, readFileSync(join(runtimeDir, name), 'utf8')]));
  const program = `${slang}\nMAIN()\n{\n    PCGDEF($41, PCG41);\n}\n`;
  const compiled = context.X1PenSlangCompiler.compile(program, vfs, { defaultOrg: 0x100, codeReadonly: false, defines: { ENV_TYPE: 1 } });
  assert.deepEqual(plain(compiled.errors), []);
  const data = compiled.asm.split('\n').find((line, i, lines) => lines[i - 1] === '_V_PCG41:');
  assert.equal(data, `\tDB\t${rows.map((b) => '$' + b.toString(16).toUpperCase().padStart(2, '0')).join(',')}`);
});

test('the success message names the tab, the line and the characters', () => {
  const checked = pcg.checkRequest(request({ end: 0x42 }));
  assert.equal(pcg.successMessage(checked, { editor: 'asm', read: 'text' }, 12), 'ASM タブの 12 行目に 2 文字分（$41〜$42）を入れました。');
  assert.equal(pcg.successMessage(pcg.checkRequest(request({ target: 'slang' })), { editor: 'slang', read: 'bytes' }, 1),
    'SLANG タブの 1 行目に 1 文字分（$41）を入れました。配列は関数の外に置いてください。');
});
