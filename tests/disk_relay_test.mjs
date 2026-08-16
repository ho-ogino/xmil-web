import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RelayError,
  detectMediaType,
  handleRelayRequest,
  normalizeSourceUrl,
  normalizeStrongEtag,
  parseContentDispositionFilename,
  relayDiskImage,
  probeDiskImage,
  sanitizeFilename,
} from '../functions/_lib/disk-relay.js';

const googleUrl = 'https://drive.google.com/file/d/AbCdEfGhIjKlMnOpQrStUv/view?usp=sharing&resourcekey=0-Ab_cd-Ef';
const dropboxUrl = 'https://www.dropbox.com/scl/fi/AbCdEf123456/%E6%97%A5%E6%9C%AC%E8%AA%9E.D88?rlkey=Key_123&dl=0&junk=1';

function relayRequest(body, headers = {}) {
  return new Request('https://xmil.example/api/disk-relay', {
    method: 'POST',
    headers: { Origin: 'https://xmil.example', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function binaryResponse(bytes, filename = 'DISK.D88', extraHeaders = {}) {
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
      ...extraHeaders,
    },
  });
}

test('provider URLs normalize to direct downloads and retain only required keys', () => {
  const google = normalizeSourceUrl(googleUrl);
  assert.equal(google.provider, 'google-drive');
  assert.equal(google.target.origin, 'https://drive.usercontent.google.com');
  assert.equal(google.target.searchParams.get('id'), 'AbCdEfGhIjKlMnOpQrStUv');
  assert.equal(google.target.searchParams.get('export'), 'download');
  assert.equal(google.target.searchParams.get('confirm'), 't');
  assert.equal(google.target.searchParams.get('resourcekey'), '0-Ab_cd-Ef');
  assert.equal(google.target.searchParams.has('usp'), false);

  const dropbox = normalizeSourceUrl(dropboxUrl);
  assert.equal(dropbox.provider, 'dropbox');
  assert.equal(dropbox.target.hostname, 'dl.dropboxusercontent.com');
  assert.equal(dropbox.target.searchParams.get('rlkey'), 'Key_123');
  assert.equal(dropbox.target.searchParams.get('dl'), '1');
  assert.equal(dropbox.target.searchParams.has('junk'), false);
  assert.equal(dropbox.sourceFilename, '日本語.D88');
});

test('URL parser rejects open proxy and malformed input cases', () => {
  const invalid = [
    'http://drive.google.com/file/d/AbCdEfGhIjKlMnOpQrStUv/view',
    'https://user:pass@drive.google.com/file/d/AbCdEfGhIjKlMnOpQrStUv/view',
    'https://drive.google.com:444/file/d/AbCdEfGhIjKlMnOpQrStUv/view',
    'https://drive.google.com/evil/d/AbCdEfGhIjKlMnOpQrStUv/view',
    'https://drive.google.com.evil.example/file/d/AbCdEfGhIjKlMnOpQrStUv/view',
    'https://www.dropbox.com/home/DISK.D88',
    'https://127.0.0.1/DISK.D88',
  ];
  for (const value of invalid) {
    assert.throws(() => normalizeSourceUrl(value), RelayError, value);
  }
});

test('filename parsing, sanitizing, and media detection preserve safe Unicode extensions', () => {
  assert.equal(parseContentDispositionFilename("attachment; filename*=UTF-8''%E6%97%A5%E6%9C%AC%E8%AA%9E.D88"), '日本語.D88');
  assert.equal(parseContentDispositionFilename('attachment; filename="disk\\\"name.d88"'), 'disk"name.d88');
  assert.equal(sanitizeFilename('<img src=x onerror=alert(1)>.d88'), '_img src=x onerror=alert(1)_.d88');
  assert.equal(sanitizeFilename('../bad\r\nname.d88'), '.._bad__name.d88');
  assert.equal(detectMediaType('日本語😀.D88'), 'fdd');
  assert.equal(detectMediaType('EMM9.MEM'), 'emm');
  assert.equal(detectMediaType('archive.zip'), null);
});

test('successful relay emits no-store headers and round-trips a Unicode filename', async () => {
  const fetchImpl = async () => binaryResponse(new Uint8Array([1, 2, 3]), 'fallback.d88', {
    'Content-Disposition': "attachment; filename=ascii.d88; filename*=UTF-8''%E6%97%A5%E6%9C%AC%E8%AA%9E%F0%9F%98%80.D88",
  });
  const response = await handleRelayRequest({ request: relayRequest({ url: googleUrl, expectedType: 'fdd' }), fetchImpl });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(decodeURIComponent(response.headers.get('X-Disk-Filename')), '日本語😀.D88');
  assert.match(response.headers.get('Content-Disposition'), /filename="_+\.D88"/);
  assert.match(response.headers.get('Content-Disposition'), /filename\*=UTF-8''/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
});

test('download exposes only safe strong ETags', async () => {
  assert.equal(normalizeStrongEtag('"stable-123"'), '"stable-123"');
  assert.equal(normalizeStrongEtag('W/"weak"'), null);
  assert.equal(normalizeStrongEtag('"bad\nvalue"'), null);

  const strong = await relayDiskImage({
    sourceUrl: googleUrl,
    fetchImpl: async () => binaryResponse(new Uint8Array([1]), 'DISK.D88', { ETag: '"stable-123"' }),
  });
  assert.equal(strong.headers.get('X-Disk-ETag'), '"stable-123"');
  await strong.body.cancel();

  const weak = await relayDiskImage({
    sourceUrl: googleUrl,
    fetchImpl: async () => binaryResponse(new Uint8Array([1]), 'DISK.D88', { ETag: 'W/"weak"' }),
  });
  assert.equal(weak.headers.get('X-Disk-ETag'), null);
  await weak.body.cancel();
});

test('header-only probe reports unchanged, changed, or unknown and cancels content', async () => {
  for (const [etag, expected] of [['"v1"', 'unchanged'], ['"v2"', 'changed'], [null, 'unknown']]) {
    let cancelled = false;
    const response = await probeDiskImage({
      sourceUrl: googleUrl,
      strongEtag: '"v1"',
      fetchImpl: async () => new Response(new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); },
        cancel() { cancelled = true; },
      }), { headers: etag ? { ETag: etag } : {} }),
    });
    assert.deepEqual(await response.json(), { state: expected });
    assert.equal(cancelled, true);
  }
});

