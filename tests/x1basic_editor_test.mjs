import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import vm from 'node:vm';
import { HOST_ANCHOR, HOST_LINE, importEditor, injectHost, localReferences, parseArgs } from '../scripts/import-x1-basic-editor.mjs';

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
  // The host adapter builds fonts with X1FontBuilder and comes right before host.js
  assert.ok(scripts.indexOf('font-builder.js') >= 0 && scripts.indexOf('font-builder.js') < scripts.indexOf('x1pen-host.js'));
  assert.equal(scripts.indexOf('x1pen-host.js') + 1, scripts.indexOf('host.js'));
  // Every file the page loads is in the copy; the host adapter is X1Pen's own file, which build.sh
  // puts next to it
  const adapter = join('src', /src="([^"]+)"/.exec(source.injected.line)[1]);
  const refs = localReferences(html);
  assert.ok(refs.includes(adapter));
  for (const ref of refs.filter((ref) => ref !== adapter)) {
    assert.ok(Object.hasOwn(source.files, ref), `src/index.html loads ${ref}, which is not in the copy`);
  }
  const build = readFileSync(join(repoRoot, 'build.sh'), 'utf8');
  statSync(join(repoRoot, 'html', 'x1pen_x1basic_host.js'));
  assert.ok(build.includes('cp "${SCRIPT_DIR}/html/x1pen_x1basic_host.js" ./x1basic/src/x1pen-host.js'));
  assert.ok(build.includes('cp "${SCRIPT_DIR}/html/x1pen_x1basic_host.js" "${DIST_DIR}/x1basic/src/x1pen-host.js"'));
});

test('the import script finds the local files that src/index.html loads', () => {
  assert.deepEqual(localReferences([
    '<link rel="stylesheet" href="style.css"><script src="codec.js"></script>',
    "<script src='../assets/a.js?v=1'></script><script defer src=\"b.js#x\"></script>",
    '<script src="https://example.test/x.js"></script><script src="//example.test/y.js"></script>',
    '<script src="data:text/javascript,1"></script><link rel="icon" href="/favicon.svg"><img src="z.png">',
  ].join('\n')), ['src/style.css', 'src/codec.js', 'assets/a.js', 'src/b.js']);
});

// The cache-busting loops of build.sh, run on copies in a temporary dist/. Production lets the
// browser reuse js, css and fonts for hours without asking, so every one a page or a stylesheet
// loads must carry the build's commit.
const buildScript = readFileSync(join(repoRoot, 'build.sh'), 'utf8');
const htmlCacheBuster = buildScript.match(/^for _html in [^\n]*; do\n[\s\S]*?^done$/m)?.[0];
const cssCacheBuster = buildScript.match(/^for _css in [^\n]*; do\n[\s\S]*?^done$/m)?.[0];
const jsCacheBuster = buildScript.match(/^for _js in [^\n]*; do\n[\s\S]*?^done$/m)?.[0];
// dist path → the source it is built from
const bustedPages = {
  'x1pen.html': join(repoRoot, 'html', 'x1pen.html'),
  'xmillennium.html': join(repoRoot, 'html', 'shell.html'),
  'url-builder.html': join(repoRoot, 'html', 'url-builder.html'),
  'x1pen_charmap.html': join(repoRoot, 'html', 'x1pen_charmap.html'),
  'x1basic/src/index.html': join(editorDir, 'src', 'index.html'),
  'defchrtool/index.html': join(repoRoot, 'assets', 'defchrtool', 'index.html'),
};
const bustedStyles = {
  'library.css': join(repoRoot, 'html', 'library.css'),
  'x1basic/src/style.css': join(editorDir, 'src', 'style.css'),
};

function runCacheBusters(files, hash, loops = [htmlCacheBuster, cssCacheBuster, jsCacheBuster]) {
  const work = mkdtempSync(join(tmpdir(), 'x1pen-cache-busting-'));
  try {
    mkdirSync(join(work, 'x1basic', 'src'), { recursive: true });
    mkdirSync(join(work, 'defchrtool', 'assets'), { recursive: true });
    for (const [path, text] of Object.entries(files)) writeFileSync(join(work, path), text);
    execFileSync('bash', ['-e', '-c', loops.join('\n')], {
      env: { ...process.env, DIST_DIR: work, XMIL_BUILD_HASH: hash },
    });
    return Object.fromEntries(Object.keys(files).map((path) => [path, readFileSync(join(work, path), 'utf8')]));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const isLocal = (url) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url);
const unquote = (value) => value.replace(/^"([^"]*)"$/, '$1');

