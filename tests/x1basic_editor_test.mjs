import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import vm from 'node:vm';
import { HOST_ANCHOR, HOST_LINE, importEditor, injectHost } from '../scripts/import-x1-basic-editor.mjs';

// X1 BASIC Editor (HuBASIC tab): the committed copy in assets/x1basic, X1Pen's text form of the
// program (html/x1pen_hubasic_text.js) and the header rule that lets x1pen.html frame it.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const editorDir = join(repoRoot, 'assets', 'x1basic');
const source = JSON.parse(readFileSync(join(editorDir, 'source.json'), 'utf8'));
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
for (const file of [join(editorDir, 'src', 'codec.js'), join(repoRoot, 'html', 'x1pen_hubasic_text.js')]) {
  vm.runInContext(readFileSync(file, 'utf8'), context, { filename: file });
}
const { toText, fromText, fromLegacyText } = context.X1PenHuBasicText;
const hex = (bytes) => Buffer.from(bytes).toString('hex');

test('assets/x1basic is one commit of X1 BASIC Editor, unchanged except the host adapter line', () => {
  assert.match(source.commit, /^[0-9a-f]{40}$/);
  assert.equal(source.repository, 'https://github.com/ho-ogino/x1-basic-editor');
  const present = listFiles(editorDir).map((path) => relative(editorDir, path)).filter((path) => path !== 'source.json').sort();
  assert.deepEqual(present, Object.keys(source.files).sort(), 'files that are not in source.json, or missing ones');
  for (const [path, want] of Object.entries(source.files)) {
    let bytes = readFileSync(join(editorDir, path));
    if (path === source.injected.path) {
      const html = bytes.toString('utf8');
      assert.equal(html.split(HOST_LINE).length, 2, 'the host adapter is loaded once');
      assert.ok(html.includes(HOST_LINE + HOST_ANCHOR), 'the host adapter is loaded right before host.js');
      bytes = Buffer.from(html.replace(HOST_LINE, ''), 'utf8');
    }
    assert.equal(bytes.length, want.size, path);
    assert.equal(sha256(bytes), want.sha256, path);
  }
  // The scripts X1Pen relies on, in the order the editor page loads them
  const html = readFileSync(join(editorDir, 'src', 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(scripts.slice(scripts.indexOf('font-builder.js'), scripts.indexOf('host.js') + 1),
    ['font-builder.js', 'x1pen-host.js', 'host.js']);
});

test('the text form reads back every X1 byte', () => {
  for (let b = 0; b < 256; b++) {
    if (b === 0x0A || b === 0x0D) continue;
    const bytes = Uint8Array.of(0x41, b, 0x42, 0x0D, 0x0A);
    assert.equal(hex(fromText(toText(bytes))), hex(bytes), `byte $${b.toString(16)}: ${JSON.stringify(toText(bytes))}`);
  }
  // Newlines come back as CRLF
  assert.equal(hex(fromText(toText(Uint8Array.of(0x41, 0x0D, 0x42, 0x0A, 0x43)))), '410d0a420d0a43');
});

test('the text form writes $5C as ¥ and reads the usual ways to write X1 characters', () => {
  assert.equal(toText(Uint8Array.of(0x31, 0x5C, 0x32)), '1¥2');
  assert.equal(toText(Uint8Array.of(0xE3, 0xB1, 0x01)), '\\{heart}ｱ\\{SOH}');
  assert.equal(hex(fromText('¥')), '5c');
  assert.equal(hex(fromText('\\')), '5c');
  assert.equal(hex(fromText('\\\\')), '5c');
  assert.equal(hex(fromText('\\x41\\{heart}')), '41e3');
  assert.equal(hex(fromText('ｱア♥ガ')), 'b1b1e3b6de');
  assert.equal(hex(fromText('a\nb')), '610d0a62');
  assert.throws(() => fromText('10 REM 漢'), /X1で表現できない文字/);
});

test('text from the former plain HuBASIC tab is migrated without reading escapes', () => {
  const legacy = fromLegacyText('10 REM 漢\\x41\\{heart}\\\\¥ｱ\n20 END');
  assert.equal(legacy.replaced, 1);
  assert.equal(hex(legacy.bytes),
    hex(Buffer.from('10 REM ?\\x41\\{heart}\\\\', 'latin1')) + '5cb1' + '0d0a' + hex(Buffer.from('20 END')));
  assert.equal(fromLegacyText('10 PRINT 1').replaced, 0);
});

test('only x1basic/ may be framed, and only by the same origin', () => {
  const rules = readFileSync(join(repoRoot, 'html', '_headers'), 'utf8').split(/\n\s*\n/).map((block) =>
    block.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#')));
  const rule = (path) => rules.find((lines) => lines[0] === path).slice(1).map((line) => line.trim());
  assert.ok(rule('/*').includes('X-Frame-Options: DENY'));
  assert.ok(rule('/*').includes("Content-Security-Policy: frame-ancestors 'none'"));
  assert.deepEqual(rule('/x1basic/*'), ['! X-Frame-Options', '! Content-Security-Policy',
    "Content-Security-Policy: frame-ancestors 'self'"]);
});

test('the import script copies one clean commit and refuses anything else', async () => {
  const work = mkdtempSync(join(tmpdir(), 'x1basic-import-'));
  try {
    const repo = join(work, 'repo');
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
    mkdirSync(repo);
    git('init', '-q');
    for (const path of Object.keys(source.files)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), path === 'src/index.html' ? `<p>${HOST_ANCHOR}\n` : `${path}\n`);
    }
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '-m', 'x');
    const commit = git('rev-parse', 'HEAD').toString().trim();
    const target = join(work, 'out');

    assert.equal(await importEditor(repo, { expect: commit, target }), commit);
    const copied = JSON.parse(readFileSync(join(target, 'source.json'), 'utf8'));
    assert.equal(copied.commit, commit);
    assert.equal(readFileSync(join(target, 'src', 'index.html'), 'utf8'), `<p>${HOST_LINE}${HOST_ANCHOR}\n`);
    assert.equal(readFileSync(join(target, 'LICENSE'), 'utf8'), 'LICENSE\n');

    await assert.rejects(importEditor(repo, { expect: '0'.repeat(40), target }), /expected/);
    writeFileSync(join(repo, 'LICENSE'), 'changed\n');
    await assert.rejects(importEditor(repo, { target }), /uncommitted/);
    git('checkout', '-q', '--', 'LICENSE');
    writeFileSync(join(repo, 'src', 'index.html'), '<p>no host\n');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '-am', 'y');
    await assert.rejects(importEditor(repo, { target }), /exactly once/);
    // A failed import leaves the previous copy as it was
    assert.equal(JSON.parse(readFileSync(join(target, 'source.json'), 'utf8')).commit, commit);
    assert.throws(() => injectHost(`${HOST_ANCHOR}${HOST_ANCHOR}`), /exactly once/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
