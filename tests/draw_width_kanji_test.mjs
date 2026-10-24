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

async function compileAndRun(name, sources, expectedOutput) {
  const compiler = findCompiler();
  const workDir = await mkdtemp(join(tmpdir(), `xmil-${name}-`));
  const executable = join(workDir, name);

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
      '-DZeroMemory(p,size)=memset((p),0,(size))',
      '-Iplatform/dummy_includes',
      '-Iplatform',
      '-Isrc',
      '-Isrc/Z80R',
      '-include',
      'platform/platform_types.h',
      '-include',
      'cstring',
      ...sources,
      '-o',
      executable,
    ], { encoding: 'utf8' });

    assert.equal(
      compile.status,
      0,
      `native ${name} compilation failed\n${compile.stdout}${compile.stderr}`,
    );

    const run = spawnSync(executable, [], {
      encoding: 'utf8',
      env: { ...process.env, ASAN_OPTIONS: 'detect_leaks=0' },
    });
    assert.equal(
      run.status,
      0,
      `native ${name} failed\n${run.stdout}${run.stderr}`,
    );
    assert.match(run.stdout, expectedOutput);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

test('24kHz text renderer preserves ANK, PCG, and Kanji glyph rows', async () => {
  await compileAndRun('draw-width-kanji-test', [
    'tests/draw_width_kanji_test.cpp',
    'platform/draw_width.cpp',
    'platform/draw_sub_data.cpp',
  ], /draw_width text glyph tests passed/);
});

test('PCG redefinition redraws characters already on screen', async () => {
  await compileAndRun('pcg-redraw-test', [
    'tests/pcg_redraw_test.cpp',
    'src/X1_PCG.CPP',
    'platform/draw_width.cpp',
    'platform/draw_sub_data.cpp',
  ], /pcg redraw tests passed/);
});
