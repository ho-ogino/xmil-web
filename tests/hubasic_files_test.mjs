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
// One lock manager for the whole origin, like navigator.locks (see fakeLocks below)
const sharedLocks = fakeLocks();

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
  for (const bad of ['', 'ABCDEFGHIJKLMN', 'A.TEXT', '.TXT', 'A:B', 'A"B', 'A=B', 'A,B', ' A', 'A ', 'ほ.TXT', 'A\tB', 'A .BIN', 'A.B ']) {
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
  // Bin has a 16-bit size field; text and raw (Asc, sized by records) are limited by the total only
  assert.throws(() => Files.normalize(one({ kind: 'bin', bytes: new Uint8Array(65536) })), (e) => e.code === 'HUBASIC_FILES_TOO_LARGE');
  assert.doesNotThrow(() => Files.normalize(one({ kind: 'bin', bytes: new Uint8Array(65535) })));
  assert.doesNotThrow(() => Files.normalize(one({ kind: 'raw', bytes: new Uint8Array(65536) })));
  assert.doesNotThrow(() => Files.normalize(one({ kind: 'text', bytes: new Uint8Array(100000) })));
  const many = Array.from({ length: 5 }, (_, i) => ({ name: `F${i}`, kind: 'bin', bytes: new Uint8Array(65535) }));
  assert.throws(() => Files.normalize(many), (e) => e.code === 'HUBASIC_FILES_TOO_LARGE' && /合計/.test(e.message));
  assert.throws(() => Files.normalize(Array.from({ length: 65 }, (_, i) => ({ name: `F${i}`, bytes: bytes('x') }))), /64/);
  // Case is kept: A.TXT and a.txt are two files
  assert.equal(Files.normalize([...one({}), { name: 'a.txt', bytes: bytes('y') }]).length, 2);
  // The directory holds "A" and "A." as one entry
  assert.throws(() => Files.normalize([{ name: 'A', bytes: bytes('x') }, { name: 'A.', bytes: bytes('y') }]), /同じ名前/);
});

test('the saved set survives a reload and replaces itself whole', async () => {
  const storage = fakeStorage();
  const ls = fakeLocalStorage();
  const store = Files.createStore({ storage, localStorage: ls, locks: sharedLocks });
  assert.deepEqual(json((await store.open()).files), []);
  await store.replaceAll([
    { name: 'GREET.TXT', kind: 'text', bytes: bytes('hello\n') },
    { name: 'DATA.BIN', kind: 'bin', bytes: new Uint8Array([1, 2, 3]) },
  ]);
  const firstKeys = [...storage.map.keys()];
  assert.equal(firstKeys.length, 2);
  assert.ok(firstKeys.every((k) => k.startsWith('x1pen_hufile_')));

  const reloaded = Files.createStore({ storage, localStorage: ls, locks: sharedLocks });
  const opened = await reloaded.open();
  assert.deepEqual(json(opened.files), [{ name: 'GREET.TXT', kind: 'text', size: 6 }, { name: 'DATA.BIN', kind: 'bin', size: 3 }]);
  assert.deepEqual([...reloaded.files()[1].bytes], [1, 2, 3]);

  await reloaded.remove('GREET.TXT');
  await reloaded.put([{ name: 'NEW.TXT', kind: 'raw', bytes: bytes('n') }]);
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
    const store = Files.createStore({ storage, localStorage: ls, locks: sharedLocks });
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
    const reloaded = Files.createStore({ storage, localStorage: ls, locks: sharedLocks });
    const opened = await reloaded.open();
    assert.deepEqual(json(opened.files.map((f) => f.name)), ['OLD1.TXT', 'OLD2.TXT', 'OLD3.TXT'], failure);
    assert.equal(new TextDecoder().decode(reloaded.files()[2].bytes), 'OLD3');
  }
});

