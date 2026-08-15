const MAX_URL_LENGTH = 2048;
const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_REDIRECTS = 5;
const UPSTREAM_TIMEOUT_MS = 60_000;

const MEDIA_LIMITS = Object.freeze({
    fdd: 32 * 1024 * 1024,
    hdd: 64 * 1024 * 1024,
    cmt: 32 * 1024 * 1024,
    emm: 16 * 1024 * 1024,
});

const SLOT_TYPES = Object.freeze({
    drive0: 'fdd',
    drive1: 'fdd',
    hdd0: 'hdd',
    hdd1: 'hdd',
    cmt: 'cmt',
});

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class RelayError extends Error {
    constructor(status, code, message) {
        super(message);
        this.name = 'RelayError';
        this.status = status;
        this.code = code;
    }
}

function fail(status, code, message) {
    throw new RelayError(status, code, message);
}

function isDefaultHttpsPort(url) {
    return url.port === '' || url.port === '443';
}

function isGoogleInputHost(host) {
    return host === 'drive.google.com' || host === 'docs.google.com';
}

function isDropboxInputHost(host) {
    return host === 'dropbox.com' || host === 'www.dropbox.com';
}

function isOwnedSubdomain(host, domain) {
    return host.length > domain.length + 1 && host.endsWith('.' + domain);
}

function isProviderRedirectHost(provider, host) {
    if (provider === 'google-drive') {
        return host === 'drive.google.com'
            || host === 'docs.google.com'
            || host === 'drive.usercontent.google.com'
            || host === 'googleusercontent.com'
            || isOwnedSubdomain(host, 'googleusercontent.com');
    }
    if (provider === 'dropbox') {
        return host === 'dropbox.com'
            || host === 'www.dropbox.com'
            || host === 'dl.dropboxusercontent.com'
            || host === 'dropboxusercontent.com'
            || isOwnedSubdomain(host, 'dropboxusercontent.com');
    }
    return false;
}

function assertSafeHttpsUrl(url) {
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || !isDefaultHttpsPort(url)) {
        fail(400, 'INVALID_URL', 'HTTPSの公開共有URLを指定してください');
    }
}

function validateOpaqueValue(value, name, minLength = 1) {
    if (typeof value !== 'string'
        || value.length < minLength
        || value.length > 256
        || !/^[A-Za-z0-9_-]+$/.test(value)) {
        fail(400, 'INVALID_URL', name + 'の形式が正しくありません');
    }
    return value;
}

function decodePathSegment(value) {
    try {
        return decodeURIComponent(value);
    } catch (_) {
        fail(400, 'INVALID_URL', 'URLのパスを解釈できません');
    }
}

function parseGoogleSource(url) {
    const segments = url.pathname.split('/').filter(Boolean);
    let id = null;
    if (segments.length >= 3 && segments[0] === 'file' && segments[1] === 'd') id = segments[2];
    if (!id && (url.pathname === '/open' || url.pathname === '/uc' || url.pathname === '/file')) {
        id = url.searchParams.get('id');
    }
    id = validateOpaqueValue(id, 'Google DriveファイルID', 10);

    const target = new URL('https://drive.usercontent.google.com/download');
    target.searchParams.set('id', id);
    target.searchParams.set('export', 'download');
    target.searchParams.set('confirm', 't');
    const resourceKey = url.searchParams.get('resourcekey');
    if (resourceKey) {
        target.searchParams.set('resourcekey', validateOpaqueValue(resourceKey, 'resourcekey'));
    }
    return { provider: 'google-drive', target, sourceFilename: null };
}

function parseDropboxSource(url) {
    const segments = url.pathname.split('/').filter(Boolean);
    const isScl = segments.length >= 4 && segments[0] === 'scl' && segments[1] === 'fi';
    const isLegacy = segments.length >= 3 && segments[0] === 's';
    if (!isScl && !isLegacy) {
        fail(400, 'INVALID_URL', 'Dropboxの単一ファイル共有URLを指定してください');
    }

    const idIndex = isScl ? 2 : 1;
    validateOpaqueValue(segments[idIndex], 'Dropbox共有ID', 6);
    const sourceFilename = decodePathSegment(segments[segments.length - 1]);
    const target = new URL(url.href);
    target.hostname = 'dl.dropboxusercontent.com';
    target.search = '';
    const relayKey = url.searchParams.get('rlkey');
    if (relayKey) target.searchParams.set('rlkey', validateOpaqueValue(relayKey, 'rlkey'));
    target.searchParams.set('dl', '1');
    return { provider: 'dropbox', target, sourceFilename };
}

