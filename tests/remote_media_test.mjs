import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../html/remote_media.js', import.meta.url), 'utf8');

function loadRemoteMedia(overrides = {}) {
  const location = overrides.location || {
    href: 'https://xmil.example/url-builder.html',
    pathname: '/url-builder.html',
    search: '',
    hash: '',
  };
  const context = {
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Response,
    Headers,
    crypto: webcrypto,
    atob,
    btoa,
    location,
    history: overrides.history || { replaceState() {} },
    fetch: overrides.fetch,
    File: overrides.File,
    setTimeout,
    clearTimeout,
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'remote_media.js' });
  return { api: context.XmilRemoteMedia, context };
}

const googleUrl = 'https://drive.google.com/file/d/AbCdEfGhIjKlMnOpQrStUv/view?resourcekey=0-Key_123';
const dropboxFdd = 'https://www.dropbox.com/scl/fi/AbCdEf123456/%E6%97%A5%E6%9C%AC%E8%AA%9E.D88?rlkey=Key_123&dl=0';
const dropboxHdd = 'https://www.dropbox.com/scl/fi/ZyXwVu987654/DISK.HDD?rlkey=Key_456&dl=0';

test('launch intent round-trips Unicode URLs without putting them in the query', () => {
  const { api } = loadRemoteMedia();
  const items = [
    { url: googleUrl, slot: 'drive0' },
    { url: dropboxHdd, slot: 'hdd0' },
  ];
  const launch = new URL(api.buildLaunchUrl('./xmillennium.html?dev=1', items));
  assert.equal(launch.pathname, '/xmillennium.html');
  assert.equal(launch.search, '?dev=1');
  assert.doesNotMatch(launch.search, /drive\.google|dropbox|resourcekey|rlkey/);
  assert.match(launch.hash, /^#media=[A-Za-z0-9_-]+$/);
  const decoded = api.decodeIntent(launch.hash.slice('#media='.length));
  assert.equal(JSON.stringify(decoded.items), JSON.stringify(items));
});

test('launch MODEL uses one canonical query value and normalizes the base URL', () => {
  const { api } = loadRemoteMedia();
  const items = [{ url: googleUrl, slot: 'drive0' }];
  const selected = new URL(api.buildLaunchUrl(
    './xmillennium.html?dev=1&model=x1&model=x1turbo', items, 'x1turboz',
  ));
  assert.equal(selected.searchParams.get('dev'), '1');
  assert.deepEqual(selected.searchParams.getAll('model'), ['x1turboz']);
  assert.equal(api.readLaunchModel(selected), 3);
  assert.match(selected.hash, /^#media=/);

  const unspecified = new URL(api.buildLaunchUrl(
    './xmillennium.html?model=x1&model=x1turbo', items,
  ));
  assert.deepEqual(unspecified.searchParams.getAll('model'), []);
  assert.equal(api.readLaunchModel(unspecified), null);

  assert.equal(api.readLaunchModel({ search: '?model=x1' }), 1);
  assert.equal(api.readLaunchModel({ search: '?model=x1turbo' }), 2);
  assert.equal(api.readLaunchModel({ search: '?model=x1turboz' }), 3);
  for (const search of ['', '?model=', '?model=3', '?model=X1turboZ', '?model=unknown', '?model=x1&model=x1turbo']) {
    assert.equal(api.readLaunchModel({ search }), null, search);
  }
  assert.throws(() => api.buildLaunchUrl('./xmillennium.html', items, 'X1turboZ'), /MODEL/);
});

test('intent validation rejects unknown providers, duplicate slots/URLs, malformed data, and visible mismatches', () => {
  const { api } = loadRemoteMedia();
  assert.throws(() => api.validateItems([{ url: 'https://evil.example/DISK.D88', slot: 'drive0' }]), /Google Drive|Dropbox/);
  assert.throws(() => api.validateItems([
    { url: googleUrl, slot: 'drive0' },
    { url: dropboxFdd, slot: 'drive0' },
  ]), /同じ挿入先/);
  assert.throws(() => api.validateItems([
    { url: googleUrl, slot: 'drive0' },
    { url: googleUrl, slot: 'drive1' },
  ]), /同じ共有URL/);
  assert.throws(() => api.validateItems([{ url: dropboxHdd, slot: 'drive0' }]), /形式と挿入先/);
  assert.throws(() => api.decodeIntent('not-json'), /解釈/);
  assert.throws(() => api.decodeIntent(api.encodeIntent([{ url: googleUrl, slot: 'drive0' }]).replace(/.$/, '*')), /解釈/);
});

test('source IDs canonicalize supported URL variants without retaining access keys', async () => {
  const { api } = loadRemoteMedia();
  const googleVariants = [
    googleUrl,
    'https://drive.google.com/open?id=AbCdEfGhIjKlMnOpQrStUv&usp=sharing',
    'https://docs.google.com/uc?export=download&id=AbCdEfGhIjKlMnOpQrStUv',
  ];
  const googleIds = await Promise.all(googleVariants.map((value) => api.sourceIdForUrl(value)));
  assert.equal(new Set(googleIds).size, 1);
  assert.match(googleIds[0], /^[0-9a-f]{64}$/);

  const dropboxVariant = 'https://www.dropbox.com/scl/fi/AbCdEf123456/renamed.D88?dl=1&rlkey=Different_Key';
  assert.equal(await api.sourceIdForUrl(dropboxFdd), await api.sourceIdForUrl(dropboxVariant));
  assert.notEqual(await api.sourceIdForUrl(dropboxFdd), await api.sourceIdForUrl(dropboxHdd));
  assert.throws(() => api.inspectShareUrl('https://www.dropbox.com/t/short-token'), /単一ファイル/);
});

test('same source without a strong ETag reuses persistent bytes without any Relay request', async () => {
  const location = { href: 'https://xmil.example/xmillennium.html', pathname: '/xmillennium.html', search: '', hash: '' };
  const history = { replaceState() { location.hash = ''; } };
  const { api } = loadRemoteMedia({ location, history });
  location.hash = '#media=' + api.encodeIntent([{ url: googleUrl, slot: 'drive0' }]);
  const sourceId = await api.sourceIdForUrl(googleUrl);
  const entry = {
    key: 'remote_' + sourceId, name: 'SAVE.D88', type: 'fdd', size: 3,
    externalSource: { sourceId, provider: 'google-drive' },
  };
  const mounted = [];
  const statuses = [];
  let fetchCount = 0;
  const result = await api.consumeLaunchRequest({
    async inspectRemoteLibraryEntry() { return { state: 'ready', entry }; },
    touchRemoteLibraryEntry(_id, state) { assert.equal(state, 'unknown'); return entry; },
    async mountFromLibrary(key, slot) { mounted.push({ key, slot }); },
    updateStatus(value) { statuses.push(value); },
  }, {
    location,
    history,
    fetchImpl: async () => { fetchCount += 1; throw new Error('must not fetch'); },
  });
  assert.equal(fetchCount, 0);
  assert.equal(result.successes[0].reused, true);
  assert.deepEqual(mounted, [{ key: entry.key, slot: 'drive0' }]);
  assert.match(statuses.at(-1), /更新を確認できません.*セーブ/);
});

test('same source probes a strong ETag and never replaces the persistent entry', async () => {
  const location = { href: 'https://xmil.example/xmillennium.html', pathname: '/xmillennium.html', search: '', hash: '' };
  const history = { replaceState() { location.hash = ''; } };
  const { api } = loadRemoteMedia({ location, history });
  location.hash = '#media=' + api.encodeIntent([{ url: googleUrl, slot: null }]);
  const sourceId = await api.sourceIdForUrl(googleUrl);
  const entry = {
    key: 'remote_' + sourceId, name: 'SAVE.D88', type: 'fdd', size: 3,
    externalSource: { sourceId, provider: 'google-drive', strongEtag: '"v1"' },
  };
  const statuses = [];
  let added = 0;
  const result = await api.consumeLaunchRequest({
    async inspectRemoteLibraryEntry() { return { state: 'ready', entry }; },
    touchRemoteLibraryEntry(_id, state) { assert.equal(state, 'changed'); return entry; },
    async addRemoteToLibrary() { added += 1; },
    async mountFromLibrary() { throw new Error('library-only must not mount'); },
    updateStatus(value) { statuses.push(value); },
  }, {
    location,
    history,
    fetchImpl: async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body), { url: googleUrl, probe: true, strongEtag: '"v1"' });
      return new Response(JSON.stringify({ state: 'changed' }), { headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.equal(added, 0);
  assert.equal(result.successes[0].remoteState, 'changed');
  assert.match(statuses.at(-1), /配布元が前回取得時から変更.*上書きせず/);
});

test('missing bytes self-repair but size mismatch fails closed without fetching', async () => {
  const makeLocation = () => ({ href: 'https://xmil.example/xmillennium.html', pathname: '/xmillennium.html', search: '', hash: '' });
  const firstLocation = makeLocation();
  const { api } = loadRemoteMedia({ location: firstLocation, history: { replaceState() { firstLocation.hash = ''; } } });
  firstLocation.hash = '#media=' + api.encodeIntent([{ url: googleUrl, slot: null }]);
  let removed = 0;
  let added = 0;
  const repaired = await api.consumeLaunchRequest({
    async inspectRemoteLibraryEntry() { return { state: 'missing', entry: {} }; },
    removeRemoteLibraryMetadata() { removed += 1; },
    async addRemoteToLibrary(file) { added += 1; return { key: 'repaired', name: file.name }; },
    async mountFromLibrary() {},
    updateStatus() {},
  }, {
    location: firstLocation,
    history: { replaceState() { firstLocation.hash = ''; } },
    FileCtor: class { constructor(parts, name) { this.parts = parts; this.name = name; this.size = parts[0].byteLength; } },
    fetchImpl: async () => new Response(new Uint8Array([1]), { headers: { 'X-Disk-Filename': encodeURIComponent('DISK.D88') } }),
  });
  assert.equal(repaired.failures.length, 0);
  assert.equal(removed, 1);
  assert.equal(added, 1);

  const secondLocation = makeLocation();
  secondLocation.hash = '#media=' + api.encodeIntent([{ url: googleUrl, slot: null }]);
  let fetchCount = 0;
  const damaged = await api.consumeLaunchRequest({
    async inspectRemoteLibraryEntry() { return { state: 'size-mismatch', entry: {} }; },
    updateStatus() {},
  }, {
    location: secondLocation,
    history: { replaceState() { secondLocation.hash = ''; } },
    fetchImpl: async () => { fetchCount += 1; },
  });
  assert.equal(fetchCount, 0);
  assert.equal(damaged.failures[0].error.code, 'REMOTE_STORAGE_DAMAGED');
});

test('importer clears the fragment before fetch, sanitizes filename, adds, and mounts', async () => {
  const encodedName = encodeURIComponent('日本語<img src=x onerror=alert(1)>.D88');
  const location = {
    href: 'https://xmil.example/xmillennium.html',
    pathname: '/xmillennium.html',
    search: '?dev=1',
    hash: '',
  };
  let clearedTo = null;
  const history = {
    replaceState(_state, _title, path) {
      clearedTo = path;
      location.hash = '';
    },
  };
  const fetchCalls = [];
  const { api } = loadRemoteMedia({ location, history });
  location.hash = '#media=' + api.encodeIntent([{ url: googleUrl, slot: 'drive0' }]);

  class FakeFile {
    constructor(parts, name, options) {
      this.parts = parts;
      this.name = name;
      this.type = options.type;
      this.size = parts[0].byteLength;
    }
    async arrayBuffer() { return this.parts[0]; }
  }

  const added = [];
  const mounted = [];
  const statuses = [];
  const core = {
    async addRemoteToLibrary(file, metadata) {
      added.push({ file, metadata });
      return { key: 'remote-key', name: file.name };
    },
    async mountFromLibrary(key, slot) { mounted.push({ key, slot }); },
    updateStatus(value) { statuses.push(value); },
  };
  const result = await api.consumeLaunchRequest(core, {
    location,
    history,
    FileCtor: FakeFile,
    fetchImpl: async (url, options) => {
      assert.equal(location.hash, '', 'fragment must be cleared before Relay fetch');
      fetchCalls.push({ url, options });
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'X-Disk-Filename': encodedName, 'Content-Type': 'application/octet-stream' },
      });
    },
  });

  assert.equal(clearedTo, '/xmillennium.html?dev=1');
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, '/api/disk-relay');
  assert.deepEqual(JSON.parse(fetchCalls[0].options.body), { url: googleUrl, expectedType: 'fdd' });
  assert.equal(added[0].file.name, '日本語_img src=x onerror=alert(1)_.D88');
  assert.equal(added[0].metadata.provider, 'google-drive');
  assert.match(added[0].metadata.sourceId, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(mounted), JSON.stringify([{ key: 'remote-key', slot: 'drive0' }]));
  assert.equal(result.successes.length, 1);
  assert.equal(result.failures.length, 0);
  assert.match(statuses.at(-1), /1件を保存/);
});

