// Regenerate the Hu-BASIC conformance fixtures with the real SLANG-compiler tools.
//
//   node scripts/make-hubasic-fixtures.mjs <SLANG-compiler-dir>
//
// For each tests/fixtures/hubasic/*.BAS this runs `hubasic2sl --emit disk` (which calls slangbuild,
// slangc and AILZ80ASM) and stores what tests/hubasic_toolchain_test.mjs compares X1Pen's JS
// toolchain against: the SLANG source, the binary, the work-area symbol addresses from the
// listing, and the SHA-256 of the disk image. Requires dotnet and a built SLANG-compiler
// (src/*/bin/Release/net8.0). Run it whenever assets/hubasic/current.json changes revision, with
// the SLANG-compiler checkout at that revision.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = join(repoRoot, 'tests', 'fixtures', 'hubasic');
const slangDir = process.argv[2] && resolve(process.argv[2]);
if (!slangDir) {
  console.error('usage: node scripts/make-hubasic-fixtures.mjs <SLANG-compiler-dir>');
  process.exit(2);
}

function git(...args) {
  const r = spawnSync('git', ['-C', slangDir, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

const revision = git('rev-parse', 'HEAD');
const current = JSON.parse(readFileSync(join(repoRoot, 'assets', 'hubasic', 'current.json'), 'utf8'));
if (current.revision !== revision) {
  console.error(`make-hubasic-fixtures: SLANG-compiler is at ${revision}, but the imported bundle is ${current.revision}`);
  process.exit(1);
}
if (git('status', '--porcelain', '--', 'runtime', 'src/SLANGCompiler.HuBasic')) {
  console.warn('make-hubasic-fixtures: WARNING: runtime/ or src/SLANGCompiler.HuBasic has uncommitted changes');
}

const tools = join(slangDir, 'src');
const hubasic2sl = join(tools, 'SLANGCompiler.HuBasic', 'bin', 'Release', 'net8.0', 'hubasic2sl');
const slangbuild = join(tools, 'SLANGCompiler.Build', 'bin', 'Release', 'net8.0', 'slangbuild');

// Work-area symbols as printed in the AILZ80ASM listing: "  ADDR   NAME EQU (__WORK__ + N)"
function workSymbols(listing) {
  const symbols = {};
  for (const line of listing.split(/\r?\n/)) {
    const m = line.match(/^\s+([0-9A-F]{4})\s+([A-Za-z_][A-Za-z0-9_]*) EQU \(__WORK__ \+ \d+\)/);
    if (m) symbols[m[2].toUpperCase()] = parseInt(m[1], 16);
    const w = line.match(/^\s+([0-9A-F]{4})\s+(__WORK__|__WORKEND__):/);
    if (w) symbols[w[2]] = parseInt(w[1], 16);
  }
  return symbols;
}

const expected = { revision, programs: {} };
const work = mkdtempSync(join(tmpdir(), 'hubasic-fixtures-'));
try {
  for (const file of readdirSync(fixtureDir).filter((f) => /\.BAS$/.test(f)).sort()) {
    const name = basename(file, '.BAS');
    copyFileSync(join(fixtureDir, file), join(work, file));
    const r = spawnSync(hubasic2sl, [file, '--emit', 'disk', '--slangbuild', slangbuild], {
      cwd: work, encoding: 'utf8', env: { ...process.env, SLANG_HOME: slangDir },
    });
    if (r.status !== 0) throw new Error(`hubasic2sl ${file} failed:\n${r.stdout}${r.stderr}`);
    copyFileSync(join(work, `${name}.SL`), join(fixtureDir, `${name}.SL`));
    copyFileSync(join(work, `${name}.bin`), join(fixtureDir, `${name}.bin`));
    const symbols = workSymbols(readFileSync(join(work, `${name}.LST`), 'utf8'));
    if (symbols.__WORKEND__ === undefined) throw new Error(`${name}.LST has no __WORKEND__`);
    expected.programs[name] = {
      binLength: readFileSync(join(work, `${name}.bin`)).length,
      workSymbols: symbols,
      d88Sha256: createHash('sha256').update(readFileSync(join(work, `${name}.d88`))).digest('hex'),
    };
    console.log(`make-hubasic-fixtures: ${name} (${expected.programs[name].binLength} bytes)`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
writeFileSync(join(fixtureDir, 'expected.json'), `${JSON.stringify(expected, null, 2)}\n`);
console.log(`make-hubasic-fixtures: tests/fixtures/hubasic/expected.json for ${revision}`);