test('bodies no list points at are removed when the page opens', async () => {
  const storage = fakeStorage();
  const ls = fakeLocalStorage();
  const store = Files.createStore({ storage, localStorage: ls, locks: sharedLocks });
  await store.open();
  await store.replaceAll([{ name: 'A', bytes: bytes('a') }]);
  // A page closed after switching the list but before removing the old generation
  storage.map.set('x1pen_hufile_old_0', bytes('stale'));
  storage.map.set('lib_other', bytes('library'));
  const reloaded = Files.createStore({ storage, localStorage: ls, locks: sharedLocks });
  const opened = await reloaded.open();
  assert.deepEqual(json(opened.files.map((f) => f.name)), ['A']);
  assert.ok(!storage.map.has('x1pen_hufile_old_0'));
  assert.ok(storage.map.has('lib_other'), 'other keys are left alone');
  // A broken list is read as empty
  ls.setItem(Files.LIST_KEY, '{not json');
  assert.deepEqual(json((await Files.createStore({ storage, localStorage: ls, locks: sharedLocks }).open()).files), []);
});

test('a Share session uses its own set and never touches the saved one', async () => {
  const storage = fakeStorage();
  const ls = fakeLocalStorage();
  const saved = Files.createStore({ storage, localStorage: ls, locks: sharedLocks });
  await saved.open();
  await saved.replaceAll([{ name: 'MINE.TXT', kind: 'text', bytes: bytes('mine') }]);
  const snapshot = new Map(storage.map);
  const listBefore = ls.getItem(Files.LIST_KEY);
  const share = Files.createMemoryStore();
  assert.equal(share.persistent, false);
  assert.deepEqual(json((await share.open()).files), []);
  await share.put([{ name: 'SHARE.TXT', kind: 'text', bytes: bytes('s') }]);
  assert.deepEqual(json(share.list().map((f) => f.name)), ['SHARE.TXT']);
  assert.deepEqual(storage.map, snapshot);
  assert.equal(ls.getItem(Files.LIST_KEY), listBefore);
});

test('changes made one right after another all apply, each to the set saved last', async () => {
  const storage = fakeStorage();
  const ls = fakeLocalStorage();
  const store = Files.createStore({ storage, localStorage: ls, locks: sharedLocks });
  await store.open();
  await store.replaceAll(['A', 'B', 'C'].map((name) => ({ name, bytes: bytes(name) })));
  // Two removals started together: the second must not bring back what the first removed
  await Promise.all([store.remove('A'), store.remove('B'), store.put([{ name: 'D', bytes: bytes('d') }])]);
  assert.deepEqual(json(store.list().map((f) => f.name)), ['C', 'D']);
  const reloaded = Files.createStore({ storage, localStorage: ls, locks: sharedLocks });
  await reloaded.open();
  assert.deepEqual(json(reloaded.list().map((f) => f.name)), ['C', 'D']);
  // A Share session's set behaves the same
  const share = Files.createMemoryStore([{ name: 'A', bytes: bytes('a') }, { name: 'B', bytes: bytes('b') }]);
  await Promise.all([share.remove('A'), share.remove('B')]);
  assert.deepEqual(json(share.list()), []);
});

// One lock manager for two "tabs" of the same origin, like navigator.locks
function fakeLocks() {
  const queues = new Map();
  return {
    request(name, callback) {
      const previous = queues.get(name) || Promise.resolve();
      const run = previous.then(() => callback());
      queues.set(name, run.catch(() => {}));
      return run;
    },
  };
}

test('a tab that opens while another is saving waits, and keeps the other tab\'s new files', async () => {
  const storage = fakeStorage();
  const ls = fakeLocalStorage();
  const locks = fakeLocks();
  const first = Files.createStore({ storage, localStorage: ls, locks });
  await first.open();
  await first.replaceAll([{ name: 'OLD.TXT', bytes: bytes('old') }]);
  // Hold the first tab's save after its new body is written, before the list is switched
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let written;
  const wroteBody = new Promise((resolve) => { written = resolve; });
  const write = storage.write;
  storage.write = async (key, buffer) => { await write(key, buffer); written(); await held; };
  const saving = first.put([{ name: 'NEW.TXT', bytes: bytes('new') }]);
  await wroteBody;
  storage.write = write;
  const second = Files.createStore({ storage, localStorage: ls, locks });
  const opening = second.open();
  release();
  await saving;
  const opened = await opening;
  assert.deepEqual(json(opened.files.map((f) => f.name)), ['OLD.TXT', 'NEW.TXT']);
  assert.deepEqual(json(opened.missing), []);
  // A change in the second tab starts from what the first saved
  await first.remove('OLD.TXT');
  await second.put([{ name: 'MORE.TXT', bytes: bytes('more') }]);
  const third = Files.createStore({ storage, localStorage: ls, locks });
  assert.deepEqual(json((await third.open()).files.map((f) => f.name)), ['NEW.TXT', 'MORE.TXT']);
});

