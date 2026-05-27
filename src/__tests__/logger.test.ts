import './test-setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatLogArg, maskSecrets } from '../logger.js';

describe('maskSecrets', () => {
  it('masks supported secret patterns', () => {
    const cases = [
      ['token=secret123456789', 'secret123456789'],
      ['secret=my-secret-value', 'my-secret-value'],
      ['password=hunter2abc', 'hunter2abc'],
      ['api_key=sk-abcdef123456', 'sk-abcdef123456'],
      ['Using bot token bot1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ12345678a', 'bot1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ12345678a'],
      ['Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test.signature', 'Bearer eyJhbGciOiJIUzI1NiJ9.test.signature'],
      ['token="my-secret-token"', 'my-secret-token'],
    ];

    for (const [input, leaked] of cases) {
      const result = maskSecrets(input);
      assert.notEqual(result, input);
      assert.ok(!result.includes(leaked), `${leaked} should be masked`);
    }
  });

  it('leaves normal text unchanged', () => {
    const input = 'Starting bridge on port 8080';
    assert.equal(maskSecrets(input), input);
  });

  it('preserves last 4 chars of masked values', () => {
    const input = 'token=abcdefghijklmnop';
    const result = maskSecrets(input);
    assert.ok(result.includes('mnop'));
  });
});

describe('formatLogArg', () => {
  it('serializes Error objects with their message', () => {
    const formatted = formatLogArg(new Error('boom'));
    assert.match(formatted, /boom/);
    assert.match(formatted, /Error/);
  });

  it('falls back to inspect for circular objects', () => {
    const value: { self?: unknown; ok: boolean } = { ok: true };
    value.self = value;
    const formatted = formatLogArg(value);
    assert.match(formatted, /ok/);
    assert.match(formatted, /Circular/i);
  });
});
