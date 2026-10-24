import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// CMakeLists.txt include_directories() の順序と同じ
const includeDirs = [
  'platform/dummy_includes',
  'platform',
  'src',
  'src/Z80R',
  'src/OPMSOUND',
  'src/OTHERFNT',
].map((dir) => join(repoRoot, dir));

const sourceDirs = [...includeDirs, join(repoRoot, 'tests')];
const sourcePattern = /\.(c|cpp|h|hpp|mcr)$/i;
const includePattern = /^[ \t]*#[ \t]*include[ \t]*(["<])([^">]+)[">]/gm;

// macOS (大文字小文字を区別しない) と同じ探し方で、最初に一致するファイルを返す
function findCaseInsensitive(dir, name) {
  const target = resolve(dir, name);
  const parent = dirname(target);
  if (!existsSync(parent) || !statSync(parent).isDirectory()) return null;
  const wanted = basename(target).toLowerCase();
  const entry = readdirSync(parent).find((candidate) => candidate.toLowerCase() === wanted);
  return entry ? join(parent, entry) : null;
}

test('project includes use the exact on-disk file name case', () => {
  const mismatches = [];
  for (const dir of sourceDirs) {
    for (const entry of readdirSync(dir)) {
      if (!sourcePattern.test(entry)) continue;
      const file = join(dir, entry);
      const text = readFileSync(file, 'latin1');
      for (const match of text.matchAll(includePattern)) {
        const [, delimiter, name] = match;
        const searchDirs = delimiter === '"' ? [dir, ...includeDirs] : includeDirs;
        let resolved = null;
        for (const searchDir of searchDirs) {
          resolved = findCaseInsensitive(searchDir, name);
          if (resolved) break;
        }
        // システムヘッダ等、プロジェクト内に無いものは対象外
        if (!resolved) continue;
        if (basename(resolved) !== basename(name)) {
          const close = delimiter === '"' ? '"' : '>';
          mismatches.push(`${relative(repoRoot, file)}: #include ${delimiter}${name}${close} -> ${relative(repoRoot, resolved)}`);
        }
      }
    }
  }
  assert.deepEqual(mismatches, [], 'include names must match the file macOS resolves them to, so Linux builds see the same headers');
});