// The local scripts and stylesheets a page loads, as written
function pageLoads(html) {
  const loads = [...html.matchAll(/<script\b[^>]*\bsrc=("[^"]*"|[^\s>]+)/g)].map((m) => unquote(m[1]));
  for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
    if (/\brel=(?:"stylesheet"|stylesheet[\s>])/.test(tag)) loads.push(unquote(/\bhref=("[^"]*"|[^\s>]+)/.exec(tag)[1]));
  }
  return loads.filter(isLocal);
}

// The local files a stylesheet loads (fonts, images)
const styleLoads = (css) => [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) => m[2]).filter(isLocal);

test('browser builds version every script, stylesheet and stylesheet font of the pages and the HuBASIC iframe', () => {
  assert.ok(htmlCacheBuster, 'the build script must contain the HTML cache-busting loop');
  assert.ok(cssCacheBuster, 'the build script must contain the CSS cache-busting loop');
  const sources = Object.fromEntries([...Object.entries(bustedPages), ...Object.entries(bustedStyles)]
    .map(([path, file]) => [path, readFileSync(file, 'utf8')]));
  // The loads this fix is about; a page that stops loading them makes the test stale, not wrong
  assert.ok(pageLoads(sources['x1basic/src/index.html']).includes('x1pen-host.js'));
  assert.ok(pageLoads(sources['x1basic/src/index.html']).includes('style.css'));
  assert.ok(pageLoads(sources['defchrtool/index.html']).includes('x1pen-host.js'));
  assert.ok(pageLoads(sources['defchrtool/index.html']).some((url) => /^\.\/assets\/index-[^/]+\.js$/.test(url)));
  assert.ok(pageLoads(sources['x1pen.html']).includes('library.css'));
  assert.ok(pageLoads(sources['xmillennium.html']).includes('library.css'));
  assert.ok(pageLoads(sources['x1pen_charmap.html']).includes('x1pen_tokenizer.js'));
  assert.ok(styleLoads(sources['x1basic/src/style.css']).includes('../assets/x1-basic.ttf'));
  for (const hash of ['abc1234', 'def5678']) {
    const built = runCacheBusters(sources, hash);
    for (const [path, html] of Object.entries(built)) {
      const loads = path.endsWith('.css') ? styleLoads(html) : pageLoads(html);
      const before = path.endsWith('.css') ? styleLoads(sources[path]) : pageLoads(sources[path]);
      assert.deepEqual(loads, before.map((url) => `${url}?v=${hash}`), `${path}: every local load is versioned`);
      // Nothing else changes: icons, manifest, links and inline code stay as they are
      assert.equal(html.replaceAll(`?v=${hash}`, ''), sources[path], `${path}: only the versions are added`);
    }
  }
  for (const [path, file] of [...Object.entries(bustedPages), ...Object.entries(bustedStyles)]) {
    assert.equal(readFileSync(file, 'utf8'), sources[path], `${file} must not be modified`);
  }
});

test('the cache-busting loops handle minified pages and leave icons, external and versioned URLs alone', () => {
  const page = '<link rel=stylesheet href=library.css><link rel="stylesheet" href="https://example.test/a.css">'
    + '<link rel=icon href=favicon.svg><link rel="manifest" href="manifest.json"><link rel="stylesheet" href="b.css?x=1">'
    + '<script src="parent.js"></script><script src=unquoted.js></script>';
  const css = '@font-face{src:url("a.woff2")}a{background:url(b.png)}b{background:url(data:image/png;base64,AA)}'
    + "c{src:url(https://example.test/f.ttf)}d{src:url('c.ttf?x=1')}e{src:url('../assets/x1-basic.ttf')}";
  const files = Object.fromEntries([...Object.keys(bustedPages).map((path) => [path, page]),
    ...Object.keys(bustedStyles).map((path) => [path, css])]);
  const once = runCacheBusters(files, 'abc1234');
  for (const path of Object.keys(bustedPages)) {
    assert.equal(once[path], '<link rel=stylesheet href="library.css?v=abc1234"><link rel="stylesheet" href="https://example.test/a.css">'
      + '<link rel=icon href=favicon.svg><link rel="manifest" href="manifest.json"><link rel="stylesheet" href="b.css?x=1">'
      + '<script src="parent.js?v=abc1234"></script><script src="unquoted.js?v=abc1234"></script>', path);
  }
  for (const path of Object.keys(bustedStyles)) {
    assert.equal(once[path], '@font-face{src:url("a.woff2?v=abc1234")}a{background:url(b.png?v=abc1234)}b{background:url(data:image/png;base64,AA)}'
      + "c{src:url(https://example.test/f.ttf)}d{src:url('c.ttf?x=1')}e{src:url('../assets/x1-basic.ttf?v=abc1234')}", path);
  }
  // Running the loops again adds nothing
  assert.deepEqual(runCacheBusters(once, 'abc1234'), once);
});

test('the images DEFCHR TOOL\'s script loads by a fixed name carry the build commit', () => {
  assert.ok(jsCacheBuster, 'the build script must contain the DEFCHR TOOL script loop');
  const toolDir = join(repoRoot, 'assets', 'defchrtool', 'assets');
  const [script] = readdirSync(toolDir).filter((name) => name.endsWith('.js'));
  const path = `defchrtool/assets/${script}`;
  const source = readFileSync(join(toolDir, script), 'utf8');
  assert.equal(source.split('"./assets/fonts/X1font.png"').length, 2, 'the tool loads its font image by this name');
  const built = runCacheBusters({ [path]: source }, 'abc1234', [jsCacheBuster])[path];
  assert.equal(built, source.replace('"./assets/fonts/X1font.png"', '"./assets/fonts/X1font.png?v=abc1234"'));
  const sample = 'a("./assets/x.png");b("./assets/y.png?x=1");c("https://e.test/z.png");d(\'./assets/w.png\')';
  const once = runCacheBusters({ 'defchrtool/assets/t.js': sample }, 'abc1234', [jsCacheBuster])['defchrtool/assets/t.js'];
  assert.equal(once, 'a("./assets/x.png?v=abc1234");b("./assets/y.png?x=1");c("https://e.test/z.png");d(\'./assets/w.png\')');
  assert.equal(runCacheBusters({ 'defchrtool/assets/t.js': once }, 'abc1234', [jsCacheBuster])['defchrtool/assets/t.js'], once);
  // Without any script (the loop's pattern matches nothing) the loop does nothing and does not fail
  assert.deepEqual(runCacheBusters({}, 'abc1234', [jsCacheBuster]), {});
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

test('only x1basic/ and defchrtool/ may be framed, and only by the same origin', () => {
  const rules = readFileSync(join(repoRoot, 'html', '_headers'), 'utf8').split(/\n\s*\n/).map((block) =>
    block.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#')));
  const rule = (path) => rules.find((lines) => lines[0] === path).slice(1).map((line) => line.trim());
  assert.ok(rule('/*').includes('X-Frame-Options: DENY'));
  assert.ok(rule('/*').includes("Content-Security-Policy: frame-ancestors 'none'"));
  for (const path of ['/x1basic/*', '/defchrtool/*']) {
    assert.deepEqual(rule(path), ['! X-Frame-Options', '! Content-Security-Policy',
      "Content-Security-Policy: frame-ancestors 'self'"], path);
  }
  assert.deepEqual(rules.filter((lines) => lines.some((line) => line.includes('! X-Frame-Options'))).map((lines) => lines[0]),
    ['/x1basic/*', '/defchrtool/*']);
});

test('the import command takes a checkout and an optional --expect commit', () => {
  const commit = 'a'.repeat(40);
  assert.deepEqual(parseArgs(['dir']), { checkout: 'dir', expect: undefined });
  assert.deepEqual(parseArgs(['dir', '--expect', commit]), { checkout: 'dir', expect: commit });
  assert.deepEqual(parseArgs(['--expect', commit, 'dir']), { checkout: 'dir', expect: commit });
  assert.equal(parseArgs([]), null);
  assert.equal(parseArgs(['--expect', commit]), null);
  assert.equal(parseArgs(['dir', '--expect']), null);
  assert.equal(parseArgs(['dir', '--expect', 'abc']), null);
  assert.equal(parseArgs(['dir', 'other']), null);
  assert.equal(parseArgs(['dir', '--allow-dirty']), null);
});

test('the import command runs from the command line without --expect', () => {
  const work = mkdtempSync(join(tmpdir(), 'x1basic-cli-'));
  try {
    const run = (...args) => {
      try {
        execFileSync(process.execPath, [join(repoRoot, 'scripts', 'import-x1-basic-editor.mjs'), ...args], { stdio: 'pipe' });
        return 0;
      } catch (e) {
        return e.status;
      }
    };
    assert.equal(run(), 2, 'no checkout is a usage error');
    // A directory that is not a checkout gets past the usage check and fails the import itself
    assert.equal(run(work), 1);
    assert.equal(run(work, '--expect', 'a'.repeat(40)), 1);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
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
    // A page that loads a file the script does not copy would not start in X1Pen
    writeFileSync(join(repo, 'src', 'index.html'), `<script src="extra.js"></script>${HOST_ANCHOR}\n`);
    git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '-am', 'z');
    await assert.rejects(importEditor(repo, { target }), /loads src\/extra\.js, which is not copied/);
    // A failed import leaves the previous copy as it was
    assert.equal(JSON.parse(readFileSync(join(target, 'source.json'), 'utf8')).commit, commit);
    assert.equal(readFileSync(join(target, 'src', 'index.html'), 'utf8'), `<p>${HOST_LINE}${HOST_ANCHOR}\n`);
    assert.throws(() => injectHost(`${HOST_ANCHOR}${HOST_ANCHOR}`), /exactly once/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
