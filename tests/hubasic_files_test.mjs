import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import vm from 'node:vm';

// The HuBASIC tab's files (html/x1pen_hubasic_files.js) and the Hu-BASIC disk reader
// (html/disk_fs.js) against disks made by the SLANG bundle.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = join(repoRoot, 'tests', 'fixtures', 'hubasic');

function loadPage(extra = {}) {
  const context = {
    console, TextEncoder, TextDecoder, URL, URLSearchParams, atob, Uint8Array, ArrayBuffer,
    location: { hostname: 'x1.example.test', search: '', href: pathToFileURL(join(repoRoot, 'assets', 'x1pen.html')).href },
    fetch: async (url) => {
      const path = String(url);
      if (!path.startsWith('hubasic/')) return { ok: false, status: 404 };
      const bytes = readFileSync(join(repoRoot, 'assets', path));
      return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    },
    ...extra,
  };
  context.window = context;
  vm.createContext(context);
  for (const file of ['disk_container.js', 'disk_fs.js', 'x1pen_slang_wasm.js', 'x1pen_hubasic_files.js']) {
    vm.runInContext(readFileSync(join(repoRoot, 'html', file), 'utf8'), context, {
      filename: file, importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
    });
  }
  return context;
}

const page = loadPage();
const Files = page.X1PenHuBasicFiles;
const json = (value) => JSON.parse(JSON.stringify(value));
const bytes = (text) => new TextEncoder().encode(text);

