// Build DEFCHR TOOL for Web (https://github.com/h-o-soft/defchrtool) at one commit and copy it into
// assets/defchrtool/, which build.sh publishes as defchrtool/ next to x1pen.html (X1Pen's PCG tab).
//
//   node scripts/import-defchrtool.mjs <checkout-dir> [--expect <40-hex commit>]
//
// <checkout-dir> is a git checkout of the defchrtool repository with a clean worktree, for example:
//   git clone https://github.com/h-o-soft/defchrtool <dir> && git -C <dir> checkout <commit>
// The tool is built the way its X1HOST.md asks (npm ci, then vite build --base ./) with the npm on
// PATH; LICENSE and README.md (whose MIT section X1Pen's license pages point to) are taken from
// the commit's git objects. The only change is one line in index.html that loads X1Pen's host
// adapter (x1pen-host.js) before the tool's module script.
// assets/defchrtool/source.json records the commit, the build and the sha256 of every copied file.
// A Vite build is not guaranteed to give the same bytes on another machine: source.json records
// what this X1Pen ships. Never edit the copied files by hand, change defchrtool and import again.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY = 'https://github.com/h-o-soft/defchrtool';
const BUILD_COMMAND = 'npm ci && npx vite build --base ./';
const UPSTREAM_FILES = ['LICENSE', 'README.md'];
export const HOST_ANCHOR = '<script type="module"';
export const HOST_LINE = '<script src="x1pen-host.js"></script>';

function fail(message) {
  throw new Error(`import-defchrtool: ${message}`);
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { maxBuffer: 64 * 1024 * 1024 });
const npm = (dir, command, args) => execFileSync(command, args, { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });

// npm ci, then the production build into outDir (not the checkout's dist/). Returns the versions used.
export function viteBuild(checkout, outDir) {
  npm(checkout, 'npm', ['ci']);
  npm(checkout, 'npx', ['vite', 'build', '--base', './', '--outDir', outDir, '--emptyOutDir']);
  return {
    node: process.version,
    npm: npm(checkout, 'npm', ['--version']).toString().trim(),
  };
}

// The README section X1Pen's license pages point to: "## ライセンス" with the MIT License text
export function checkLicenseSection(readme) {
  const at = readme.search(/^## ライセンス\s*$/m);
  if (at < 0) fail('README.md has no "## ライセンス" section');
  const rest = readme.slice(at).split('\n').slice(1).join('\n');
  const end = rest.search(/^## /m);
  const section = end < 0 ? rest : rest.slice(0, end);
  if (!/^MIT License\s*$/m.test(section)) fail('the "## ライセンス" section of README.md is not the MIT License');
}

// The built index.html with the host adapter loaded right before the tool's one module script
export function injectHost(html) {
  const at = html.indexOf(HOST_ANCHOR);
  if (at < 0 || html.indexOf(HOST_ANCHOR, at + 1) >= 0) fail(`index.html must contain ${HOST_ANCHOR} exactly once`);
  if (html.includes('x1pen-host.js')) fail('index.html already loads x1pen-host.js');
  return html.slice(0, at) + HOST_LINE + html.slice(at);
}

// What index.html loads (<script src>, <link href>), as paths in the build. Every reference must be
// relative: the tool is published under defchrtool/ and must not reach outside it.
export function localReferences(html) {
  return [...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*(["'])([^"']*)\1/gi)]
    .map((m) => m[2])
    .filter(Boolean)
    .map((ref) => {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(ref)) fail(`index.html loads ${ref}, which is not a relative path`);
      const path = posix.normalize(ref.split(/[?#]/)[0]);
      if (path.startsWith('../')) fail(`index.html loads ${ref}, which is outside the build`);
      return path;
    });
}

async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out.push(relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'));
    else if (!entry.isDirectory()) fail(`the build has ${entry.name}, which is not a file or a directory`);
  }
  return out.sort();
}

export async function importDefchrtool(checkout, { expect, target = join(repoRoot, 'assets', 'defchrtool'), build = viteBuild } = {}) {
  if (!existsSync(join(checkout, '.git'))) fail(`${checkout} is not a git checkout`);
  if (git(checkout, ['status', '--porcelain']).length) fail(`${checkout} has uncommitted changes`);
  const commit = git(checkout, ['rev-parse', 'HEAD']).toString().trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) fail('cannot read the checkout commit');
  if (expect && expect !== commit) fail(`checkout is at ${commit}, expected ${expect}`);

  const upstream = {};
  for (const path of UPSTREAM_FILES) {
    try {
      upstream[path] = git(checkout, ['show', `${commit}:${path}`]);
    } catch {
      fail(`the commit has no ${path}`);
    }
  }
  checkLicenseSection(upstream['README.md'].toString('utf8'));

  const tmp = `${target}.tmp-${process.pid}`;
  const out = `${target}.build-${process.pid}`;
  await rm(tmp, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
  try {
    const versions = build(checkout, out);
    // The build must not have changed the checkout (npm ci and vite write only ignored files)
    if (git(checkout, ['status', '--porcelain']).length) fail(`building changed tracked files in ${checkout}`);

    const built = await listFiles(out);
    for (const path of built) {
      if (path !== 'index.html' && !path.startsWith('assets/')) fail(`the build has ${path}; only index.html and assets/ are expected`);
    }
    if (!built.includes('index.html')) fail('the build has no index.html');
    const htmlBytes = await readFile(join(out, 'index.html'));
    const html = htmlBytes.toString('utf8');
    for (const ref of localReferences(html)) {
      if (!built.includes(ref)) fail(`index.html loads ${ref}, which the build does not have`);
    }

    const files = {};
    for (const path of built) {
      const bytes = path === 'index.html' ? htmlBytes : await readFile(join(out, path));
      files[path] = { sha256: sha256(bytes), size: bytes.length };
      await mkdir(dirname(join(tmp, path)), { recursive: true });
      await writeFile(join(tmp, path), path === 'index.html' ? Buffer.from(injectHost(html), 'utf8') : bytes);
    }
    for (const path of UPSTREAM_FILES) {
      files[path] = { sha256: sha256(upstream[path]), size: upstream[path].length };
      await writeFile(join(tmp, path), upstream[path]);
    }
    const source = {
      repository: REPOSITORY,
      commit,
      build: { command: BUILD_COMMAND, ...versions },
      files,
      injected: { path: 'index.html', line: HOST_LINE, before: HOST_ANCHOR },
    };
    await writeFile(join(tmp, 'source.json'), `${JSON.stringify(source, null, 2)}\n`);
    await rm(target, { recursive: true, force: true });
    await rename(tmp, target);
  } catch (e) {
    await rm(tmp, { recursive: true, force: true });
    throw e;
  } finally {
    await rm(out, { recursive: true, force: true });
  }
  return commit;
}

// Command-line arguments -> { checkout, expect }, or null when they do not match the usage
export function parseArgs(args) {
  let checkout;
  let expect;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--expect') {
      expect = args[++i];
      if (!/^[0-9a-f]{40}$/.test(expect || '')) return null;
    } else if (args[i].startsWith('--') || checkout !== undefined) {
      return null;
    } else {
      checkout = args[i];
    }
  }
  return checkout === undefined ? null : { checkout, expect };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error('usage: node scripts/import-defchrtool.mjs <checkout-dir> [--expect <40-hex commit>]');
    process.exit(2);
  }
  try {
    const commit = await importDefchrtool(resolve(args.checkout), { expect: args.expect });
    console.log(`import-defchrtool: assets/defchrtool is DEFCHR TOOL for Web ${commit}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
