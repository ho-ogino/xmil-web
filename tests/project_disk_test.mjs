import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis;
const require = createRequire(import.meta.url);
require('../html/disk_container.js');
require('../html/disk_fs.js');
require('../html/project_disk.js');

const root = fileURLToPath(new URL('..', import.meta.url));

function asset(name) {
  const bytes = readFileSync(`${root}/assets/${name}`);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function openFs(bytes, name = 'project.d88') {
  const container = XmilDiskContainer.openContainer(bytes, name, 'fdd');
  return XmilDiskFS.detectFilesystem(container);
}

function textFile(fs, name, ext) {
  const entry = fs.findByName(name, ext);
  assert.ok(entry, `${name}.${ext} must exist`);
  const bytes = fs.readFile(entry);
  const end = bytes.indexOf(0x1a);
  return String.fromCharCode(...bytes.slice(0, end < 0 ? bytes.length : end));
}

test('inspect accepts shipped LSX disks but does not claim boot verification', () => {
  const result = X1PenProjectDisk.inspect(asset('lsxdodgers_boot.v1.d88'), 'lsx.d88', 'lsx');
  assert.equal(result.fsType, 'LSX-Dodgers');
  assert.equal(result.bootVerified, false);
  assert.ok(result.freeBytes > 0);
});

test('LSX preparation replaces PROG and places it before another startup program', () => {
  const source = asset('lsxdodgers_boot.v1.d88');
  const before = new Uint8Array(source.slice(0));
  const opened = openFs(source.slice(0));
  const auto = opened.findByName('AUTOEXEC', 'BAT');
  opened.deleteFile(auto);
  opened.addFile('AUTOEXEC', 'BAT', new TextEncoder().encode('PATH=A:\\\r\nOLDGAME\r\n\x1a'));
  const custom = opened._container ? opened._container.toArrayBuffer() : null;
  // LsxDodgersFS intentionally keeps its container private only by convention.
  const input = custom || source;

  const result = X1PenProjectDisk.prepare(input, 'game.d88', {
    mode: 'lsx',
    files: [{ name: 'PROG.COM', data: new Uint8Array([1, 2, 3]) }],
  });
  const fs = openFs(result.bytes);
  assert.deepEqual(Array.from(fs.readFile(fs.findByName('PROG', 'COM'))), [1, 2, 3]);
  assert.match(textFile(fs, 'AUTOEXEC', 'BAT'), /^PATH=A:\\\r?\nPROG\r?\nOLDGAME/m);
  assert.deepEqual(new Uint8Array(source), before, 'input/source bytes must not be mutated');
  assert.equal(result.bootVerified, false);
  assert.equal(result.executionVerified, false);
});

test('Fuzzy preparation removes stale LSX managed output and switches launch mode', () => {
  const lsx = X1PenProjectDisk.prepare(asset('fuzzybasic_boot.v2.d88'), 'project.d88', {
    mode: 'lsx',
    files: [{ name: 'PROG.COM', data: new Uint8Array([0xc9]) }],
  });
  const fuzzy = X1PenProjectDisk.prepare(lsx.bytes, 'project.d88', {
    mode: 'fuzzybasic',
    previousMode: 'lsx',
    files: [
      { name: 'PROGRAM.BIN', data: new Uint8Array([9, 8]) },
      { name: 'AUTORUN.BAS', data: new Uint8Array([7, 6]) },
    ],
  });
  const fs = openFs(fuzzy.bytes);
  assert.equal(fs.findByName('PROG', 'COM'), null);
  assert.ok(fs.findByName('PROGRAM', 'BIN'));
  assert.ok(fs.findByName('AUTORUN', 'BAS'));
  const auto = textFile(fs, 'AUTOEXEC', 'BAT');
  assert.match(auto, /(^|\r?\n)FZBASIC(\r?\n|$)/);
  assert.doesNotMatch(auto, /(^|\r?\n)PROG(\r?\n|$)/);
});

test('AUTOEXEC is created when missing and existing launch arguments are preserved', () => {
  const updated = X1PenProjectDisk.updateAutoexec(
    new TextEncoder().encode('SET FOO=1\nOLDGAME\nPROG /Q\n\x1a'),
    'lsx',
  );
  assert.deepEqual(updated.lines, ['SET FOO=1', 'PROG /Q', 'OLDGAME']);

  const created = X1PenProjectDisk.updateAutoexec(null, 'fuzzybasic');
  assert.deepEqual(created.lines, ['FZBASIC']);
  assert.equal(created.bytes.at(-1), 0x1a);
});

test('multi-member, protected, and non-LSX images are rejected structurally', () => {
  const first = new Uint8Array(asset('lsxdodgers_boot.v1.d88'));
  const multi = new Uint8Array(first.length * 2);
  multi.set(first, 0);
  multi.set(first, first.length);
  assert.throws(
    () => X1PenProjectDisk.inspect(multi.buffer, 'multi.d88', 'lsx'),
    (error) => error.code === 'PROJECT_DISK_MULTI_D88' && /複数ディスク/.test(error.message),
  );

  const protectedDisk = new Uint8Array(first);
  protectedDisk[0x1a] = 0x10;
  assert.throws(
    () => X1PenProjectDisk.inspect(protectedDisk.buffer, 'protected.d88', 'lsx'),
    (error) => error.code === 'PROJECT_DISK_WRITE_PROTECTED' && /書き込み禁止/.test(error.message),
  );

  assert.throws(
    () => X1PenProjectDisk.inspect(new ArrayBuffer(327680), 'blank.2d', 'lsx'),
    (error) => error.code === 'PROJECT_DISK_NOT_LSX' && /LSX-Dodgers形式ではありません/.test(error.message),
  );
});
