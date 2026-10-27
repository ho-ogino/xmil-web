// Copy the browser part of X1 BASIC Editor (https://github.com/ho-ogino/x1-basic-editor) at one
// commit into assets/x1basic/, which build.sh publishes as x1basic/ next to x1pen.html.
//
//   node scripts/import-x1-basic-editor.mjs <checkout-dir> [--expect <40-hex commit>]
//
// <checkout-dir> is a git checkout of the editor repository with a clean worktree, for example:
//   git clone https://github.com/ho-ogino/x1-basic-editor <dir> && git -C <dir> checkout <commit>
// Files are taken from the checked-out commit (git objects, not the worktree). The only change is
// one line in src/index.html that loads X1Pen's host adapter (x1pen-host.js) before host.js.
// assets/x1basic/source.json records the commit and the sha256 of every upstream file; never edit
// the copied files by hand, change the editor repository and import again.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY = 'https://github.com/ho-ogino/x1-basic-editor';
const FILES = [
  'src/index.html', 'src/style.css', 'src/codec.js', 'src/keywords.js', 'src/syntax.js', 'src/pcg.js',
  'src/font-builder.js', 'src/host.js', 'src/sidebar-resize.js', 'src/editor.js',
  'assets/x1-basic.ttf', 'assets/x1-font.json', 'assets/x1-font-provenance.json', 'assets/licenses/misaki.txt',
  'LICENSE', 'THIRD-PARTY-NOTICES.md',
];
export const HOST_ANCHOR = '<script src="host.js"></script>';
export const HOST_LINE = '<script src="x1pen-host.js"></script>';

function fail(message) {
  throw new Error(`import-x1-basic-editor: ${message}`);
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { maxBuffer: 64 * 1024 * 1024 });

// Upstream index.html with the host adapter loaded right before host.js
export function injectHost(html) {
  const at = html.indexOf(HOST_ANCHOR);
  if (at < 0 || html.indexOf(HOST_ANCHOR, at + 1) >= 0) fail(`src/index.html must contain ${HOST_ANCHOR} exactly once`);
  if (html.includes('x1pen-host.js')) fail('src/index.html already loads x1pen-host.js');
  return html.slice(0, at) + HOST_LINE + html.slice(at);
}

export async function importEditor(checkout, { expect, target = join(repoRoot, 'assets', 'x1basic') } = {}) {
  if (!existsSync(join(checkout, '.git'))) fail(`${checkout} is not a git checkout`);
  if (git(checkout, ['status', '--porcelain']).length) fail(`${checkout} has uncommitted changes`);
  const commit = git(checkout, ['rev-parse', 'HEAD']).toString().trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) fail('cannot read the checkout commit');
  if (expect && expect !== commit) fail(`checkout is at ${commit}, expected ${expect}`);

  const files = {};
  const tmp = `${target}.tmp-${process.pid}`;
  await rm(tmp, { recursive: true, force: true });
  try {
    for (const path of FILES) {
      let bytes = git(checkout, ['show', `${commit}:${path}`]);
      files[path] = { sha256: sha256(bytes), size: bytes.length };
      if (path === 'src/index.html') bytes = Buffer.from(injectHost(bytes.toString('utf8')), 'utf8');
      await mkdir(dirname(join(tmp, path)), { recursive: true });
      await writeFile(join(tmp, path), bytes);
    }
    const source = { repository: REPOSITORY, commit, files, injected: { path: 'src/index.html', line: HOST_LINE, before: HOST_ANCHOR } };
    await writeFile(join(tmp, 'source.json'), `${JSON.stringify(source, null, 2)}\n`);
    await rm(target, { recursive: true, force: true });
    await rename(tmp, target);
  } catch (e) {
    await rm(tmp, { recursive: true, force: true });
    throw e;
  }
  return commit;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const expectAt = args.indexOf('--expect');
  const expect = expectAt >= 0 ? args[expectAt + 1] : undefined;
  const checkout = args.find((arg, i) => !arg.startsWith('--') && i !== expectAt + 1);
  if (!checkout || (expectAt >= 0 && !/^[0-9a-f]{40}$/.test(expect || ''))) {
    console.error('usage: node scripts/import-x1-basic-editor.mjs <checkout-dir> [--expect <40-hex commit>]');
    process.exit(2);
  }
  try {
    const commit = await importEditor(resolve(checkout), { expect });
    console.log(`import-x1-basic-editor: assets/x1basic is X1 BASIC Editor ${commit} (${FILES.length} files)`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
