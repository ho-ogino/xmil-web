// storage.js - OPFS/IDB unified persistent storage for X millennium Web
// Must be loaded before pre.js (xmillennium.js)
//
// Exposes: window.XmilStorage
//   .write(key, arrayBuffer)          → Promise<void>
//   .writeStream(key, chunkFn)        → Promise<void>   chunkFn: async()=>Uint8Array|null
//   .read(key)                        → Promise<ArrayBuffer|null>
//   .remove(key)                      → Promise<void>
//   .list()                           → Promise<[{key,name,size}]>
//   .ensureCapacity(neededBytes)      → Promise<void>  throws if insufficient
//   .detectBackend()                  → Promise<'opfs'|'idb'>
//
// Backend selection (auto, cached):
//   OPFS: Chrome 86+, Firefox 111+, Safari 15.2+
//   IDB:  Fallback for older browsers
//   NOTE: localStorage fallback is NOT provided (3MB limit is incompatible with large HDD images)

(function() {
    'use strict';

    var _backend = null;   // 'opfs' | 'idb'
    var _idb     = null;   // IDBDatabase instance

    // ----------------------------------------------------------------
    // OPFS キーマニフェスト (xmil が管理するキーを localStorage に記録)
    // clearStorage() がアプリ管理外のキーを誤って削除しないための安全装置
    // ----------------------------------------------------------------
    var MANIFEST_KEY = 'xmil_opfs_manifest';

    function _manifestAdd(key) {
        try {
            var m = JSON.parse(localStorage.getItem(MANIFEST_KEY) || '[]');
            if (m.indexOf(key) === -1) { m.push(key); localStorage.setItem(MANIFEST_KEY, JSON.stringify(m)); }
        } catch(e) {}
    }

    function _manifestRemove(key) {
        try {
            var m = JSON.parse(localStorage.getItem(MANIFEST_KEY) || '[]');
            m = m.filter(function(k) { return k !== key; });
            localStorage.setItem(MANIFEST_KEY, JSON.stringify(m));
        } catch(e) {}
    }

    // ----------------------------------------------------------------
    // Backend detection (run once, result cached)
    // ----------------------------------------------------------------
    async function detectBackend() {
        if (_backend) return _backend;
        try {
            var root = await navigator.storage.getDirectory();
            var fh   = await root.getFileHandle('_probe', { create: true });
            var ws   = await fh.createWritable();
            await ws.close();
            await root.removeEntry('_probe');
            _backend = 'opfs';
        } catch(e) {
            _backend = 'idb';
        }
        return _backend;
    }

    // ----------------------------------------------------------------
    // OPFS implementation
    // ----------------------------------------------------------------
    async function opfsWrite(key, arrayBuffer) {
        var root  = await navigator.storage.getDirectory();
        var fh    = await root.getFileHandle(key, { create: true });
        var ws    = await fh.createWritable();
        var CHUNK = 64 * 1024;
        for (var off = 0; off < arrayBuffer.byteLength; off += CHUNK) {
            var end = Math.min(off + CHUNK, arrayBuffer.byteLength);
            await ws.write(arrayBuffer.slice(off, end));
        }
        await ws.close();
    }

    // Streaming write: chunkFn called repeatedly, returns Uint8Array or null to stop.
    // Writes directly to OPFS without accumulating the full buffer in memory.
    // Peak memory = one chunk (64KB) only.
    async function opfsWriteStream(key, chunkFn) {
        var root = await navigator.storage.getDirectory();
        var fh   = await root.getFileHandle(key, { create: true });
        var ws   = await fh.createWritable();
        var chunk;
        try {
            while ((chunk = await chunkFn()) !== null) {
                await ws.write(chunk);
            }
            await ws.close();
        } catch(e) {
            try { await ws.abort(); } catch(_) {}
            throw e;
        }
    }

    async function opfsRead(key) {
        try {
            var root = await navigator.storage.getDirectory();
            var fh   = await root.getFileHandle(key, { create: false });
            var f    = await fh.getFile();
            return await f.arrayBuffer();
        } catch(e) {
            return null;   // file not found
        }
    }

    async function opfsRemove(key) {
        try {
            var root = await navigator.storage.getDirectory();
            await root.removeEntry(key);
        } catch(e) {}
    }

    async function opfsList() {
        var result = [];
        try {
            var root = await navigator.storage.getDirectory();
            for await (var entry of root.values()) {
                if (entry.kind === 'file') {
                    var f = await entry.getFile();
                    result.push({ key: entry.name, name: entry.name, size: f.size });
                }
            }
        } catch(e) {}
        return result;
    }

    // ----------------------------------------------------------------
    // IDB implementation (fallback for older browsers)
    // Note: IDB writeStream collects all chunks before storing.
    //       Peak memory = full file size. This is acceptable for fallback.
    // ----------------------------------------------------------------
    var IDB_NAME    = 'xmil_storage';
    var IDB_STORE   = 'files';
    var IDB_VERSION = 1;

    function openIdb() {
        return new Promise(function(resolve, reject) {
            if (_idb) { resolve(_idb); return; }
            var req = indexedDB.open(IDB_NAME, IDB_VERSION);
            req.onupgradeneeded = function(e) {
                e.target.result.createObjectStore(IDB_STORE);
            };
            req.onsuccess = function(e) {
                _idb = e.target.result;
                resolve(_idb);
            };
            req.onerror = function(e) {
                reject(e.target.error);
            };
        });
    }

    async function idbWrite(key, arrayBuffer) {
        var db = await openIdb();
        return new Promise(function(resolve, reject) {
            var tx  = db.transaction(IDB_STORE, 'readwrite');
            var st  = tx.objectStore(IDB_STORE);
            st.put(arrayBuffer, key);
            tx.oncomplete = resolve;
            tx.onerror    = function(e) { reject(e.target.error); };
        });
    }

    async function idbWriteStream(key, chunkFn) {
        // Collect all chunks (IDB doesn't support streaming writes)
        var chunks    = [];
        var totalSize = 0;
        var chunk;
        while ((chunk = await chunkFn()) !== null) {
            chunks.push(chunk);
            totalSize += chunk.byteLength;
        }
        var full = new Uint8Array(totalSize);
        var off  = 0;
        for (var i = 0; i < chunks.length; i++) {
            full.set(chunks[i], off);
            off += chunks[i].byteLength;
        }
        await idbWrite(key, full.buffer);
    }

    async function idbRead(key) {
        try {
            var db = await openIdb();
            return new Promise(function(resolve, reject) {
                var tx  = db.transaction(IDB_STORE, 'readonly');
                var req = tx.objectStore(IDB_STORE).get(key);
                req.onsuccess = function(e) { resolve(e.target.result || null); };
                req.onerror   = function(e) { reject(e.target.error); };
            });
        } catch(e) {
            return null;
        }
    }

    async function idbRemove(key) {
        try {
            var db = await openIdb();
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(IDB_STORE, 'readwrite');
                tx.objectStore(IDB_STORE).delete(key);
                tx.oncomplete = resolve;
                tx.onerror    = function(e) { reject(e.target.error); };
            });
        } catch(e) {}
    }

    async function idbList() {
        try {
            var db = await openIdb();
            return new Promise(function(resolve, reject) {
                var result = [];
                var tx     = db.transaction(IDB_STORE, 'readonly');
                tx.objectStore(IDB_STORE).openCursor().onsuccess = function(e) {
                    var cursor = e.target.result;
                    if (!cursor) { resolve(result); return; }
                    var size = cursor.value ? (cursor.value.byteLength || 0) : 0;
                    result.push({ key: cursor.key, name: cursor.key, size: size });
                    cursor.continue();
                };
                tx.onerror = function(e) { reject(e.target.error); };
            });
        } catch(e) {
            return [];
        }
    }

    // ----------------------------------------------------------------
    // Capacity / persist (called once at first save)
    // ----------------------------------------------------------------
    var _persistRequested = false;

    async function ensureCapacity(neededBytes) {
        try {
            if (navigator.storage && navigator.storage.estimate) {
                var est   = await navigator.storage.estimate();
                var avail = (est.quota || 0) - (est.usage || 0);
                if (avail > 0 && avail < neededBytes * 1.1) {
                    throw new Error('容量不足: 必要 ' + Math.round(neededBytes / 1e6) +
                                    'MB, 空き ' + Math.round(avail / 1e6) + 'MB');
                }
            }
        } catch(e) {
            if (e.message && e.message.indexOf('容量不足') >= 0) throw e;
            // estimate() unavailable on this browser — skip check
        }
        if (!_persistRequested && navigator.storage && navigator.storage.persist) {
            _persistRequested = true;
            navigator.storage.persist().catch(function() {});
        }
    }

    // ----------------------------------------------------------------
    // Unified interface
    // ----------------------------------------------------------------
    window.XmilStorage = {
        detectBackend: detectBackend,

        async write(key, arrayBuffer) {
            var b = await detectBackend();
            var result = b === 'opfs' ? await opfsWrite(key, arrayBuffer) : await idbWrite(key, arrayBuffer);
            _manifestAdd(key);
            return result;
        },

        async writeStream(key, chunkFn) {
            var b = await detectBackend();
            var result = b === 'opfs' ? await opfsWriteStream(key, chunkFn) : await idbWriteStream(key, chunkFn);
            _manifestAdd(key);
            return result;
        },

        async read(key) {
            var b = await detectBackend();
            return b === 'opfs' ? opfsRead(key) : idbRead(key);
        },

        async remove(key) {
            var b = await detectBackend();
            var result = b === 'opfs' ? await opfsRemove(key) : await idbRemove(key);
            _manifestRemove(key);
            return result;
        },

        async list() {
            var b = await detectBackend();
            return b === 'opfs' ? opfsList() : idbList();
        },

        ensureCapacity: ensureCapacity
    };

})();
