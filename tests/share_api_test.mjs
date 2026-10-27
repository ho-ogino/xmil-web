import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';
import { onRequestPost } from '../functions/api/share.js';

// POST /api/share (functions/api/share.js) with an in-memory D1 stand-in and no R2

function fakeDb() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() {
              assert.match(sql, /^INSERT INTO shares/);
              const [id, data] = values;
              if (rows.has(id)) throw new Error('UNIQUE constraint failed');
              rows.set(id, new Uint8Array(data));
            },
          };
        },
      };
    },
  };
}

async function post(body) {
  const db = fakeDb();
  const data = gzipSync(Buffer.from(JSON.stringify(body)));
  const form = new FormData();
  form.append('data', new Blob([data], { type: 'application/octet-stream' }));
  const response = await onRequestPost({ request: new Request('https://x1.example.test/api/share', { method: 'POST', body: form }), env: { X1PEN_DB: db } });
  return { status: response.status, body: await response.json(), db, data };
}

test('a HuBASIC-only share is stored as posted', async () => {
  const payload = { basic: null, asm: null, slang: null, hubasicX1: Buffer.from([0x31, 0x30, 0x20, 0x5C, 0x0D, 0x0A]).toString('base64'),
    meta: { model: 1, runMode: 'x1native', sourceMode: 'hubasic', hubasicOptions: { wait: 'line:450' } } };
  const result = await post(payload);
  assert.equal(result.status, 200);
  assert.match(result.body.id, /^[A-Za-z0-9]{8}$/);
  assert.deepEqual(Buffer.from(result.db.rows.get(result.body.id)), Buffer.from(result.data));
});

test('BASIC, ASM and SLANG shares are still accepted', async () => {
  for (const payload of [{ basic: '10 PRINT 1' }, { basic: '', asm: ' NOP' }, { basic: '', asm: null, slang: 'MAIN() { }' }]) {
    assert.equal((await post(payload)).status, 200, JSON.stringify(payload));
  }
});

test('a share without code, or not an object, is refused', async () => {
  for (const payload of [{ basic: '', asm: null, slang: null }, { hubasicX1: '' }, { hubasicX1: 5 }, { hubasicX1: ['QQ=='] }, null, [], 42, 'basic']) {
    const result = await post(payload);
    assert.equal(result.status, 400, JSON.stringify(payload));
    assert.deepEqual(result.body, { error: 'No code' });
    assert.equal(result.db.rows.size, 0);
  }
});