test('importer maps disabled Relay and continues with later items', async () => {
  const location = {
    href: 'https://xmil.example/xmillennium.html',
    pathname: '/xmillennium.html',
    search: '',
    hash: '',
  };
  const history = { replaceState() { location.hash = ''; } };
  const { api } = loadRemoteMedia({ location, history });
  location.hash = '#media=' + api.encodeIntent([
    { url: googleUrl, slot: 'drive0' },
    { url: dropboxHdd, slot: null },
  ]);
  let call = 0;
  const statuses = [];
  const result = await api.consumeLaunchRequest({
    async addRemoteToLibrary(file) { return { key: file.name, name: file.name }; },
    async mountFromLibrary() {},
    updateStatus(value) { statuses.push(value); },
  }, {
    location,
    history,
    FileCtor: class { constructor(parts, name) { this.parts = parts; this.name = name; this.size = parts[0].byteLength; } },
    fetchImpl: async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({ error: 'RELAY_DISABLED' }), {
          status: 503, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(new Uint8Array([7]), {
        headers: { 'X-Disk-Filename': encodeURIComponent('DISK.HDD') },
      });
    },
  });
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].error.code, 'RELAY_DISABLED');
  assert.equal(result.successes.length, 1);
  assert.match(statuses.at(-1), /現在停止中/);
});

