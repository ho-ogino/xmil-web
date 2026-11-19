// x1pen_hubasic_files.js — files the HuBASIC tab puts on a Hu-BASIC format disk
// A program that uses the file statements (OPEN, INPUT#, PRINT#, FILES, KILL, ...) boots from a
// fresh Hu-BASIC format disk that holds the program and these files. A file is
//   { name, kind: 'text' | 'bin' | 'raw', bytes: Uint8Array }
// text: LF and CRLF become CR and $1A is added when the disk is built (by the SLANG bundle);
// bin: a Bin entry with its exact size; raw: the bytes as they are (an Asc entry).
//
// Two kinds of store share one interface:
//   createStore(): kept in the browser. Bodies in XmilStorage (OPFS, or IndexedDB) under
//     x1pen_hufile_<generation>_<index>; the list (names, kinds, keys) in localStorage
//     x1pen_hubasic_files. A change writes a whole new generation, then switches the list with one
//     setItem, then removes the old generation, so a failure leaves the previous set intact.
//     Opening (which removes bodies no list points at) and every change hold one Web Lock shared
//     by all tabs of the origin, and a change starts from the set saved last, also by another tab.
//     Without the Web Locks API nothing is saved (createStore returns a memory store with a note).
//     A body that cannot be read leaves the set incomplete: changes and builds stop until it can
//     be read or replaceAll drops it.
//   createMemoryStore(): for a page opened from a Share link; never saved.
// Changes are update(fn): fn gets the current files and returns the next set.
// window.X1PenHuBasicFiles