test('HTTP probe validates its contract and never echoes the source', async () => {
  const response = await handleRelayRequest({
    request: relayRequest({ url: googleUrl, probe: true, strongEtag: '"v1"' }),
    fetchImpl: async () => binaryResponse(new Uint8Array([9]), 'DISK.D88', { ETag: '"v1"' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { state: 'unchanged' });

  const invalid = await handleRelayRequest({ request: relayRequest({ url: googleUrl, probe: true, strongEtag: 'W/"v1"' }) });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, 'INVALID_ETAG');
});

test('redirects are checked at every hop and cannot cross providers', async () => {
  const allowedCalls = [];
  const allowedFetch = async (url) => {
    allowedCalls.push(url);
    if (allowedCalls.length === 1) {
      return new Response(null, { status: 302, headers: { Location: 'https://download.googleusercontent.com/file' } });
    }
    return binaryResponse(new Uint8Array([4]), 'DISK.D88');
  };
  const ok = await relayDiskImage({ sourceUrl: googleUrl, fetchImpl: allowedFetch });
  assert.equal(ok.status, 200);
  assert.equal((await ok.arrayBuffer()).byteLength, 1);

  const denied = await handleRelayRequest({
    request: relayRequest({ url: googleUrl }),
    fetchImpl: async () => new Response(null, {
      status: 302,
      headers: { Location: 'https://dl.dropboxusercontent.com/scl/fi/id/DISK.D88' },
    }),
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error, 'REDIRECT_NOT_ALLOWED');
});

test('known and streamed size limits reject oversized FDD responses', async () => {
  const known = await handleRelayRequest({
    request: relayRequest({ url: dropboxUrl, expectedType: 'fdd' }),
    fetchImpl: async () => binaryResponse(new Uint8Array([1]), 'DISK.D88', {
      'Content-Length': String(32 * 1024 * 1024 + 1),
    }),
  });
  assert.equal(known.status, 413);
  assert.equal((await known.json()).error, 'FILE_TOO_LARGE');

  const chunkSize = 16 * 1024 * 1024;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(chunkSize));
      controller.enqueue(new Uint8Array(chunkSize));
      controller.enqueue(new Uint8Array([1]));
      controller.close();
    },
  });
  const streamed = await relayDiskImage({
    sourceUrl: dropboxUrl,
    expectedType: 'fdd',
    fetchImpl: async () => new Response(body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="DISK.D88"',
      },
    }),
  });
  await assert.rejects(() => streamed.arrayBuffer(), /FILE_TOO_LARGE|terminated|size|上限/i);
});

