// Tests for the upstream-aware 429 backoff/retry layer in the MiniMax client.
// Covers the 5 cases from t_22a34f6d design §6 (minimax client row).
//
// Backoff schedule under test (default retryOpts):
//   attempt 0: original call
//   attempt 1: sleep 1000ms, retry
//   attempt 2: sleep 2000ms, retry
//   attempt 3: sleep 4000ms, retry
//   cap:        max 3 retries (4 total attempts), max 15s of backoff
//
// Strategy: avoid node:test mock.timers (timing API differs across Node
// releases). Instead drive the retry layer with `retryOpts: { baseMs: 1,
// capMs: 1 }` so the real setTimeout sleeps for sub-millisecond durations.
// The unit test of parseRetryAfterHeader() still asserts the cap behaviour
// directly so we don't lose the 60s-capped-at-10s assertion.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeMinimaxClient,
  withRateLimitRetry,
  parseRetryAfterHeader,
} from '../../../backend/heavy-think/src/clients/minimax.js';

// Stub Response with just what generateOnce() touches.
function fakeResponse({ status, body = '', headers = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: status === 429 ? 'Too Many Requests' : 'Internal Server Error',
    headers: { get: (k) => (headers[k.toLowerCase()] != null ? headers[k.toLowerCase()] : null) },
    text: async () => body,
    json: async () => ({ content: [{ type: 'text', text: 'stub response' }], usage: { input_tokens: 1, output_tokens: 2 } }),
  };
}

// Capture every fetchImpl call so tests can count attempts and assert
// on the request bodies. Returns the fetch stub + a recorder object.
function makeFetchStub(responses) {
  const calls = [];
  let i = 0;
  const stub = async (url, init) => {
    calls.push({ url, init });
    if (i >= responses.length) {
      // After exhausting planned responses, keep returning the last one
      // (most tests want to assert on attempt count).
      return responses[responses.length - 1];
    }
    return responses[i++];
  };
  return { stub, calls };
}

const TEST_API_KEY = '***';

test('Case 1: generate() returns {reasoning, cost_usd, __retriedAttempts: 2} after two 429s then 200', async () => {
  // Compress backoff to 1ms so the test runs in ~3ms instead of 3s.
  const { stub, calls } = makeFetchStub([
    fakeResponse({ status: 429, body: '{"error":"rate limited"}' }),
    fakeResponse({ status: 429, body: '{"error":"rate limited"}' }),
    fakeResponse({ status: 200 }),
  ]);
  const client = makeMinimaxClient({ apiKey: TEST_API_KEY, _fetch: stub });
  const result = await client.generate('hello', {
    retryOpts: { maxRetries: 3, baseMs: 1, capMs: 1 },
  });

  assert.equal(calls.length, 3, 'two 429s + one 200');
  assert.equal(result.reasoning, 'stub response');
  assert.equal(typeof result.cost_usd, 'number');
  assert.equal(result.__retriedAttempts, 2, '__retriedAttempts reflects recovered retry count');
});

test('Case 2: 429 with Retry-After: 2 honours the header (capped at capMs)', async () => {
  // We don't measure exact ms — we verify that the retry happened at all
  // and that the Retry-After path is exercised. The cap is unit-tested
  // separately via parseRetryAfterHeader.
  const { stub, calls } = makeFetchStub([
    fakeResponse({ status: 429, body: '{}', headers: { 'retry-after': '2' } }),
    fakeResponse({ status: 200 }),
  ]);
  const client = makeMinimaxClient({ apiKey: TEST_API_KEY, _fetch: stub });
  const result = await client.generate('hello', {
    retryOpts: { maxRetries: 3, baseMs: 100_000, capMs: 1 },  // huge base → header must win
  });

  assert.equal(calls.length, 2, 'one retry after Retry-After honoured');
  assert.equal(result.__retriedAttempts, 1);
});

test('Case 3: cap is enforced — Retry-After of 60s returns at most 10000ms (parseRetryAfterHeader unit)', () => {
  const r = fakeResponse({ status: 429, headers: { 'retry-after': '60' } });
  assert.equal(parseRetryAfterHeader(r, 10_000), 10_000, '60s clamped to 10s');
  const r5 = fakeResponse({ status: 429, headers: { 'retry-after': '5' } });
  assert.equal(parseRetryAfterHeader(r5, 10_000), 5_000, '5s unchanged');

  // Integration: capMs=1 should clamp any Retry-After down to 1ms. We
  // assert at the unit layer above; below we just prove the wrapper
  // doesn't blow up under capped headers.
  const r60 = fakeResponse({ status: 429, headers: { 'retry-after': '60' } });
  assert.equal(parseRetryAfterHeader(r60, 1), 1, '60s clamped all the way to 1ms');
});