test('remote import uses a source namespace without changing a normal same-name entry', async () => {
  const location = {
    href: 'https://xmil.example/xmillennium.html',
    pathname: '/xmillennium.html',
    search: '',
    hash: '',
  };
  const history = { replaceState() { location.hash = ''; } };
  const { api } = loadRemoteMedia({ location, history });
  location.hash = '#media=' + api.encodeIntent([{ url: googleUrl, slot: null }]);
  const existing = { key: 'original-key', name: 'GAME.D88', bytes: [9, 8, 7] };
  const added = [];

  const result = await api.consumeLaunchRequest({
    getLibrary() { return [existing]; },
    async addRemoteToLibrary(file, metadata) {
      added.push({ file, metadata });
      return { key: 'remote_' + metadata.sourceId, name: file.name };
    },
    async mountFromLibrary() {},
    updateStatus() {},
  }, {
    location,
    history,
    FileCtor: class {
      constructor(parts, name) { this.parts = parts; this.name = name; this.size = parts[0].byteLength; }
    },
    fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'X-Disk-Filename': encodeURIComponent('GAME.D88') },
    }),
  });

  assert.deepEqual(existing.bytes, [9, 8, 7]);
  assert.equal(added[0].file.name, 'GAME.D88');
  assert.match(added[0].metadata.sourceId, /^[0-9a-f]{64}$/);
  assert.equal(result.successes[0].filename, 'GAME.D88');
});

test('remote EMM collision fails closed instead of overwriting the fixed slot name', async () => {
  const { api } = loadRemoteMedia();
  assert.throws(
    () => api.uniqueImportFilename('EMM0.MEM', [{ name: 'emm0.mem' }]),
    (error) => error.code === 'LIBRARY_NAME_CONFLICT',
  );
});
