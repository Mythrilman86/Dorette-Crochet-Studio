const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../diagnostics.js');

test('diagnostic records are bounded, expire and exclude arbitrary content', () => {
  let raw = null,
    now = 100000000000;
  const storage = {
    getItem() {
      return raw;
    },
    setItem(key, value) {
      raw = value;
    },
    removeItem() {
      raw = null;
    }
  };
  const log = create(
    storage,
    () => now,
    () => ({ version: '2.6.0', platform: 'web', notes: 'private notes', filename: 'private.pdf' })
  );
  for (let i = 0; i < 300; i++) log.record('SAVE_FAILED');
  assert.equal(log.read().length, 200);
  log.record('private.pdf');
  assert.equal(log.read().length, 200);
  assert.ok(Buffer.byteLength(raw) < 128 * 1024);
  assert.doesNotMatch(JSON.stringify(log.report()), /private/);
  now += 31 * 86400000;
  assert.equal(log.read().length, 0);
  log.clear();
  assert.equal(raw, null);
});

test('diagnostics never propagate inaccessible or full storage failures', () => {
  const log = create({
    getItem() {
      throw Error('disabled');
    },
    setItem() {
      throw Error('full');
    },
    removeItem() {
      throw Error('disabled');
    }
  });
  assert.doesNotThrow(() => log.record('SAVE_FAILED'));
  assert.doesNotThrow(() => log.clear());
  assert.deepEqual(log.report(), []);
});
