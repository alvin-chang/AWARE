// test/unit/minimax-client-temperature.test.js — Temperature resolution
// Per ADR-038: PRM judge must be deterministic (temperature=0) for ranking to
// be reproducible. K-parallel reasoning attempts should stay diverse (no
// temperature in body, API default = 1.0).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMinimaxClient } from '../../src/clients/minimax.js';

const DUMMY_KEY = 'dummy-key-for-test-only';

function makeStubFetch() {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        content: [{ type: 'text', text: 'stub response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
      text: async () => 'ok',
    };
  };
  return Object.assign(fn, { calls });
}

test('PRM scoring (phase=prm_score) sets temperature=0', async () => {
  const stub = makeStubFetch();
  const client = makeMinimaxClient({ apiKey: DUMMY_KEY, _fetch: stub });
  await client.generate('test prompt', { phase: 'prm_score' });
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0].body.temperature, 0, 'PRM judge must use temperature=0');
});

test('PRM scoring with task_type and phase sets temperature=0', async () => {
  const stub = makeStubFetch();
  const client = makeMinimaxClient({ apiKey: DUMMY_KEY, _fetch: stub });
  await client.generate('test prompt', { task_type: 'reasoning', phase: 'prm_score' });
  assert.equal(stub.calls[0].body.temperature, 0);
});

test('caller opts.temperature overrides PRM phase default', async () => {
  const stub = makeStubFetch();
  const client = makeMinimaxClient({ apiKey: DUMMY_KEY, _fetch: stub });
  await client.generate('test prompt', { phase: 'prm_score', temperature: 0.7 });
  assert.equal(stub.calls[0].body.temperature, 0.7, 'explicit temperature must win');
});

test('reasoning attempts (no phase) have NO temperature in body (API default for diversity)', async () => {
  const stub = makeStubFetch();
  const client = makeMinimaxClient({ apiKey: DUMMY_KEY, _fetch: stub });
  await client.generate('test prompt', { task_type: 'reasoning' });
  assert.equal(
    Object.prototype.hasOwnProperty.call(stub.calls[0].body, 'temperature'),
    false,
    'K-parallel reasoning must NOT pin temperature (let API default = 1.0 = diversity)'
  );
});

test('undefined opts behaves like no-phase (API default)', async () => {
  const stub = makeStubFetch();
  const client = makeMinimaxClient({ apiKey: DUMMY_KEY, _fetch: stub });
  await client.generate('test prompt');
  assert.equal(
    Object.prototype.hasOwnProperty.call(stub.calls[0].body, 'temperature'),
    false
  );
});

test('explicit opts.temperature=0 is honored for non-PRM callers', async () => {
  const stub = makeStubFetch();
  const client = makeMinimaxClient({ apiKey: DUMMY_KEY, _fetch: stub });
  await client.generate('test prompt', { task_type: 'standard', temperature: 0 });
  assert.equal(stub.calls[0].body.temperature, 0);
});

test('explicit opts.temperature=null is treated as "use API default" (skipped)', async () => {
  const stub = makeStubFetch();
  const client = makeMinimaxClient({ apiKey: DUMMY_KEY, _fetch: stub });
  // null is the documented "unset" sentinel — caller explicitly says "don't pin"
  await client.generate('test prompt', { temperature: null });
  assert.equal(
    Object.prototype.hasOwnProperty.call(stub.calls[0].body, 'temperature'),
    false,
    'temperature=null should skip pinning (treat as default)'
  );
});
