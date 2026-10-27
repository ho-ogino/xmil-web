// Copy a Hu-BASIC bundle into assets/hubasic/<revision>/ and make it current.
//
//   node scripts/import-hubasic-bundle.mjs <bundle-dir> [--allow-dirty]
//
// <bundle-dir> is the output of SLANG-compiler `scripts/build-hubasic-wasm.sh <dir>`:
// _framework/ (hubasic2sl browser-wasm), runtime/ (x1native .asm), env/, manifest.json.
// The wasm converter and the runtime must come from one SLANG-compiler revision, so a
// bundle built from uncommitted sources (manifest dirty: true) is refused unless
// --allow-dirty is given for local experiments. Never commit such a bundle.
// Pre-compressed copies (*.br, *.gz) are skipped; the server compresses on the fly.
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(repoRoot, 'assets', 'hubasic');

const args = process.argv.slice(2);
const allowDirty = args.includes('--allow-dirty');
const bundleDir = args.find((arg) => !arg.startsWith('--'));
if (!bundleDir) {
  console.error('usage: node scripts/import-hubasic-bundle.mjs <bundle-dir> [--allow-dirty]');
  process.exit(2);
}

function fail(message) {
  console.error(`import-hubasic-bundle: ${message}`);
  process.exit(1);
}

const manifest = JSON.parse(await readFile(join(bundleDir, 'manifest.json'), 'utf8'));
const revision = manifest.slangCompilerRevision;
if (typeof revision !== 'string' || !/^[0-9a-f]{40}$/.test(revision)) fail('manifest has no 40-hex slangCompilerRevision');
if (manifest.dirty !== false) {
  if (!allowDirty) fail(`bundle ${revision} was built from uncommitted sources (dirty); rebuild from a clean SLANG-compiler checkout`);
  console.warn('import-hubasic-bundle: WARNING: importing a dirty bundle for local use only; do not commit it');
}
const env = manifest.envs && manifest.envs.x1native_slfs;
if (!env || !Array.isArray(env.libraries)) fail('manifest has no x1native_slfs libraries');
for (const name of ['_framework/dotnet.js', ...env.libraries.map((lib) => `runtime/${lib}`)]) {
  if (!existsSync(join(bundleDir, name))) fail(`bundle is missing ${name}`);
}

const target = join(assetsDir, revision);
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(join(bundleDir, 'manifest.json'), join(target, 'manifest.json'));
for (const dir of ['runtime', 'env']) {
  if (existsSync(join(bundleDir, dir))) await cp(join(bundleDir, dir), join(target, dir), { recursive: true });
}
await cp(join(bundleDir, '_framework'), join(target, '_framework'), {
  recursive: true,
  filter: (source) => !/\.(br|gz)$/.test(source),
});

for (const entry of await readdir(assetsDir, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name !== revision) {
    await rm(join(assetsDir, entry.name), { recursive: true, force: true });
    console.log(`import-hubasic-bundle: removed ${entry.name}`);
  }
}
await writeFile(join(assetsDir, 'current.json'), `${JSON.stringify({ revision }, null, 2)}\n`);
console.log(`import-hubasic-bundle: assets/hubasic/${revision} is current (hubasic2sl ${manifest.hubasic2slVersion}, dirty ${manifest.dirty})`);