// XmilStorage and localStorage stand-ins that can be told to fail
function fakeStorage() {
  const map = new Map();
  const storage = {
    map,
    failWrite: null,
    async write(key, buffer) {
      if (storage.failWrite && storage.failWrite(key)) throw new Error('disk full');
      map.set(key, new Uint8Array(buffer).slice());
    },
    async read(key) { return map.has(key) ? map.get(key).slice().buffer : null; },
    async remove(key) { map.delete(key); },
    async list() { return [...map.keys()].map((key) => ({ key, name: key, size: map.get(key).length })); },
    async ensureCapacity() {},
  };
  return storage;
}
function fakeLocalStorage() {
  const map = new Map();
  const ls = {
    map,
    failSet: false,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { if (ls.failSet) throw new Error('quota'); map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
  return ls;
}

test('file names follow the Hu-BASIC directory rules', () => {
  for (const ok of ['GREET.TXT', 'A', 'ABCDEFGHIJKLM.TXT', 'data.bin', 'MY FILE.DAT', "IT'S.TXT", 'X.']) {
    assert.equal(Files.checkName(ok), null, ok);
  }
  for (const bad of ['', 'ABCDEFGHIJKLMN', 'A.TEXT', '.TXT', 'A:B', 'A"B', 'A=B', 'A,B', ' A', 'A ', 'ほ.TXT', 'A\tB']) {
    assert.notEqual(Files.checkName(bad), null, bad);
  }
});

test('a set is checked as a whole: names, kinds, sizes and the total', () => {
  const one = (patch) => [{ name: 'A.TXT', kind: 'text', bytes: bytes('x'), ...patch }];
  assert.deepEqual(json(Files.normalize(one({})).map((f) => [f.name, f.kind, f.bytes.length])), [['A.TXT', 'text', 1]]);
  assert.equal(Files.normalize([{ name: 'R', bytes: bytes('x') }])[0].kind, 'raw');
  assert.throws(() => Files.normalize(one({ kind: 'ascii' })), /種類/);
  assert.throws(() => Files.normalize(one({ bytes: 'x' })), /中身/);
  assert.throws(() => Files.normalize(one({ name: 'A:B' })), /使えません/);
  assert.throws(() => Files.normalize([...one({}), ...one({})]), /同じ名前/);
  assert.throws(() => Files.normalize(one({ bytes: new Uint8Array(65536) })), (e) => e.code === 'HUBASIC_FILES_TOO_LARGE');
  assert.doesNotThrow(() => Files.normalize(one({ bytes: new Uint8Array(65535) })));
  const many = Array.from({ length: 5 }, (_, i) => ({ name: `F${i}`, kind: 'bin', bytes: new Uint8Array(65535) }));
  assert.throws(() => Files.normalize(many), (e) => e.code === 'HUBASIC_FILES_TOO_LARGE' && /合計/.test(e.message));
  assert.throws(() => Files.normalize(Array.from({ length: 65 }, (_, i) => ({ name: `F${i}`, bytes: bytes('x') }))), /64/);
  // Case is kept: A.TXT and a.txt are two files
  assert.equal(Files.normalize([...one({}), { name: 'a.txt', bytes: bytes('y') }]).length, 2);
});

test('the saved set survives a reload and replaces itself whole', async () => {
  const storage = fakeStorage();
  const ls = fakeLocalStorage();
  const store = Files.createStore({ storage, localStorage: ls });
  assert.deepEqual(json((await store.open()).files), []);
  await store.replaceAll([
    { name: 'GREET.TXT', kind: 'text', bytes: bytes('hello\n') },
    { name: 'DATA.BIN', kind: 'bin', bytes: new Uint8Array([1, 2, 3]) },
  ]);
  const firstKeys = [...storage.map.keys()];
  assert.equal(firstKeys.length, 2);
  assert.ok(firstKeys.every((k) => k.startsWith('x1pen_hufile_')));

  const reloaded = Files.createStore({ storage, localStorage: ls });
  const opened = await reloaded.open();
  assert.deepEqual(json(opened.files), [{ name: 'GREET.TXT', kind: 'text', size: 6 }, { name: 'DATA.BIN', kind: 'bin', size: 3 }]);
  assert.deepEqual([...reloaded.files()[1].bytes], [1, 2, 3]);

  await reloaded.remove('GREET.TXT');
  await reloaded.add({ name: 'NEW.TXT', kind: 'raw', bytes: bytes('n') });
  await reloaded.setKind('NEW.TXT', 'text');
  assert.deepEqual(json(reloaded.list()), [{ name: 'DATA.BIN', kind: 'bin', size: 3 }, { name: 'NEW.TXT', kind: 'text', size: 1 }]);
  // Only the current generation is kept
  assert.equal(storage.map.size, 2);
  assert.ok(firstKeys.every((k) => !storage.map.has(k)));
});

test('a failed save leaves the previous set and no new keys', async () => {
  const three = (prefix) => ['1', '2', '3'].map((n) => ({ name: `${prefix}${n}.TXT`, kind: 'text', bytes: bytes(`${prefix}${n}`) }));
  for (const failure of ['body', 'list']) {
    const storage = fakeStorage();
    const ls = fakeLocalStorage();
    const store = Files.createStore({ storage, localStorage: ls });
    await store.open();
    await store.replaceAll(three('OLD'));
    const before = new Set(storage.map.keys());
    let writes = 0;
    if (failure === 'body') storage.failWrite = () => ++writes === 2;
    else ls.failSet = true;
    await assert.rejects(store.replaceAll(three('NEW')), (e) => e.code === 'HUBASIC_FILES_SAVE_FAILED');
    storage.failWrite = null;
    ls.failSet = false;
    assert.deepEqual(new Set(storage.map.keys()), before, `${failure}: no keys of the new generation are left`);
    const reloaded = Files.createStore({ storage, localStorage: ls });
    const opened = await reloaded.open();
    assert.deepEqual(json(opened.files.map((f) => f.name)), ['OLD1.TXT', 'OLD2.TXT', 'OLD3.TXT'], failure);
    assert.equal(new TextDecoder().decode(reloaded.files()[2].bytes), 'OLD3');
  }
});

test('bodies no list points at are removed when the page opens', async () => {
  const storage = fakeStorage();
  const ls = fakeLocalStorage();
  const store = Files.createStore({ storage, localStorage: ls });
  await store.open();
  await store.replaceAll([{ name: 'A', bytes: bytes('a') }]);
  // A page closed after switching the list but before removing the old generation
  storage.map.set('x1pen_hufile_old_0', bytes('stale'));
  storage.map.set('lib_other', bytes('library'));
  const reloaded = Files.createStore({ storage, localStorage: ls });
  const opened = await reloaded.open();
  assert.deepEqual(json(opened.files.map((f) => f.name)), ['A']);
  assert.ok(!storage.map.has('x1pen_hufile_old_0'));
  assert.ok(storage.map.has('lib_other'), 'other keys are left alone');
  // A broken list is read as empty
  ls.setItem(Files.LIST_KEY, '{not json');
  assert.deepEqual(json((await Files.createStore({ storage, localStorage: ls }).open()).files), []);
});

test('a Share session uses its own set and never touches the saved one', async () => {
  const storage = fakeStorage();
  const ls = fakeLocalStorage();
  const saved = Files.createStore({ storage, localStorage: ls });
  await saved.open();
  await saved.replaceAll([{ name: 'MINE.TXT', kind: 'text', bytes: bytes('mine') }]);
  const snapshot = new Map(storage.map);
  const listBefore = ls.getItem(Files.LIST_KEY);
  const share = Files.createMemoryStore();
  assert.equal(share.persistent, false);
  assert.deepEqual(json((await share.open()).files), []);
  await share.add({ name: 'SHARE.TXT', kind: 'text', bytes: bytes('s') });
  assert.deepEqual(json(share.list().map((f) => f.name)), ['SHARE.TXT']);
  assert.deepEqual(storage.map, snapshot);
  assert.equal(ls.getItem(Files.LIST_KEY), listBefore);
});

test('Hu-BASIC text comes back as text: up to $1A, CR as LF', () => {
  assert.deepEqual([...Files.textFromHu(new Uint8Array([0x41, 0x0D, 0x42, 0x1A, 0x00, 0x00]))], [0x41, 0x0A, 0x42]);
  assert.deepEqual([...Files.textFromHu(new Uint8Array([0x41]))], [0x41]);
});

test('files put on a disk by the SLANG bundle read back through HuBasicFS', async () => {
  await page.X1PenSlangWasm.load();
  const files = [
    { name: 'GREET.TXT', kind: 'text', bytes: bytes('HELLO\r\nWORLD\n') },
    { name: 'DATA.BIN', kind: 'bin', bytes: new Uint8Array([9, 8, 7, 6]) },
    { name: 'raw.dat', kind: 'raw', bytes: bytes('RAW') },
  ];
  const disk = await page.X1PenSlangWasm.buildHufsDisk(new Uint8Array([0xC9]), { mainName: 'PROG', files });
  assert.equal(disk.ok, true, disk.error);
  const read = Files.readDiskFiles(disk.d88);
  const byName = Object.fromEntries(read.map((f) => [f.name, f]));
  assert.deepEqual(json(read.map((f) => f.name)), ['PROG.Sys', 'DATA.BIN', 'GREET.TXT', 'raw.dat']);
  assert.equal(byName['PROG.Sys'].protected, true);
  assert.equal(byName['GREET.TXT'].kind, 'text');
  assert.equal(new TextDecoder().decode(Files.textFromHu(byName['GREET.TXT'].bytes)), 'HELLO\nWORLD\n');
  assert.equal(byName['DATA.BIN'].kind, 'bin');
  assert.deepEqual([...byName['DATA.BIN'].bytes], [9, 8, 7, 6]);
  assert.equal(new TextDecoder().decode(byName['raw.dat'].bytes.slice(0, 3)), 'RAW');
  // The disk image of the FILEIO fixture holds its text file too
  const expected = JSON.parse(readFileSync(join(fixtureDir, 'expected.json'), 'utf8'));
  assert.ok(expected.programs.FILEIO.files.length > 0);
});

test('the disk editor adds text files as Hu-BASIC Asc ($04) and reads them back', async () => {
  const disk = await page.X1PenSlangWasm.buildHufsDisk(new Uint8Array([0xC9]), { mainName: 'PROG', files: [] });
  const container = page.XmilDiskContainer.openContainer(disk.d88.buffer, 'x.d88');
  const fs = new page.XmilDiskFS.HuBasicFS(container);
  fs.addFile('NOTE', 'TXT', bytes('A\rB\r\x1a'));
  const entry = fs.listDirectory().find((e) => e.name.trim() === 'NOTE');
  assert.equal(entry.mode, 0x04);
  assert.equal(entry.modeStr, 'A');
  assert.equal(new TextDecoder().decode(fs.readFile(entry)), 'A\rB\r\x1a');
  const read = Files.readDiskFiles(new Uint8Array(container.toArrayBuffer()));
  assert.equal(read.find((f) => f.name === 'NOTE.TXT').kind, 'text');
});
