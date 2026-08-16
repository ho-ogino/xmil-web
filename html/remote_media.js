// Public Google Drive / Dropbox media launch intents and Relay importer.
(function(root) {
    'use strict';

    var MAX_ITEMS = 6;
    var MAX_URL_LENGTH = 2048;
    var MAX_INTENT_BYTES = 8 * 1024;
    var SLOT_TYPES = {
        drive0: 'fdd',
        drive1: 'fdd',
        hdd0: 'hdd',
        hdd1: 'hdd',
        cmt: 'cmt'
    };
    var TYPE_LIMITS = { fdd: 32, hdd: 64, cmt: 32, emm: 16 };
    var EMM_SIZES = [
        320 * 1024,
        512 * 1024,
        1024 * 1024,
        2 * 1024 * 1024,
        4 * 1024 * 1024,
        8 * 1024 * 1024,
        16 * 1024 * 1024
    ];
    var MODEL_VALUES = { x1: 1, x1turbo: 2, x1turboz: 3 };

    function RemoteMediaError(code, message) {
        this.name = 'RemoteMediaError';
        this.code = code;
        this.message = message;
        if (Error.captureStackTrace) Error.captureStackTrace(this, RemoteMediaError);
    }
    RemoteMediaError.prototype = Object.create(Error.prototype);
    RemoteMediaError.prototype.constructor = RemoteMediaError;

    function fail(code, message) {
        throw new RemoteMediaError(code, message);
    }

    function normalizeModelQuery(value) {
        if (value == null || value === '') return null;
        if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(MODEL_VALUES, value)) {
            fail('INVALID_MODEL', 'MODELの指定が正しくありません');
        }
        return value;
    }

    function readLaunchModel(locationObject) {
        if (!locationObject || typeof locationObject.search !== 'string') return null;
        var params = new URLSearchParams(locationObject.search);
        var values = params.getAll('model');
        if (values.length !== 1 || !Object.prototype.hasOwnProperty.call(MODEL_VALUES, values[0])) {
            return null;
        }
        return MODEL_VALUES[values[0]];
    }

    function byteLength(value) {
        return new TextEncoder().encode(value).byteLength;
    }

    function sanitizeFilename(value) {
        if (typeof value !== 'string') return '';
        var result = value.normalize('NFC').trim()
            .replace(/[\u0000-\u001f\u007f/\\&<>"']/g, '_');
        result = Array.from(result).slice(0, 255).join('').trim();
        if (result === '.' || result === '..') return '';
        return result;
    }

    function detectMediaType(filename) {
        var clean = sanitizeFilename(filename);
        if (/^EMM\d\.MEM$/i.test(clean)) return 'emm';
        var dot = clean.lastIndexOf('.');
        var ext = dot >= 0 ? clean.slice(dot + 1).toLowerCase() : '';
        if (ext === 'd88' || ext === '2d' || ext === '88d') return 'fdd';
        if (ext === 'hdd' || ext === 'hd') return 'hdd';
        if (ext === 'cas' || ext === 'cmt' || ext === 'tap' || ext === 'bas' || ext === 'bin') return 'cmt';
        return null;
    }

    function validateOpaque(value, minimum) {
        return typeof value === 'string'
            && value.length >= minimum
            && value.length <= 256
            && /^[A-Za-z0-9_-]+$/.test(value);
    }

    function inspectShareUrl(value) {
        if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) {
            fail('INVALID_URL', '共有URLの長さが正しくありません');
        }
        var url;
        try {
            url = new URL(value);
        } catch (_) {
            fail('INVALID_URL', '共有URLを解釈できません');
        }
        if (url.protocol !== 'https:' || url.username || url.password || url.hash
            || (url.port && url.port !== '443')) {
            fail('INVALID_URL', 'HTTPSの公開共有URLを指定してください');
        }

        var host = url.hostname.toLowerCase();
        var segments = url.pathname.split('/').filter(Boolean);
        if (host === 'drive.google.com' || host === 'docs.google.com') {
            var id = null;
            if (segments.length >= 3 && segments[0] === 'file' && segments[1] === 'd') id = segments[2];
            if (!id && (url.pathname === '/open' || url.pathname === '/uc' || url.pathname === '/file')) {
                id = url.searchParams.get('id');
            }
            if (!validateOpaque(id, 10)) fail('INVALID_URL', 'Google Drive共有URLの形式が正しくありません');
            var resourceKey = url.searchParams.get('resourcekey');
            if (resourceKey && !validateOpaque(resourceKey, 1)) {
                fail('INVALID_URL', 'Google Drive resourcekeyの形式が正しくありません');
            }
            return { provider: 'google-drive', filename: null, sourceIdentity: 'google-drive:' + id };
        }

        if (host === 'dropbox.com' || host === 'www.dropbox.com') {
            var isScl = segments.length >= 4 && segments[0] === 'scl' && segments[1] === 'fi';
            var isLegacy = segments.length >= 3 && segments[0] === 's';
            if (!isScl && !isLegacy) fail('INVALID_URL', 'Dropboxの単一ファイル共有URLを指定してください');
            var idIndex = isScl ? 2 : 1;
            if (!validateOpaque(segments[idIndex], 6)) fail('INVALID_URL', 'Dropbox共有URLの形式が正しくありません');
            var relayKey = url.searchParams.get('rlkey');
            if (relayKey && !validateOpaque(relayKey, 1)) fail('INVALID_URL', 'Dropbox rlkeyの形式が正しくありません');
            var filename = '';
            try { filename = decodeURIComponent(segments[segments.length - 1]); } catch (_) {}
            return { provider: 'dropbox', filename: sanitizeFilename(filename) || null,
                sourceIdentity: 'dropbox:' + segments[idIndex] };
        }
        fail('SOURCE_NOT_ALLOWED', 'Google DriveまたはDropboxの公開共有URLだけを指定できます');
    }

    function normalizeItem(item) {
        if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.url !== 'string') {
            fail('INVALID_ITEM', '共有URLの指定が正しくありません');
        }
        var slot = item.slot == null || item.slot === '' ? null : item.slot;
        if (slot !== null && !Object.prototype.hasOwnProperty.call(SLOT_TYPES, slot)) {
            fail('INVALID_SLOT', 'メディアの挿入先が正しくありません');
        }
        var inspected = inspectShareUrl(item.url);
        if (slot && inspected.filename) {
            var actualType = detectMediaType(inspected.filename);
            if (actualType && actualType !== SLOT_TYPES[slot]) {
                fail('MEDIA_TYPE_MISMATCH', 'Dropboxファイルの形式と挿入先が一致しません');
            }
        }
        return { url: item.url, slot: slot };
    }

    function validateItems(items) {
        if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) {
            fail('INVALID_ITEMS', '1〜' + MAX_ITEMS + '件の共有URLを指定してください');
        }
        var slots = Object.create(null);
        var sources = Object.create(null);
        return items.map(function(item) {
            var normalized = normalizeItem(item);
            if (normalized.slot && slots[normalized.slot]) {
                fail('DUPLICATE_SLOT', '同じ挿入先を複数回指定できません');
            }
            var sourceIdentity = inspectShareUrl(normalized.url).sourceIdentity;
            if (typeof sourceIdentity !== 'string' || sourceIdentity.length === 0) {
                fail('INVALID_SOURCE_IDENTITY', '共有元を一意に識別できません');
            }
            if (sources[sourceIdentity]) {
                fail('DUPLICATE_SOURCE', '同じ共有URLまたは共有元を複数回指定できません');
            }
            if (normalized.slot) slots[normalized.slot] = true;
            sources[sourceIdentity] = true;
            return normalized;
        });
    }

    function normalizeEmm(emm) {
        if (!emm || typeof emm !== 'object' || Array.isArray(emm)
            || typeof emm.slot !== 'string' || !/^emm[0-9]$/.test(emm.slot)
            || !Number.isInteger(emm.size) || EMM_SIZES.indexOf(emm.size) < 0) {
            fail('INVALID_EMM', 'EMMのスロットまたは容量が正しくありません');
        }
        return { slot: emm.slot, size: emm.size };
    }

    function validateIntentParts(items, emms) {
        if (!Array.isArray(items) || !Array.isArray(emms)
            || items.length + emms.length < 1 || items.length + emms.length > MAX_ITEMS) {
            fail('INVALID_ITEMS', '外部メディアとEMMを合計1〜' + MAX_ITEMS + '件指定してください');
        }
        var normalizedItems = items.length ? validateItems(items) : [];
        var slots = Object.create(null);
        normalizedItems.forEach(function(item) {
            if (item.slot) slots[item.slot] = true;
        });
        var normalizedEmms = emms.map(function(emm) {
            var normalized = normalizeEmm(emm);
            if (slots[normalized.slot]) fail('DUPLICATE_SLOT', '同じ挿入先を複数回指定できません');
            slots[normalized.slot] = true;
            return normalized;
        });
        return { items: normalizedItems, emms: normalizedEmms };
    }

    function bytesToBase64Url(bytes) {
        var binary = '';
        for (var i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    }

    function base64UrlToBytes(value) {
        if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
            fail('INVALID_INTENT', '起動URLのデータを解釈できません');
        }
        var base64 = value.replace(/-/g, '+').replace(/_/g, '/');
        base64 += '='.repeat((4 - base64.length % 4) % 4);
        var binary;
        try { binary = atob(base64); } catch (_) { fail('INVALID_INTENT', '起動URLのデータを解釈できません'); }
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    function encodeIntent(items, emms) {
        var normalized = validateIntentParts(items, emms || []);
        var payload = { v: 1, items: normalized.items };
        if (normalized.emms.length) payload.emms = normalized.emms;
        var json = JSON.stringify(payload);
        if (byteLength(json) > MAX_INTENT_BYTES) fail('INTENT_TOO_LARGE', '起動URLのデータが大きすぎます');
        return bytesToBase64Url(new TextEncoder().encode(json));
    }

    function decodeIntent(encoded) {
        var bytes = base64UrlToBytes(encoded);
        if (bytes.byteLength > MAX_INTENT_BYTES) fail('INTENT_TOO_LARGE', '起動URLのデータが大きすぎます');
        var parsed;
        try {
            parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        } catch (_) {
            fail('INVALID_INTENT', '起動URLのデータを解釈できません');
        }
        if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.items)
            || (parsed.emms != null && !Array.isArray(parsed.emms))) {
            fail('INVALID_INTENT', '対応していない起動URLです');
        }
        var normalized = validateIntentParts(parsed.items, parsed.emms || []);
        return { v: 1, items: normalized.items, emms: normalized.emms };
    }

    function buildLaunchUrl(baseUrl, items, model, emms) {
        var url = new URL(baseUrl, root.location ? root.location.href : undefined);
        url.searchParams.delete('model');
        var normalizedModel = normalizeModelQuery(model);
        if (normalizedModel) url.searchParams.set('model', normalizedModel);
        url.hash = 'media=' + encodeIntent(items, emms || []);
        return url.href;
    }

    function hasLaunchRequest(locationObject) {
        var hash = locationObject && typeof locationObject.hash === 'string'
            ? locationObject.hash.slice(1) : '';
        if (!hash) return false;
        return new URLSearchParams(hash).has('media');
    }

    function readIntentFromHash(locationObject) {
        var hash = locationObject && locationObject.hash ? locationObject.hash.slice(1) : '';
        if (!hash) return null;
        var params = new URLSearchParams(hash);
        var encoded = params.get('media');
        return encoded || null;
    }

    function clearIntentHash(locationObject, historyObject) {
        if (!locationObject || !historyObject || typeof historyObject.replaceState !== 'function') return;
        historyObject.replaceState(null, '', locationObject.pathname + locationObject.search);
    }

    async function sha256Hex(value) {
        var digest = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
        return Array.from(new Uint8Array(digest)).map(function(byte) {
            return byte.toString(16).padStart(2, '0');
        }).join('');
    }

    async function sourceIdForUrl(value) {
        return sha256Hex(inspectShareUrl(value).sourceIdentity);
    }

    function normalizeStrongEtag(value) {
        return typeof value === 'string' && value.length <= 256 && /^"[\x21\x23-\x7e]*"$/.test(value)
            ? value : null;
    }

    function decodeRelayFilename(response) {
        var encoded = response.headers.get('X-Disk-Filename');
        if (!encoded) fail('MISSING_FILENAME', '取得したファイル名を確認できませんでした');
        var decoded;
        try { decoded = decodeURIComponent(encoded); } catch (_) { fail('MISSING_FILENAME', '取得したファイル名を確認できませんでした'); }
        var filename = sanitizeFilename(decoded);
        if (!filename || !detectMediaType(filename)) fail('MISSING_FILENAME', '取得したファイル形式を確認できませんでした');
        return filename;
    }

    var API_MESSAGES = {
        GOOGLE_CONFIRMATION_REQUIRED: 'このGoogle Driveファイルは直接取得できません。Dropboxを使うか小さいファイルを指定してください',
        FILE_TOO_LARGE: 'ファイルが対応サイズの上限を超えています',
        NOT_A_DISK_IMAGE: '共有リンクから対応メディアを取得できませんでした',
        MEDIA_TYPE_MISMATCH: 'ファイル形式と挿入先が一致しません',
        RATE_LIMITED: '利用が集中しています。しばらく待ってから再試行してください',
        SOURCE_NOT_FOUND: '公開ファイルが見つかりません',
        LIBRARY_NAME_CONFLICT: '同名のファイルが既にあるため、既存データを保護して追加を中止しました',
        RELAY_DISABLED: '公開URL取得機能は現在停止中です。ローカルファイル選択または既存Google Drive連携を利用してください',
        UPSTREAM_TIMEOUT: '公開ファイルの取得がタイムアウトしました',
        UPSTREAM_ERROR: '公開ファイルを取得できませんでした'
    };

    async function responseError(response) {
        var code = 'RELAY_ERROR';
        try {
            var body = await response.json();
            if (body && typeof body.error === 'string') code = body.error;
        } catch (_) {}
        return new RemoteMediaError(code, API_MESSAGES[code] || '公開ファイルを取得できませんでした');
    }

    function expectedTypeFor(item) {
        if (item.slot) return SLOT_TYPES[item.slot];
        try {
            var inspected = inspectShareUrl(item.url);
            return inspected.filename ? detectMediaType(inspected.filename) : null;
        } catch (_) {
            return null;
        }
    }

    function addFailureMessage(error) {
        if (error && error.code && API_MESSAGES[error.code]) return API_MESSAGES[error.code];
        if (error && error.message) return error.message;
        return '公開ファイルを取得できませんでした';
    }

    function uniqueImportFilename(filename, library) {
        var entries = Array.isArray(library) ? library : [];
        var used = Object.create(null);
        entries.forEach(function(entry) {
            if (entry && typeof entry.name === 'string') used[entry.name.toLowerCase()] = true;
        });
        if (!used[filename.toLowerCase()]) return filename;

        var mediaType = detectMediaType(filename);
        if (mediaType === 'emm') {
            fail('LIBRARY_NAME_CONFLICT', '同名のEMMが既にあるため、既存データを保護して追加を中止しました');
        }
        var dot = filename.lastIndexOf('.');
        var stem = dot > 0 ? filename.slice(0, dot) : filename;
        var extension = dot > 0 ? filename.slice(dot) : '';
        for (var index = 1; index <= 9999; index++) {
            var suffix = ' (' + index + ')';
            var room = Math.max(1, 255 - Array.from(suffix + extension).length);
            var candidate = Array.from(stem).slice(0, room).join('') + suffix + extension;
            if (!used[candidate.toLowerCase()]) return candidate;
        }
        fail('LIBRARY_NAME_CONFLICT', '既存ファイルと重ならない名前を作成できませんでした');
    }

    var consumedLocations = [];

    async function consumeLaunchRequest(core, options) {
        options = options || {};
        var locationObject = options.location || root.location;
        var fetchImpl = options.fetchImpl || root.fetch;
        var FileCtor = options.FileCtor || root.File;
        if (!hasLaunchRequest(locationObject)) return { processed: false, successes: [], failures: [] };
        if (consumedLocations.indexOf(locationObject) >= 0) {
            return { processed: false, alreadyProcessed: true, successes: [], failures: [] };
        }
        consumedLocations.push(locationObject);
        var encoded = readIntentFromHash(locationObject);
        var intent;
        try {
            var mediaValues = new URLSearchParams(locationObject.hash.slice(1)).getAll('media');
            if (mediaValues.length !== 1 || !encoded) fail('INVALID_INTENT', '起動URLのデータを解釈できません');
            intent = decodeIntent(encoded);
        } catch (error) {
            if (core && core.updateStatus) core.updateStatus('公開URLの起動データが不正です: ' + addFailureMessage(error));
            return { processed: true, successes: [], failures: [{ error: error }] };
        }

        var successes = [];
        var failures = [];
        var mostImportantRemoteState = null;
        for (var i = 0; i < intent.items.length; i++) {
            var item = intent.items[i];
            try {
                var inspected = inspectShareUrl(item.url);
                var sourceId = await sourceIdForUrl(item.url);
                var stored = null;
                if (core && typeof core.inspectRemoteLibraryEntry === 'function') {
                    var storageState = await core.inspectRemoteLibraryEntry(sourceId);
                    if (storageState.state === 'missing') {
                        if (typeof core.removeRemoteLibraryMetadata === 'function') {
                            core.removeRemoteLibraryMetadata(sourceId);
                        }
                    } else if (storageState.state === 'size-mismatch') {
                        fail('REMOTE_STORAGE_DAMAGED', '保存済み外部メディアのサイズが一致しません。セーブデータ保護のため自動取得を中止しました');
                    } else if (storageState.state === 'unavailable') {
                        fail('REMOTE_STORAGE_UNAVAILABLE', '保存済み外部メディアを確認できませんでした');
                    } else if (storageState.state === 'ready') {
                        stored = storageState.entry;
                    }
                } else if (core && typeof core.findRemoteLibraryEntry === 'function') {
                    stored = core.findRemoteLibraryEntry(sourceId);
                }

                if (stored) {
                    var storedExpectedType = expectedTypeFor(item);
                    if (item.slot && storedExpectedType && stored.type !== storedExpectedType) {
                        fail('MEDIA_TYPE_MISMATCH', '保存済み外部メディアの形式と挿入先が一致しません');
                    }
                    var remoteState = 'unknown';
                    var strongEtag = normalizeStrongEtag(stored.externalSource && stored.externalSource.strongEtag);
                    if (strongEtag) {
                        try {
                            var probeResponse = await fetchImpl('/api/disk-relay', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ url: item.url, probe: true, strongEtag: strongEtag })
                            });
                            if (probeResponse.ok) {
                                var probeBody = await probeResponse.json();
                                if (probeBody && ['unchanged', 'changed', 'unknown'].indexOf(probeBody.state) >= 0) {
                                    remoteState = probeBody.state;
                                }
                            }
                        } catch (_) {
                            remoteState = 'unknown';
                        }
                    }
                    if (core && typeof core.touchRemoteLibraryEntry === 'function') {
                        stored = core.touchRemoteLibraryEntry(sourceId, remoteState) || stored;
                    }
                    if (item.slot) await core.mountFromLibrary(stored.key, item.slot);
                    successes.push({ entry: stored, slot: item.slot, filename: stored.name,
                        reused: true, remoteState: remoteState });
                    if (remoteState === 'changed') mostImportantRemoteState = 'changed';
                    else if (remoteState === 'unknown' && mostImportantRemoteState !== 'changed') mostImportantRemoteState = 'unknown';
                    continue;
                }

                if (core && core.updateStatus) {
                    core.updateStatus('公開ファイルを取得中 (' + (i + 1) + '/' + intent.items.length + ')');
                }
                var requestBody = { url: item.url };
                var expectedType = expectedTypeFor(item);
                if (expectedType) requestBody.expectedType = expectedType;
                var response = await fetchImpl('/api/disk-relay', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody)
                });
                if (!response.ok) throw await responseError(response);
                var filename = decodeRelayFilename(response);
                var relayEtag = normalizeStrongEtag(response.headers.get('X-Disk-ETag'));
                var bytes = await response.arrayBuffer();
                var file = new FileCtor([bytes], filename, { type: 'application/octet-stream' });
                if (!core || typeof core.addRemoteToLibrary !== 'function') {
                    fail('REMOTE_STORAGE_UNAVAILABLE', '外部メディア用ストレージを利用できません');
                }
                var entry = await core.addRemoteToLibrary(file, {
                    sourceId: sourceId,
                    provider: inspected.provider,
                    strongEtag: relayEtag
                });
                if (!entry) {
                    var mediaType = detectMediaType(filename);
                    var limit = mediaType ? TYPE_LIMITS[mediaType] : null;
                    fail('LIBRARY_ADD_FAILED', 'ライブラリに追加できませんでした'
                        + (limit ? '（' + limit + 'MiB上限）' : ''));
                }
                if (item.slot) await core.mountFromLibrary(entry.key, item.slot);
                successes.push({ entry: entry, slot: item.slot, filename: filename,
                    reused: false, remoteState: 'unchanged' });
            } catch (error) {
                failures.push({ index: i, slot: item.slot, error: error });
            }
        }

        var emmSuccesses = [];
        for (var j = 0; j < intent.emms.length; j++) {
            var emm = intent.emms[j];
            try {
                if (!core || typeof core.mountTemporaryEmm !== 'function') {
                    fail('EMM_UNAVAILABLE', '一時EMMを準備できません');
                }
                await core.mountTemporaryEmm(emm.slot, emm.size);
                emmSuccesses.push({ slot: emm.slot, size: emm.size });
            } catch (error) {
                failures.push({ index: intent.items.length + j, slot: emm.slot, error: error });
            }
        }

        if (core && core.updateStatus) {
            var reusedCount = successes.filter(function(item) { return item.reused; }).length;
            var addedCount = successes.length - reusedCount;
            var summary = '外部メディア: ' + addedCount + '件を保存、' + reusedCount + '件を保存済みから使用';
            if (mostImportantRemoteState === 'changed') {
                summary += '。配布元が前回取得時から変更されています。ゲーム内セーブを含む可能性がある保存済みディスクを上書きせず使用しました';
            } else if (mostImportantRemoteState === 'unknown') {
                summary += '。配布元の更新を確認できませんでした。上書きによるゲーム内セーブ消失を避け、保存済みディスクを使用しました';
            }
            if (failures.length) summary += '、' + failures.length + '件失敗: ' + addFailureMessage(failures[0].error);
            if (emmSuccesses.length) summary += '。一時EMM: ' + emmSuccesses.length + '件（再読み込みで消去）';
            core.updateStatus(summary);
        }
        return { processed: true, successes: successes, emmSuccesses: emmSuccesses, failures: failures };
    }

    root.XmilRemoteMedia = Object.freeze({
        RemoteMediaError: RemoteMediaError,
        sanitizeFilename: sanitizeFilename,
        detectMediaType: detectMediaType,
        inspectShareUrl: inspectShareUrl,
        sourceIdForUrl: sourceIdForUrl,
        validateItems: validateItems,
        validateIntentParts: validateIntentParts,
        encodeIntent: encodeIntent,
        decodeIntent: decodeIntent,
        buildLaunchUrl: buildLaunchUrl,
        normalizeModelQuery: normalizeModelQuery,
        readLaunchModel: readLaunchModel,
        readIntentFromHash: readIntentFromHash,
        hasLaunchRequest: hasLaunchRequest,
        uniqueImportFilename: uniqueImportFilename,
        consumeLaunchRequest: consumeLaunchRequest,
        slotTypes: Object.freeze(Object.assign({}, SLOT_TYPES)),
        emmSizes: Object.freeze(EMM_SIZES.slice()),
        modelValues: Object.freeze(Object.assign({}, MODEL_VALUES)),
        typeLimitsMiB: Object.freeze(Object.assign({}, TYPE_LIMITS))
    });
})(typeof window !== 'undefined' ? window : globalThis);
