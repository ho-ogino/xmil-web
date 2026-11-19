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
//   createMemoryStore(): for a page opened from a Share link; never saved.
// window.X1PenHuBasicFiles

(function() {
    'use strict';

    var LIST_KEY = 'x1pen_hubasic_files';
    var KEY_PREFIX = 'x1pen_hufile_';
    var MAX_FILE_BYTES = 65535;           // a Hu-BASIC Bin entry; text and raw use the same limit
    var MAX_TOTAL_BYTES = 300 * 1024;     // a 2D disk has 76 free clusters of 4 KB
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
        return null;
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
            if (seen[file.name]) throw filesError('同じ名前のファイルがあります: ' + file.name);
            seen[file.name] = true;
            var kind = file.kind === undefined ? 'raw' : file.kind;
            if (KINDS.indexOf(kind) < 0) throw filesError('種類は text・bin・raw のどれかです: ' + file.name);
            var bytes = toBytes(file.bytes);
            if (!bytes) throw filesError('中身がありません: ' + file.name);
            if (bytes.length > MAX_FILE_BYTES) {
                throw filesError('1 本は ' + MAX_FILE_BYTES + ' バイトまでです: ' + file.name + ' (' + bytes.length + ' バイト)', 'HUBASIC_FILES_TOO_LARGE');
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

    // ── kept in the browser ──
    // deps (for tests): { storage: XmilStorage-like, localStorage }
    function createStore(deps) {
        deps = deps || {};
        var storage = deps.storage || window.XmilStorage;
        var ls = deps.localStorage || window.localStorage;
        var cache = null;     // [{ name, kind, bytes }] after open()

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

        // Reads the saved set and removes bodies no list points at (left by a closed page).
        async function open() {
            var list = readList();
            var referenced = {};
            list.files.forEach(function(f) { referenced[f.key] = true; });
            try {
                var entries = await storage.list();
                await removeQuietly(entries.map(function(e) { return e.key; }).filter(function(key) {
                    return key.indexOf(KEY_PREFIX) === 0 && !referenced[key];
                }));
            } catch (e) { /* storage unavailable: nothing to clean */ }
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
            return { files: summary(files), missing: missing };
        }

        async function replaceAll(next) {
            var files = normalize(next);
            var previous = readList();
            var generation = Date.now().toString(36) + Math.floor(Math.random() * 0x10000).toString(36);
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
            await removeQuietly(previous.files.map(function(f) { return f.key; }));
            return summary(files);
        }

        return makeApi({
            open: open,
            replaceAll: replaceAll,
            current: function() { return cache || []; },
            persistent: true
        });
    }

    // ── a Share session: never saved ──
    function createMemoryStore(initial) {
        var files = normalize(initial || []);
        return makeApi({
            open: async function() { return { files: summary(files), missing: [] }; },
            replaceAll: async function(next) { files = normalize(next); return summary(files); },
            current: function() { return files; },
            persistent: false
        });
    }

    function makeApi(impl) {
        function copy(f) { return { name: f.name, kind: f.kind, bytes: new Uint8Array(f.bytes) }; }
        return {
            persistent: impl.persistent,
            open: impl.open,
            replaceAll: impl.replaceAll,
            list: function() { return summary(impl.current()); },
            files: function() { return impl.current().map(copy); },
            count: function() { return impl.current().length; },
            totalSize: function() { return totalSize(impl.current()); },
            add: function(file) {
                var rest = impl.current().filter(function(f) { return f.name !== file.name; });
                return impl.replaceAll(rest.concat([file]));
            },
            remove: function(name) {
                return impl.replaceAll(impl.current().filter(function(f) { return f.name !== name; }));
            },
            setKind: function(name, kind) {
                return impl.replaceAll(impl.current().map(function(f) {
                    return f.name === name ? { name: f.name, kind: kind, bytes: f.bytes } : f;
                }));
            }
        };
    }

    // ── reading a disk after a run ──
    // Hu-BASIC directory type bits: Bin $01, Bas $02, Asc $04
    function entryKind(mode) {
        if (mode & 0x01) return 'bin';
        if (mode & 0x04) return 'text';
        return 'raw';
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
    // Returns [{ name, kind, size, bytes, protected }]; throws when the image cannot be read.
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
        normalize: normalize,
        createStore: createStore,
        createMemoryStore: createMemoryStore,
        textFromHu: textFromHu,
        readDiskFiles: readDiskFiles
    };
})();
