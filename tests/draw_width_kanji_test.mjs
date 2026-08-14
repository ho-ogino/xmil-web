import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const compilerCandidates = process.env.CXX
  ? [process.env.CXX]
  : ['c++', 'clang++', 'g++'];

function findCompiler() {
  for (const compiler of compilerCandidates) {
    const probe = spawnSync(compiler, ['--version'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return compiler;
  }
  assert.fail('C++ compiler required for test:draw (tried CXX, c++, clang++, g++)');
}

test('24kHz text Kanji renderer preserves all glyph rows', async () => {
  const compiler = findCompiler();
  const workDir = await mkdtemp(join(tmpdir(), 'xmil-draw-width-'));
  const executable = join(workDir, 'draw-width-kanji-test');

  try {
    const compile = spawnSync(compiler, [
      '-std=c++17',
      '-O1',
      '-g',
      '-fsanitize=address',
      '-fno-omit-frame-pointer',
      '-DT_TUNE=1',
      '-D__fastcall=',
      '-D__cdecl=',
      '-D__stdcall=',
      '-D__declspec(x)=',
      '-Iplatform/dummy_includes',
      '-Iplatform',
      '-Isrc',
      '-Isrc/Z80R',
      '-include',
      'platform/platform_types.h',
      'tests/draw_width_kanji_test.cpp',
      'platform/draw_width.cpp',
      'platform/draw_sub_data.cpp',
      '-o',
      executable,
    ], { encoding: 'utf8' });

    assert.equal(
      compile.status,
      0,
      `native draw test compilation failed\n${compile.stdout}${compile.stderr}`,
    );

    const run = spawnSync(executable, [], {
      encoding: 'utf8',
      env: { ...process.env, ASAN_OPTIONS: 'detect_leaks=0' },
    });
    assert.equal(
      run.status,
      0,
      `native draw test failed\n${run.stdout}${run.stderr}`,
    );
    assert.match(run.stdout, /draw_width Kanji tests passed/);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});
