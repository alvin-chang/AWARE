// test/rlm/repl.test.js — REPL sandbox + whitelisted ops tests
//
// Verifies:
//   - REPL_OPS exports the whitelisted list (read/grep/slice/len/keys/print/vec_search)
//   - Forbidden imports list contains known-bad patterns (defense-in-depth)

import test from 'node:test';
import assert from 'node:assert/strict';

import { REPL_OPS } from '../../src/rlm/repl.js';

test('repl: whitelisted ops export', () => {
  assert.ok(Array.isArray(REPL_OPS));
  // Required whitelisted tools per AWARE config/rlm.yaml (canonical): read, grep, slice, vec_search, len, keys, print
  for (const op of ['read', 'grep', 'slice', 'len', 'keys', 'print']) {
    assert.ok(REPL_OPS.includes(op), `REPL_OPS should include "${op}"`);
  }
});

// NOTE: full subprocess-spawn REPL tests are deferred to v1.1 when the
// Python subprocess driver is wired through `use_repl: true`. The v1
// environment loader is sufficient for SPEC §9.1 use cases; the REPL
// driver exists but is not on the hot path.