test('Google confirmation HTML has a dedicated error and generic documents do not pass', async () => {
  const confirmation = await handleRelayRequest({
    request: relayRequest({ url: googleUrl }),
    fetchImpl: async () => new Response('<form id="download-form">Google Drive can\'t scan this file for viruses</form>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }),
  });
  assert.equal(confirmation.status, 422);
  assert.equal((await confirmation.json()).error, 'GOOGLE_CONFIRMATION_REQUIRED');

  const generic = await handleRelayRequest({
    request: relayRequest({ url: dropboxUrl }),
    fetchImpl: async () => new Response('<html>sign in</html>', { headers: { 'Content-Type': 'text/html' } }),
  });
  assert.equal(generic.status, 415);
  assert.equal((await generic.json()).error, 'NOT_A_DISK_IMAGE');
});

test('HTTP boundary enforces method, origin, JSON, kill switch, and optional rate limit', async () => {
  const getResponse = await handleRelayRequest({
    request: new Request('https://xmil.example/api/disk-relay'),
  });
  assert.equal(getResponse.status, 405);
  assert.equal(getResponse.headers.get('Allow'), 'POST');

  const wrongOrigin = await handleRelayRequest({
    request: relayRequest({ url: googleUrl }, { Origin: 'https://evil.example' }),
  });
  assert.equal(wrongOrigin.status, 403);

  const wrongType = await handleRelayRequest({
    request: new Request('https://xmil.example/api/disk-relay', {
      method: 'POST', headers: { Origin: 'https://xmil.example', 'Content-Type': 'text/plain' }, body: '{}',
    }),
  });
  assert.equal(wrongType.status, 415);

  const disabled = await handleRelayRequest({
    request: relayRequest({ url: googleUrl }), env: { DISK_RELAY_ENABLED: 'false' },
  });
  assert.equal(disabled.status, 503);
  assert.equal((await disabled.json()).error, 'RELAY_DISABLED');

  const limited = await handleRelayRequest({
    request: relayRequest({ url: googleUrl }),
    env: { DISK_RELAY_RATE_LIMIT: { limit: async () => ({ success: false }) } },
  });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error, 'RATE_LIMITED');
});

test('errors never echo source URLs or bearer-like keys', async () => {
  const response = await handleRelayRequest({
    request: relayRequest({ url: googleUrl }),
    fetchImpl: async () => { throw new Error('failed ' + googleUrl); },
  });
  const body = await response.text();
  assert.equal(response.status, 502);
  assert.doesNotMatch(body, /AbCdEfGhIjKlMnOpQrStUv|resourcekey|0-Ab_cd-Ef|drive\.google\.com/);
});