test('a tab that is already open sees the files another tab saved', async () => {
  const storage = fakeStorage();
  const ls = fakeLocalStorage();
  const locks = fakeLocks();
  const first = Files.createStore({ storage, localStorage: ls, locks });
  const second = Files.createStore({ storage, localStorage: ls, locks });
  await first.open();
  await second.open();
  await first.put([{ name: 'NEW.TXT', bytes: bytes('new') }]);
  assert.equal(second.count(), 0);
  assert.equal(await second.refresh(), true);
  assert.deepEqual(json(second.list().map((f) => f.name)), ['NEW.TXT']);
  assert.equal(await second.refresh(), false, 'nothing changed since');
});

test('without Web Locks nothing is saved, and the page says so', async () => {
  const storage = fakeStorage();
  const ls = fakeLocalStorage();
  const store = Files.createStore({ storage, localStorage: ls, locks: null });
  assert.equal(store.persistent, false);
  assert.match(store.note, /保存できません/);
  await store.open();
  await store.put([{ name: 'A.TXT', bytes: bytes('a') }]);
  assert.deepEqual(json(store.list().map((f) => f.name)), ['A.TXT']);
  assert.equal(storage.map.size, 0);
  assert.equal(ls.getItem(Files.LIST_KEY), null);
});

test('a body that cannot be read once stops changes instead of dropping it', async () => {
  const storage = fakeStorage();
  const ls = fakeLocalStorage();
  const saved = Files.createStore({ storage, localStorage: ls, locks: sharedLocks });
  await saved.open();
  await saved.replaceAll([{ name: 'KEEP.DAT', bytes: bytes('keep') }, { name: 'OTHER.DAT', bytes: bytes('other') }]);
  const read = storage.read;
  let failing = true;
  storage.read = async (key) => {
    const list = JSON.parse(ls.getItem(Files.LIST_KEY));
    if (failing && key === list.files[0].key) throw new Error('read failed');
    return read(key);
  };
  const store = Files.createStore({ storage, localStorage: ls, locks: sharedLocks });
  const opened = await store.open();
  assert.deepEqual(json(opened.missing), ['KEEP.DAT']);
  assert.deepEqual(json(store.unreadable()), ['KEEP.DAT']);
  // An unrelated change is refused while KEEP.DAT cannot be read; nothing is lost
  await assert.rejects(store.remove('OTHER.DAT'), (e) => e.code === 'HUBASIC_FILES_UNREADABLE');
  failing = false;
  // Readable again: the next change reads it and keeps it
  await store.remove('OTHER.DAT');
  assert.deepEqual(json(store.list().map((f) => f.name)), ['KEEP.DAT']);
  assert.deepEqual(json(store.unreadable()), []);
  // Dropping an unreadable file is an explicit replacement of the whole set
  failing = true;
  const again = Files.createStore({ storage, localStorage: ls, locks: sharedLocks });
  await again.open();
  assert.deepEqual(json(again.unreadable()), ['KEEP.DAT']);
  await again.replaceAll(again.files());
  storage.read = read;
  const reloaded = Files.createStore({ storage, localStorage: ls, locks: sharedLocks });
  assert.deepEqual(json((await reloaded.open()).files), []);
});