export function normalizeSourceUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > MAX_URL_LENGTH) {
        fail(400, 'INVALID_URL', '共有URLの長さが正しくありません');
    }

    let url;
    try {
        url = new URL(rawUrl);
    } catch (_) {
        fail(400, 'INVALID_URL', '共有URLを解釈できません');
    }
    assertSafeHttpsUrl(url);
    const host = url.hostname.toLowerCase();
    if (isGoogleInputHost(host)) return parseGoogleSource(url);
    if (isDropboxInputHost(host)) return parseDropboxSource(url);
    fail(403, 'SOURCE_NOT_ALLOWED', 'Google DriveまたはDropboxの公開共有URLだけを指定できます');
}

export function sanitizeFilename(value) {
    if (typeof value !== 'string') return '';
    let result = value.normalize('NFC').trim()
        .replace(/[\u0000-\u001f\u007f/\\&<>"']/g, '_');
    result = Array.from(result).slice(0, 255).join('').trim();
    if (result === '.' || result === '..') return '';
    return result;
}

function decode5987(value) {
    const match = /^([^']*)'[^']*'(.*)$/.exec(value.trim());
    const encoded = match ? match[2] : value.trim();
    try {
        return decodeURIComponent(encoded);
    } catch (_) {
        return '';
    }
}

export function parseContentDispositionFilename(header) {
    if (!header) return '';
    const extended = /(?:^|;)\s*filename\*\s*=\s*([^;]+)/i.exec(header);
    if (extended) {
        const decoded = decode5987(extended[1]);
        if (decoded) return decoded;
    }
    const quoted = /(?:^|;)\s*filename\s*=\s*"((?:\\.|[^"])*)"/i.exec(header);
    if (quoted) return quoted[1].replace(/\\(.)/g, '$1');
    const plain = /(?:^|;)\s*filename\s*=\s*([^;]+)/i.exec(header);
    return plain ? plain[1].trim() : '';
}

export function detectMediaType(filename) {
    const clean = sanitizeFilename(filename);
    if (/^EMM\d\.MEM$/i.test(clean)) return 'emm';
    const dot = clean.lastIndexOf('.');
    const ext = dot >= 0 ? clean.slice(dot + 1).toLowerCase() : '';
    if (ext === 'd88' || ext === '2d' || ext === '88d') return 'fdd';
    if (ext === 'hdd' || ext === 'hd') return 'hdd';
    if (ext === 'cas' || ext === 'cmt' || ext === 'tap' || ext === 'bas' || ext === 'bin') return 'cmt';
    return null;
}

function asciiFilenameFallback(filename) {
    const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/[\\";]/g, '_');
    return fallback || 'disk-image.bin';
}

function encode5987(filename) {
    return encodeURIComponent(filename).replace(/[!'()*]/g, (character) =>
        '%' + character.charCodeAt(0).toString(16).toUpperCase());
}

function jsonResponse(status, error, message, extraHeaders) {
    const headers = new Headers(extraHeaders || {});
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(JSON.stringify({ error, message }), { status, headers });
}

function errorResponse(error) {
    if (error instanceof RelayError) {
        return jsonResponse(error.status, error.code, error.message);
    }
    return jsonResponse(502, 'UPSTREAM_ERROR', '公開ファイルを取得できませんでした');
}

export function normalizeStrongEtag(value) {
    if (typeof value !== 'string' || value.length > 256) return null;
    return /^"[\x21\x23-\x7e]*"$/.test(value) ? value : null;
}

function probeResponse(state) {
    const headers = new Headers();
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(JSON.stringify({ state }), { status: 200, headers });
}

function contentTypeIsDocument(contentType) {
    const value = (contentType || '').toLowerCase();
    return value.includes('text/html') || value.includes('application/xhtml+xml')
        || value.includes('application/json') || value.includes('text/json');
}

async function readBodyPrefix(response, maxBytes = 128 * 1024) {
    if (!response.body) return '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let text = '';
    try {
        while (total < maxBytes) {
            const { done, value } = await reader.read();
            if (done) break;
            const take = value.subarray(0, Math.min(value.byteLength, maxBytes - total));
            total += take.byteLength;
            text += decoder.decode(take, { stream: total < maxBytes });
            if (take.byteLength < value.byteLength) break;
        }
    } finally {
        try { await reader.cancel(); } catch (_) {}
    }
    return text;
}

function looksLikeGoogleConfirmation(html) {
    return /virus.{0,40}scan|download-form|confirm=[A-Za-z0-9_-]+|Google Drive can't scan/i.test(html);
}

function makeBoundedBody(body, maxBytes, abortController, clearTimer) {
    const reader = body.getReader();
    let total = 0;
    let finished = false;
    function finish() {
        if (finished) return;
        finished = true;
        clearTimer();
    }
    return new ReadableStream({
        async pull(controller) {
            try {
                const { done, value } = await reader.read();
                if (done) {
                    finish();
                    controller.close();
                    return;
                }
                total += value.byteLength;
                if (total > maxBytes) {
                    finish();
                    abortController.abort();
                    try { await reader.cancel('file too large'); } catch (_) {}
                    controller.error(new RelayError(413, 'FILE_TOO_LARGE', 'ファイルがサイズ上限を超えています'));
                    return;
                }
                controller.enqueue(value);
            } catch (error) {
                finish();
                controller.error(error);
            }
        },
        async cancel(reason) {
            finish();
            abortController.abort();
            try { await reader.cancel(reason); } catch (_) {}
        },
    });
}

async function fetchFollowingRedirects(source, fetchImpl, signal) {
    let current = source.target;
    for (let redirects = 0; ; redirects++) {
        let response;
        try {
            response = await fetchImpl(current.href, {
                method: 'GET',
                redirect: 'manual',
                headers: { Accept: 'application/octet-stream' },
                signal,
            });
        } catch (error) {
            if (signal.aborted) fail(504, 'UPSTREAM_TIMEOUT', '公開ファイルの取得がタイムアウトしました');
            fail(502, 'UPSTREAM_ERROR', '公開ファイルを取得できませんでした');
        }

        if (!REDIRECT_STATUSES.has(response.status)) return { response, finalUrl: current };
        if (redirects >= MAX_REDIRECTS) {
            try { await response.body?.cancel(); } catch (_) {}
            fail(502, 'UPSTREAM_REDIRECT_LIMIT', '公開ファイルのリダイレクト回数が上限を超えました');
        }
        const location = response.headers.get('Location');
        try { await response.body?.cancel(); } catch (_) {}
        if (!location) fail(502, 'UPSTREAM_ERROR', '公開ファイルのリダイレクトが不正です');

        let next;
        try {
            next = new URL(location, current);
        } catch (_) {
            fail(502, 'UPSTREAM_ERROR', '公開ファイルのリダイレクトを解釈できません');
        }
        try {
            assertSafeHttpsUrl(next);
        } catch (_) {
            fail(403, 'REDIRECT_NOT_ALLOWED', '許可されていない取得先へリダイレクトされました');
        }
        if (!isProviderRedirectHost(source.provider, next.hostname.toLowerCase())) {
            fail(403, 'REDIRECT_NOT_ALLOWED', '許可されていない取得先へリダイレクトされました');
        }
        current = next;
    }
}

export async function relayDiskImage({ sourceUrl, expectedType, fetchImpl = fetch }) {
    const source = normalizeSourceUrl(sourceUrl);
    if (expectedType != null && !Object.hasOwn(MEDIA_LIMITS, expectedType)) {
        fail(400, 'INVALID_MEDIA_TYPE', 'メディア種別が正しくありません');
    }

    const abortController = new AbortController();
    let timer = setTimeout(() => abortController.abort(), UPSTREAM_TIMEOUT_MS);
    const clearTimer = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };

    try {
        const { response } = await fetchFollowingRedirects(source, fetchImpl, abortController.signal);
        if (!response.ok) {
            clearTimer();
            try { await response.body?.cancel(); } catch (_) {}
            fail(response.status === 404 ? 404 : 502,
                response.status === 404 ? 'SOURCE_NOT_FOUND' : 'UPSTREAM_ERROR',
                response.status === 404 ? '公開ファイルが見つかりません' : '公開ファイルを取得できませんでした');
        }

        const contentType = response.headers.get('Content-Type') || '';
        if (contentTypeIsDocument(contentType)) {
            const prefix = await readBodyPrefix(response);
            clearTimer();
            if (source.provider === 'google-drive' && looksLikeGoogleConfirmation(prefix)) {
                fail(422, 'GOOGLE_CONFIRMATION_REQUIRED',
                    'このGoogle Driveファイルは直接取得できません。Dropboxを使うか小さいファイルを指定してください');
            }
            fail(415, 'NOT_A_DISK_IMAGE', '共有リンクからディスクイメージを取得できませんでした');
        }

        const upstreamFilename = parseContentDispositionFilename(response.headers.get('Content-Disposition'))
            || source.sourceFilename;
        const filename = sanitizeFilename(upstreamFilename);
        const mediaType = detectMediaType(filename);
        if (!filename || !mediaType) {
            clearTimer();
            try { await response.body?.cancel(); } catch (_) {}
            fail(415, 'NOT_A_DISK_IMAGE', '対応するファイル名・形式を確認できませんでした');
        }
        if (expectedType && expectedType !== mediaType) {
            clearTimer();
            try { await response.body?.cancel(); } catch (_) {}
            fail(415, 'MEDIA_TYPE_MISMATCH', '指定スロットとファイル形式が一致しません');
        }

        const maxBytes = MEDIA_LIMITS[mediaType];
        const lengthHeader = response.headers.get('Content-Length');
        const declaredLength = lengthHeader != null && /^\d+$/.test(lengthHeader)
            ? Number(lengthHeader) : null;
        if (declaredLength != null && declaredLength > maxBytes) {
            clearTimer();
            try { await response.body?.cancel(); } catch (_) {}
            fail(413, 'FILE_TOO_LARGE', 'ファイルが' + Math.round(maxBytes / 1024 / 1024) + 'MiBの上限を超えています');
        }
        if (!response.body) {
            clearTimer();
            fail(502, 'UPSTREAM_ERROR', '公開ファイルの本文がありません');
        }

        const headers = new Headers();
        headers.set('Content-Type', 'application/octet-stream');
        headers.set('Cache-Control', 'private, no-store');
        headers.set('X-Content-Type-Options', 'nosniff');
        headers.set('X-Disk-Provider', source.provider);
        headers.set('X-Disk-Filename', encodeURIComponent(filename));
        const strongEtag = normalizeStrongEtag(response.headers.get('ETag'));
        if (strongEtag) headers.set('X-Disk-ETag', strongEtag);
        headers.set('Content-Disposition', 'attachment; filename="' + asciiFilenameFallback(filename)
            + '"; filename*=UTF-8\'\'' + encode5987(filename));
        if (declaredLength != null) headers.set('Content-Length', String(declaredLength));

        return new Response(makeBoundedBody(response.body, maxBytes, abortController, clearTimer), {
            status: 200,
            headers,
        });
    } catch (error) {
        clearTimer();
        throw error;
    }
}

export async function probeDiskImage({ sourceUrl, strongEtag, fetchImpl = fetch }) {
    const source = normalizeSourceUrl(sourceUrl);
    const storedEtag = normalizeStrongEtag(strongEtag);
    if (!storedEtag) fail(400, 'INVALID_ETAG', '更新確認情報が正しくありません');

    const abortController = new AbortController();
    let timer = setTimeout(() => abortController.abort(), UPSTREAM_TIMEOUT_MS);
    const clearTimer = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };

    try {
        const { response } = await fetchFollowingRedirects(source, fetchImpl, abortController.signal);
        clearTimer();
        const currentEtag = normalizeStrongEtag(response.headers.get('ETag'));
        try { await response.body?.cancel(); } catch (_) {}

        if (!response.ok) {
            fail(response.status === 404 ? 404 : 502,
                response.status === 404 ? 'SOURCE_NOT_FOUND' : 'UPSTREAM_ERROR',
                response.status === 404 ? '公開ファイルが見つかりません' : '公開ファイルを取得できませんでした');
        }
        if (!currentEtag) return probeResponse('unknown');
        return probeResponse(currentEtag === storedEtag ? 'unchanged' : 'changed');
    } catch (error) {
        clearTimer();
        throw error;
    }
}

function expectedTypeFromBody(body) {
    if (body.expectedType == null) return null;
    if (typeof body.expectedType !== 'string' || !Object.hasOwn(MEDIA_LIMITS, body.expectedType)) {
        fail(400, 'INVALID_MEDIA_TYPE', 'メディア種別が正しくありません');
    }
    return body.expectedType;
}

export async function handleRelayRequest({ request, env = {}, fetchImpl = fetch }) {
    try {
        if (request.method !== 'POST') {
            return jsonResponse(405, 'METHOD_NOT_ALLOWED', 'POSTを使用してください', { Allow: 'POST' });
        }
        if (env.DISK_RELAY_ENABLED === 'false') {
            return jsonResponse(503, 'RELAY_DISABLED', '公開URL取得機能は現在停止中です');
        }

        const requestUrl = new URL(request.url);
        if (request.headers.get('Origin') !== requestUrl.origin) {
            return jsonResponse(403, 'ORIGIN_NOT_ALLOWED', '同一サイトからのみ利用できます');
        }
        const contentType = request.headers.get('Content-Type') || '';
        if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
            return jsonResponse(415, 'UNSUPPORTED_MEDIA_TYPE', 'application/jsonを使用してください');
        }
        const declaredRequestLength = request.headers.get('Content-Length');
        if (declaredRequestLength && /^\d+$/.test(declaredRequestLength)
            && Number(declaredRequestLength) > MAX_REQUEST_BYTES) {
            return jsonResponse(413, 'REQUEST_TOO_LARGE', 'リクエストが大きすぎます');
        }

        if (env.DISK_RELAY_RATE_LIMIT && typeof env.DISK_RELAY_RATE_LIMIT.limit === 'function') {
            const key = request.headers.get('CF-Connecting-IP') || 'unknown';
            const limited = await env.DISK_RELAY_RATE_LIMIT.limit({ key });
            if (!limited || limited.success !== true) {
                return jsonResponse(429, 'RATE_LIMITED', 'しばらく待ってから再試行してください');
            }
        }

        const text = await request.text();
        if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
            return jsonResponse(413, 'REQUEST_TOO_LARGE', 'リクエストが大きすぎます');
        }
        let body;
        try {
            body = JSON.parse(text);
        } catch (_) {
            return jsonResponse(400, 'INVALID_JSON', 'JSONを解釈できません');
        }
        if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.url !== 'string') {
            return jsonResponse(400, 'INVALID_REQUEST', '共有URLを指定してください');
        }
        if (body.probe != null && typeof body.probe !== 'boolean') {
            return jsonResponse(400, 'INVALID_REQUEST', 'probeの形式が正しくありません');
        }
        if (body.probe === true) {
            return await probeDiskImage({
                sourceUrl: body.url,
                strongEtag: body.strongEtag,
                fetchImpl,
            });
        }
        return await relayDiskImage({
            sourceUrl: body.url,
            expectedType: expectedTypeFromBody(body),
            fetchImpl,
        });
    } catch (error) {
        return errorResponse(error);
    }
}

export const relayConstants = Object.freeze({
    maxRequestBytes: MAX_REQUEST_BYTES,
    maxRedirects: MAX_REDIRECTS,
    mediaLimits: MEDIA_LIMITS,
    slotTypes: SLOT_TYPES,
});
