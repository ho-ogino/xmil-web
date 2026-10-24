import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../html/pre.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`    function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated function: ${name}`);
}

test('clean media hash detection is independent of XmilRemoteMedia load order', () => {
  const context = { URLSearchParams, result: null };
  vm.runInNewContext(`${extractFunction('hasMediaHashParameter')}
    result = [
      hasMediaHashParameter({ hash: '#media=' }),
      hasMediaHashParameter({ hash: '#other=1&media=broken' }),
      hasMediaHashParameter({ hash: '#other=media' }),
    ];`, context);
  assert.deepEqual(Array.from(context.result), [true, true, false]);
  assert.doesNotMatch(extractFunction('hasMediaHashParameter'), /XmilRemoteMedia/);
});

test('remote media intent consumption is disabled for X1Pen documents', () => {
  const fn = extractFunction('shouldConsumeRemoteMediaIntent');
  const run = (x1pen, hasConsumer) => {
    const context = {
      window: {
        __X1PEN_MODE: x1pen,
        XmilRemoteMedia: hasConsumer ? { consumeLaunchRequest() {} } : null,
      },
      result: null,
    };
    vm.runInNewContext(`${fn}; result = shouldConsumeRemoteMediaIntent();`, context);
    return context.result;
  };
  assert.equal(run(false, true), true);
  assert.equal(run(true, true), false);
  assert.equal(run(false, false), false);
});

test('both temporary sentinels and explicit slot flags share ephemeral policy', () => {
  const context = {
    slotState: { drive0: '__x1pen_temp__', emm0: '__remote_temp_emm__', hdd0: 'lib_hdd' },
    slotEphemeral: { drive0: true, emm0: true, hdd0: false, drive1: true },
    result: null,
  };
  vm.runInNewContext(`${extractFunction('isEphemeralKey')}
    ${extractFunction('isEphemeralSlot')}
    result = [
      isEphemeralSlot('drive0'),
      isEphemeralSlot('emm0'),
      isEphemeralSlot('hdd0'),
      isEphemeralSlot('drive1'),
      isEphemeralKey('lib_hdd'),
    ];`, context);
  assert.deepEqual(Array.from(context.result), [true, true, false, true, false]);
});

test('temporary sentinels are excluded from persistent state snapshots', () => {
  const context = {
    slotState: { drive0: '__x1pen_temp__', emm0: '__remote_temp_emm__', hdd0: 'lib_hdd' },
    slotEphemeral: { drive0: true, emm0: true, hdd0: false },
    result: null,
  };
  vm.runInNewContext(`${extractFunction('isEphemeralKey')}
    ${extractFunction('isEphemeralSlot')}
    ${extractFunction('persistentMountSnapshot')}
    result = persistentMountSnapshot();`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.result)), {
    drive0: null,
    emm0: null,
    hdd0: 'lib_hdd',
  });
});