test('Case 4: persistent 429 throws upstream_rate_limited after exactly 4 attempts', async () => {
  const { stub, calls } = makeFetchStub([
    fakeResponse({ status: 429, body: 'rate-limited-1' }),
    fakeResponse({ status: 429, body: 'rate-limited-2' }),
    fakeResponse({ status: 429, body: 'rate-limited-3' }),
    fakeResponse({ status: 429, body: 'rate-limited-4' }),
  ]);
  const client = makeMinimaxClient({ apiKey: TEST_API_KEY, _fetch: stub });
  await assert.rejects(
    client.generate('hello', { retryOpts: { maxRetries: 3, baseMs: 1, capMs: 1 } }),
    (err) => {
      assert.equal(err.code, 'upstream_rate_limited', 'structured code');
      assert.equal(err.statusCode, 429);
      return true;
    },
  );
  assert.equal(calls.length, 4, 'exactly 4 total attempts (1 original + 3 retries)');
});

test('Case 5: 500 does NOT retry — single call, plain Error (no code)', async () => {
  const { stub, calls } = makeFetchStub([
    fakeResponse({ status: 500, body: 'server kaboom' }),
  ]);
  const client = makeMinimaxClient({ apiKey: TEST_API_KEY, _fetch: stub });
  await assert.rejects(
    client.generate('hello', { retryOpts: { maxRetries: 3, baseMs: 1, capMs: 1 } }),
    (err) => {
      assert.equal(err.code, undefined, 'no code field on plain Error');
      assert.match(err.message, /500/);
      return true;
    },
  );
  assert.equal(calls.length, 1, 'no retry on non-429');
});

test('withRateLimitRetry: helper-level — 429 with compressed retryOpts', async () => {
  // Sanity: the helper exposes the override surface called out in design
  // §3.4.1 — operators can tune at the call site via opts.retryOpts.
  let attempts = 0;
  const result = await withRateLimitRetry(
    async () => {
      attempts += 1;
      if (attempts < 2) {
        const err = new Error('rate limited');
        err.code = 'upstream_rate_limited';
        err.statusCode = 429;
        throw err;
      }
      return { reasoning: 'ok', cost_usd: 0.001 };
    },
    { maxRetries: 1, baseMs: 1, capMs: 5 },
  );
  assert.equal(result.reasoning, 'ok');
  assert.equal(result.__retriedAttempts, 1);
  assert.equal(attempts, 2);
});

test('withRateLimitRetry: bubbles non-429 errors without retry', async () => {
  let attempts = 0;
  await assert.rejects(
    withRateLimitRetry(
      async () => {
        attempts += 1;
        throw new Error('plain 500');
      },
      { maxRetries: 3, baseMs: 1, capMs: 1 },
    ),
    (err) => {
      assert.equal(err.code, undefined, 'plain Error code unchanged');
      assert.match(err.message, /plain 500/);
      return true;
    },
  );
  assert.equal(attempts, 1, 'no retry on non-429');
});

test('parseRetryAfterHeader: missing header → null, integer → ms, capped, HTTP-date → null', () => {
  // null header
  assert.equal(parseRetryAfterHeader(fakeResponse({ status: 429 }), 10_000), null);
  // integer delta-seconds → ms (capped)
  const r2 = fakeResponse({ status: 429, headers: { 'retry-after': '2' } });
  assert.equal(parseRetryAfterHeader(r2, 10_000), 2_000);
  // 60s capped to 10s
  const r3 = fakeResponse({ status: 429, headers: { 'retry-after': '60' } });
  assert.equal(parseRetryAfterHeader(r3, 10_000), 10_000);
  // float-string delta-seconds → ceil to ms (1.5s → 1500ms)
  const r4 = fakeResponse({ status: 429, headers: { 'retry-after': '1.5' } });
  assert.equal(parseRetryAfterHeader(r4, 10_000), 1_500);
  // HTTP-date form → null (we don't parse dates; exponential fallback wins)
  const r5 = fakeResponse({ status: 429, headers: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' } });
  assert.equal(parseRetryAfterHeader(r5, 10_000), null);
  // Non-RFC garbage → null
  const r6 = fakeResponse({ status: 429, headers: { 'retry-after': 'soonish' } });
  assert.equal(parseRetryAfterHeader(r6, 10_000), null);
});