test('removing one unreadable file keeps the others, also those saved meanwhile by another tab', async () => {
  const storage = fakeStorage();
  const ls = fakeLocalStorage();
  const other = Files.createStore({ storage, localStorage: ls, locks: sharedLocks });
  await other.open();
  await other.replaceAll(['A', 'B', 'C', 'D'].map((name) => ({ name, bytes: bytes(name.toLowerCase()) })));
  // This tab cannot read A, B and D (the other tab can)
  const keyOf = (name) => JSON.parse(ls.getItem(Files.LIST_KEY)).files.find((f) => f.name === name)?.key;
  const unreadableKeys = new Set(['A', 'B', 'D'].map(keyOf));
  const failing = { ...storage, read: async (key) => { if (unreadableKeys.has(key)) throw new Error('read failed'); return storage.read(key); } };
  const tab = Files.createStore({ storage: failing, localStorage: ls, locks: sharedLocks });
  assert.deepEqual(json((await tab.open()).missing), ['A', 'B', 'D']);
  await other.put([{ name: 'E', bytes: bytes('e') }]);
  // The new generation of the other tab renamed every key: B and D are still unreadable here
  unreadableKeys.clear();
  ['A', 'B', 'D'].forEach((name) => unreadableKeys.add(keyOf(name)));
  await tab.forget('A');
  assert.deepEqual(json(tab.unreadable()), ['B', 'D']);
  assert.deepEqual(json(tab.list().map((f) => f.name)), ['C', 'E']);
  const reloaded = Files.createStore({ storage, localStorage: ls, locks: sharedLocks });
  await reloaded.open();
  assert.deepEqual(json(reloaded.files().map((f) => [f.name, new TextDecoder().decode(f.bytes)])), [['B', 'b'], ['C', 'c'], ['D', 'd'], ['E', 'e']]);
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
    { name: 'raw.dat', kind: 'raw', bytes: new Uint8Array([0x41, 0x1A, 0x0D, 0x2A]) },
  ];
  const disk = await page.X1PenSlangWasm.buildHufsDisk(new Uint8Array([0xC9]), { mainName: 'PROG', files });
  assert.equal(disk.ok, true, disk.error);
  const read = Files.readDiskFiles(disk.d88);
  const byName = Object.fromEntries(read.map((f) => [f.name, f]));
  assert.deepEqual(json(read.map((f) => f.name)), ['PROG.Sys', 'DATA.BIN', 'GREET.TXT', 'raw.dat']);
  assert.equal(byName['PROG.Sys'].protected, true);
  assert.equal(byName['GREET.TXT'].kind, 'asc');
  assert.equal(new TextDecoder().decode(Files.textFromHu(byName['GREET.TXT'].bytes)), 'HELLO\nWORLD\n');
  assert.equal(byName['DATA.BIN'].kind, 'bin');
  assert.deepEqual([...byName['DATA.BIN'].bytes], [9, 8, 7, 6]);
  // Raw and text are both Asc on the disk; the bytes come back whole records, $1A and CR included
  assert.equal(byName['raw.dat'].kind, 'asc');
  assert.deepEqual([...byName['raw.dat'].bytes.slice(0, 4)], [0x41, 0x1A, 0x0D, 0x2A]);
  assert.equal(byName['raw.dat'].bytes.length, 256);
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
  assert.equal(read.find((f) => f.name === 'NOTE.TXT').kind, 'asc');
  // An empty text file is an Asc file holding only $1A (Asc has no size; $1A ends the text), and
  // every entry has a start cluster the Hu-BASIC runtime can open (offsets $1D and $1F are 0)
  fs.addFile('EMPTY', 'TXT', new Uint8Array(0));
  fs.addFile('ZERO', 'BIN', new Uint8Array(0));
  const reopened = new page.XmilDiskFS.HuBasicFS(page.XmilDiskContainer.openContainer(container.toArrayBuffer(), 'x.d88'));
  const empty = reopened.listDirectory().find((e) => e.name.trim() === 'EMPTY');
  assert.equal(empty.mode, 0x04);
  assert.deepEqual([...reopened.readFile(empty)], [0x1A]);
  assert.equal(Files.textFromHu(reopened.readFile(empty)).length, 0);
  const zero = reopened.listDirectory().find((e) => e.name.trim() === 'ZERO');
  assert.equal(zero.mode, 0x01);
  assert.equal(reopened.readFile(zero).length, 0);
  for (const entry of [empty, zero]) {
    assert.ok(entry.startCluster >= 2 && entry.startCluster < 0x80, entry.name);
    assert.equal(entry.rawEntry[0x1D], 0);
    assert.equal(entry.rawEntry[0x1F], 0);
  }
  // Changing the kind leaves exactly one type bit; an attribute such as $20 on a typed entry stays
  reopened.setFileMode(empty, 'M');
  assert.equal(empty.mode, 0x01);
  reopened.setFileMode(empty, 'A');
  assert.equal(empty.mode, 0x04);
  const legacy = reopened.listDirectory().find((e) => e.name.trim() === 'ZERO');
  legacy.rawEntry[0] = 0x20;     // what the disk editor wrote for ASCII before
  reopened.setFileMode(legacy, 'A');
  assert.equal(legacy.mode, 0x04);
  legacy.rawEntry[0] = 0x24;
  reopened.setFileMode(legacy, 'M');
  assert.equal(legacy.mode, 0x21);
});