(function() {
    'use strict';

    var LIST_KEY = 'x1pen_hubasic_files';
    var KEY_PREFIX = 'x1pen_hufile_';
    var MAX_FILE_BYTES = 65535;           // a Hu-BASIC Bin entry (its size field is 16 bits)
    var MAX_TOTAL_BYTES = 300 * 1024;     // a 2D disk has 78 free clusters of 4 KB; text and raw
                                          // (Asc, sized by records) are limited by this only
    var MAX_FILES = 64;
    var KINDS = ['text', 'bin', 'raw'];

    function filesError(message, code) {
        var error = new Error(message);
        error.code = code || 'HUBASIC_FILES_INVALID';
        return error;
    }

    // The Hu-BASIC directory name rules (as the SLANG disk builder applies them), in ASCII:
    // 1-13 characters before the last '.', up to 3 after it, case kept. '"' and ':' are not
    // allowed in Hu-BASIC names; '=' and ',' would break the disk builder's file list.
    function checkName(name) {
        if (typeof name !== 'string' || name.length === 0) return 'ファイル名がありません';
        if (!/^[\x20-\x7E]+$/.test(name)) return 'ファイル名は半角の英数字と記号で書いてください: ' + name;
        if (/[":=,]/.test(name)) return 'ファイル名に " : = , は使えません: ' + name;
        if (name !== name.trim()) return 'ファイル名の前後に空白は置けません: ' + name;
        var dot = name.lastIndexOf('.');
        var base = dot < 0 ? name : name.slice(0, dot);
        var ext = dot < 0 ? '' : name.slice(dot + 1);
        if (base.length < 1 || base.length > 13) return 'ファイル名は「.」の前が 1〜13 文字です: ' + name;
        if (ext.length > 3) return '拡張子は 3 文字までです: ' + name;
        // The directory pads both parts with spaces, so a space at their end would be lost
        if (/ $/.test(base) || / $/.test(ext)) return '「.」の前後に空白は置けません: ' + name;
        return null;
    }

    // The name as the directory holds it: "A" and "A." are the same entry
    function diskName(name) {
        var dot = name.lastIndexOf('.');
        return dot < 0 ? name + '.' : name;
    }

    function toBytes(value) {
        if (value instanceof Uint8Array) return value;
        if (value instanceof ArrayBuffer) return new Uint8Array(value);
        if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        return null;
    }

    // Checks a whole set; returns a fresh array of { name, kind, bytes } or throws.
    function normalize(files) {
        if (!Array.isArray(files)) throw filesError('files must be an array');
        if (files.length > MAX_FILES) throw filesError('入れられるファイルは ' + MAX_FILES + ' 本までです');
        var seen = {};
        var total = 0;
        return files.map(function(file) {
            if (!file || typeof file !== 'object') throw filesError('a file must be an object');
            var problem = checkName(file.name);
            if (problem) throw filesError(problem);
            if (seen[diskName(file.name)]) throw filesError('同じ名前のファイルがあります: ' + file.name);
            seen[diskName(file.name)] = true;
            var kind = file.kind === undefined ? 'raw' : file.kind;
            if (KINDS.indexOf(kind) < 0) throw filesError('種類は text・bin・raw のどれかです: ' + file.name);
            var bytes = toBytes(file.bytes);
            if (!bytes) throw filesError('中身がありません: ' + file.name);
            if (kind === 'bin' && bytes.length > MAX_FILE_BYTES) {
                throw filesError('Bin のファイルは 1 本 ' + MAX_FILE_BYTES + ' バイトまでです: ' + file.name + ' (' + bytes.length + ' バイト)', 'HUBASIC_FILES_TOO_LARGE');
            }
            total += bytes.length;
            if (total > MAX_TOTAL_BYTES) {
                throw filesError('合計は ' + MAX_TOTAL_BYTES + ' バイトまでです', 'HUBASIC_FILES_TOO_LARGE');
            }
            return { name: file.name, kind: kind, bytes: new Uint8Array(bytes) };
        });
    }

    function summary(files) {
        return files.map(function(f) { return { name: f.name, kind: f.kind, size: f.bytes ? f.bytes.length : f.size }; });
    }

    function totalSize(files) {
        return files.reduce(function(sum, f) { return sum + (f.bytes ? f.bytes.length : f.size); }, 0);
    }

    // Runs fn while holding the lock of the saved files (the Web Locks API, shared by every tab of
    // the origin); calls of one page also run one after another.
    var LOCK_NAME = 'x1pen_hubasic_files';
    function makeLock(locks) {
        var chain = Promise.resolve();
        return function(fn) {
            var run = chain.then(function() {
                return locks ? locks.request(LOCK_NAME, function() { return fn(); }) : fn();
            });
            chain = run.catch(function() {});
            return run;
        };
    }

    // <time in base 36><4 random base-36 digits>
    function newGeneration() {
        var random = Math.floor(Math.random() * Math.pow(36, 4)).toString(36);
        while (random.length < 4) random = '0' + random;
        return Date.now().toString(36) + random;
    }

    function unreadableError(names) {
        return filesError('保存してあるファイルを読めません: ' + names.join(', ') +
            '（読めるようにならないときは「Files」でそのファイルを外してください）', 'HUBASIC_FILES_UNREADABLE');
    }

    var NOT_SAVED_NOTE = 'このブラウザでは、ここのファイルを保存できません（このタブを閉じると消えます）。';

    // ── kept in the browser ──
    // deps (for tests): { storage: XmilStorage-like, localStorage, locks: LockManager-like or null }
    function createStore(deps) {
        deps = deps || {};
        var locks = deps.locks !== undefined ? deps.locks
            : ((typeof navigator !== 'undefined' && navigator.locks) ? navigator.locks : null);
        // Saving needs a lock all tabs share: without it, two tabs could save over each other
        if (!locks) return createMemoryStore([], NOT_SAVED_NOTE);
        var storage = deps.storage || window.XmilStorage;
        var ls = deps.localStorage || window.localStorage;
        var withLock = makeLock(locks);
        var cache = [];             // [{ name, kind, bytes }]: the readable files of the saved set
        var cacheGeneration = null;
        var unreadable = [];        // names in the saved set whose bodies could not be read

        function readList() {
            var raw = ls.getItem(LIST_KEY);
            if (!raw) return { generation: null, files: [] };
            var parsed;
            try { parsed = JSON.parse(raw); } catch (e) { return { generation: null, files: [] }; }
            if (!parsed || typeof parsed.generation !== 'string' || !Array.isArray(parsed.files)) {
                return { generation: null, files: [] };
            }
            return parsed;
        }

        async function removeQuietly(keys) {
            for (var i = 0; i < keys.length; i++) {
                try { await storage.remove(keys[i]); } catch (e) { /* removed on the next open */ }
            }
        }

        // Loads the set the list points at
        async function load(list) {
            var files = [];
            var missing = [];
            for (var i = 0; i < list.files.length; i++) {
                var entry = list.files[i];
                var body = null;
                try { body = await storage.read(entry.key); } catch (e) { body = null; }
                if (!body) { missing.push(entry.name); continue; }
                files.push({ name: entry.name, kind: entry.kind, bytes: new Uint8Array(body) });
            }
            cache = files;
            cacheGeneration = list.generation;
            unreadable = missing;
        }

        // The saved set, read again when another tab changed it or a body could not be read before
        async function sync() {
            var list = readList();
            if (list.generation === cacheGeneration && unreadable.length === 0) return { list: list, changed: false };
            await load(list);
            return { list: list, changed: true };
        }

        // Reads the saved set and removes bodies no list points at (left by a closed page), under
        // the lock, so never the bodies of a change another tab is making.
        function open() {
            return withLock(async function() {
                var list = readList();
                var referenced = {};
                list.files.forEach(function(f) { referenced[f.key] = true; });
                try {
                    var entries = await storage.list();
                    await removeQuietly(entries.map(function(e) { return e.key; }).filter(function(key) {
                        return key.indexOf(KEY_PREFIX) === 0 && !referenced[key];
                    }));
                } catch (e) { /* storage unavailable: nothing to clean */ }
                await load(list);
                return { files: summary(cache), missing: unreadable.slice() };
            });
        }

        // Saves next as a new generation, then switches the list and removes the previous one
        async function publish(previous, next) {
            var files = normalize(next);
            var generation = newGeneration();
            var written = [];
            var entries = files.map(function(f, i) {
                return { name: f.name, kind: f.kind, size: f.bytes.length, key: KEY_PREFIX + generation + '_' + i };
            });
            try {
                if (storage.ensureCapacity) await storage.ensureCapacity(totalSize(files));
                for (var i = 0; i < files.length; i++) {
                    var bytes = files[i].bytes;
                    await storage.write(entries[i].key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
                    written.push(entries[i].key);
                }
            } catch (e) {
                await removeQuietly(written);
                throw filesError('ファイルを保存できませんでした: ' + (e && e.message || e), 'HUBASIC_FILES_SAVE_FAILED');
            }
            var json = JSON.stringify({ version: 1, generation: generation, files: entries });
            try {
                ls.setItem(LIST_KEY, json);
                if (ls.getItem(LIST_KEY) !== json) throw new Error('the list did not read back');
            } catch (e) {
                // Put the previous list back if the failed write changed it
                try {
                    if (previous.generation) ls.setItem(LIST_KEY, JSON.stringify(previous));
                    else ls.removeItem(LIST_KEY);
                } catch (ignored) {}
                await removeQuietly(written);
                throw filesError('ファイルの一覧を保存できませんでした: ' + (e && e.message || e), 'HUBASIC_FILES_SAVE_FAILED');
            }
            cache = files;
            cacheGeneration = generation;
            unreadable = [];
            await removeQuietly(previous.files.map(function(f) { return f.key; }));
            return summary(files);
        }

        // fn(files) → the next set, applied to the set saved last. Refused while a file of that
        // set cannot be read: the change would drop it.
        function update(fn) {
            return withLock(async function() {
                var state = await sync();
                if (unreadable.length > 0) throw unreadableError(unreadable);
                return publish(state.list, fn(cache.map(copyFile)));
            });
        }

        // Replaces the whole set, unreadable files included (what the user asked for)
        function replaceAll(next) {
            return withLock(async function() {
                return publish(readList(), next);
            });
        }

        // Reads the saved set again if another tab changed it (or a body was unreadable); true
        // when the set read now differs
        function refresh() {
            return withLock(async function() { return (await sync()).changed; });
        }

        return makeApi({
            open: open,
            update: update,
            replaceAll: replaceAll,
            refresh: refresh,
            current: function() { return cache; },
            unreadable: function() { return unreadable.slice(); },
            persistent: true,
            note: null
        });
    }

    // ── not saved: a page opened from a Share link, or a browser without Web Locks ──
    function createMemoryStore(initial, note) {
        var files = normalize(initial || []);
        var withLock = makeLock(null);
        function update(fn) {
            return withLock(async function() {
                files = normalize(fn(files.map(copyFile)));
                return summary(files);
            });
        }
        return makeApi({
            open: async function() { return { files: summary(files), missing: [] }; },
            update: update,
            replaceAll: function(next) { return update(function() { return next; }); },
            refresh: async function() { return false; },
            current: function() { return files; },
            unreadable: function() { return []; },
            persistent: false,
            note: note || null
        });
    }

    function copyFile(f) { return { name: f.name, kind: f.kind, bytes: new Uint8Array(f.bytes) }; }

    function makeApi(impl) {
        function withoutName(files, name) {
            return files.filter(function(f) { return f.name !== name; });
        }
        return {
            persistent: impl.persistent,
            note: impl.note,
            open: impl.open,
            update: impl.update,
            refresh: impl.refresh,
            replaceAll: impl.replaceAll,
            // Names of saved files whose bodies could not be read (see createStore)
            unreadable: impl.unreadable,
            list: function() { return summary(impl.current()); },
            files: function() { return impl.current().map(copyFile); },
            count: function() { return impl.current().length; },
            totalSize: function() { return totalSize(impl.current()); },
            // Adds or replaces files by name
            put: function(added) {
                return impl.update(function(files) {
                    added.forEach(function(file) { files = withoutName(files, file.name).concat([file]); });
                    return files;
                });
            },
            remove: function(name) {
                return impl.update(function(files) { return withoutName(files, name); });
            },
            rename: function(name, next) {
                return impl.update(function(files) {
                    return files.map(function(f) { return f.name === name ? { name: next, kind: f.kind, bytes: f.bytes } : f; });
                });
            },
            setKind: function(name, kind) {
                return impl.update(function(files) {
                    return files.map(function(f) { return f.name === name ? { name: f.name, kind: kind, bytes: f.bytes } : f; });
                });
            }
        };
    }

    // ── reading a disk after a run ──
    // Hu-BASIC directory types: Bin ($01), Bas ($02), Asc (the others). An Asc entry may hold text
    // or raw records; the directory does not say which, so it is read back as 'asc'.
    function entryKind(mode) {
        if (mode & 0x01) return 'bin';
        if (mode & 0x02) return 'bas';
        return 'asc';
    }

    // An Asc file as text: up to the first $1A, CR as LF
    function textFromHu(bytes) {
        var end = bytes.indexOf(0x1A);
        if (end < 0) end = bytes.length;
        var out = new Uint8Array(end);
        for (var i = 0; i < end; i++) out[i] = bytes[i] === 0x0D ? 0x0A : bytes[i];
        return out;
    }

    // The files on a Hu-BASIC format D88 (XmilDiskContainer/XmilDiskFS), without directories.
    // Returns [{ name, kind: 'bin'|'bas'|'asc', size, bytes, protected }]; throws when the image
    // cannot be read. An Asc file is whole records (it ends at its first $1A when it is text).
    function readDiskFiles(d88) {
        var buffer = d88.buffer.slice(d88.byteOffset, d88.byteOffset + d88.byteLength);
        var container = window.XmilDiskContainer.openContainer(buffer, 'hubasic.d88');
        if (!container) throw filesError('ディスクイメージを読めませんでした', 'HUBASIC_DISK_UNREADABLE');
        var fs = new window.XmilDiskFS.HuBasicFS(container);
        var out = [];
        fs.listDirectory().forEach(function(entry) {
            if (entry.isDirectory || entry.isDeleted || entry.isEnd) return;
            var data = fs.readFile(entry);
            var bytes = data && data.data ? data.data : data;
            if (!bytes) return;
            var name = entry.name.replace(/\s+$/, '');
            var ext = entry.ext.replace(/\s+$/, '');
            out.push({
                name: ext ? name + '.' + ext : name,
                kind: entryKind(entry.mode),
                size: bytes.length,
                bytes: new Uint8Array(bytes),
                protected: !!entry.isReadonly
            });
        });
        return out;
    }

    window.X1PenHuBasicFiles = {
        LIST_KEY: LIST_KEY,
        KEY_PREFIX: KEY_PREFIX,
        MAX_FILE_BYTES: MAX_FILE_BYTES,
        MAX_TOTAL_BYTES: MAX_TOTAL_BYTES,
        MAX_FILES: MAX_FILES,
        checkName: checkName,
        diskName: diskName,
        normalize: normalize,
        createStore: createStore,
        createMemoryStore: createMemoryStore,
        textFromHu: textFromHu,
        readDiskFiles: readDiskFiles
    };
})();