test('changing a Hu-BASIC Asc file to Bin in the disk editor keeps its length', async () => {
  await page.X1PenSlangWasm.load();
  const disk = await page.X1PenSlangWasm.buildHufsDisk(new Uint8Array([0xC9]), { mainName: 'PROG', files: [
    { name: 'LOG.TXT', kind: 'text', bytes: bytes('LINE 1\nLINE 2\n') },
    { name: 'BIG.DAT', kind: 'raw', bytes: new Uint8Array(70000).fill(0x41) },
  ] });
  assert.equal(disk.ok, true, disk.error);
  const open = (buffer) => new page.XmilDiskFS.HuBasicFS(page.XmilDiskContainer.openContainer(buffer, 'x.d88'));
  let container = page.XmilDiskContainer.openContainer(disk.d88.buffer, 'x.d88');
  let fs = new page.XmilDiskFS.HuBasicFS(container);
  const log = fs.listDirectory().find((e) => e.name.trim() === 'LOG');
  assert.equal(log.size, 0);
  const before = fs.readFile(log);
  assert.equal(before.length, 256);
  fs.setFileMode(log, 'M');
  const reopened = open(container.toArrayBuffer());
  const asBin = reopened.listDirectory().find((e) => e.name.trim() === 'LOG');
  assert.equal(asBin.mode, 0x01);
  assert.equal(asBin.size, 256);
  assert.deepEqual([...reopened.readFile(asBin)], [...before]);
  // Too long for the size field: refused, nothing changed
  const big = reopened.listDirectory().find((e) => e.name.trim() === 'BIG');
  assert.throws(() => reopened.setFileMode(big, 'M'), /65535/);
  assert.equal(big.mode, 0x04);
  assert.equal(big.size, 0);
});

test('a raw file as large as the disk allows keeps its whole records through a read-back and a rebuild', async () => {
  await page.X1PenSlangWasm.load();
  const raw = new Uint8Array(65535).map((_, i) => (i * 7) & 0xff);
  const first = await page.X1PenSlangWasm.buildHufsDisk(new Uint8Array([0xC9]), { mainName: 'PROG', files: [{ name: 'BIG.DAT', kind: 'raw', bytes: raw }] });
  assert.equal(first.ok, true, first.error);
  const read = Files.readDiskFiles(first.d88).find((f) => f.name === 'BIG.DAT');
  assert.equal(read.bytes.length, 65536);
  const store = Files.createMemoryStore();
  await store.put([{ name: read.name, kind: 'raw', bytes: read.bytes }]);
  const again = await page.X1PenSlangWasm.buildHufsDisk(new Uint8Array([0xC9]), { mainName: 'PROG', files: store.files() });
  assert.equal(again.ok, true, again.error);
  const back = Files.readDiskFiles(again.d88).find((f) => f.name === 'BIG.DAT');
  assert.deepEqual([...back.bytes.slice(0, 65535)], [...raw]);
});
