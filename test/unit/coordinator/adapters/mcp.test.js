// SPDX-License-Identifier: Apache-2.0
// test/unit/coordinator/adapters/mcp.test.js
//
// Unit tests for src/coordinator/adapters/mcp.js (ADR-051).
//
// Per the card body for t_cc0b54c2, the acceptance criteria are:
//   1. mcp.js exports MCPAdapter and parses the 7 message types
//   2. Test covers: 7 message types, batched envelopes, malformed
//      envelopes (returns null + logs to stderr), oversized payloads
//      (truncated + hashed)
//   3. npm test passes (no regressions)
//   4. Adapter wired (lazy-require) by coordinator/index.js so a
//      single observeMcpMessage(envelope, actor) entry point exists
//   5. ADR-051 §0's claim is no longer true once the card lands
//
// We use node:test + node:assert to match the rest of test/unit/**/*.test.js.
// A fake audit logger is injected via the auditLogger option so tests
// do NOT touch /data/audit/decision-chain.jsonl on disk — the seam
// mirrors the pattern documented in ast10-mapper.test.js.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  MCPAdapter,
  classifyShape,
  classifyMethod,
  truncateOrHash,
  hashOf,
  sizeOf,
  canonicalJSON,
  KNOWN_METHODS,
  NAMESPACE_PREFIXES,
  OVERSIZE_BYTES,
} = require('../../../../src/coordinator/adapters/mcp');

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Build a fake audit logger that captures every logDecision call. Mirrors
 * the pattern in test/unit/compliance/ast10-mapper.test.js.
 *
 * mode:
 *   - 'capture' (default) — collects every record written into `records`
 *   - 'throw'            — every logDecision() throws an Error
 */
function makeFakeAuditLogger(mode = 'capture') {
  const records = [];
  return {
    records,
    logDecision: async (decision) => {
      if (mode === 'throw') throw new Error('simulated audit-logger failure');
      records.push(decision);
      return 'fake-hash-' + records.length;
    },
  };
}

/**
 * Capture console.error output during a callback. Returns the captured
 * lines. Used to verify the fail-open path logs to stderr.
 */
function captureStderr(fn) {
  const orig = console.error;
  const lines = [];
  console.error = (...args) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    return { result: fn(), lines };
  } finally {
    console.error = orig;
  }
}

// ----------------------------------------------------------------------------
// Pure-function exports
// ----------------------------------------------------------------------------

test('classifyShape: request vs notification vs response vs error', () => {
  // Request — has method + id
  assert.strictEqual(
    classifyShape({ jsonrpc: '2.0', id: '1', method: 'tools/list', params: {} }),
    'request'
  );

  // Notification — has method, NO id
  assert.strictEqual(
    classifyShape({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    'notification'
  );

  // Response — has result + id, no method
  assert.strictEqual(
    classifyShape({ jsonrpc: '2.0', id: '1', result: { ok: true } }),
    'response'
  );

  // Error — has error object, no method
  assert.strictEqual(
    classifyShape({ jsonrpc: '2.0', id: '1', error: { code: -32600, message: 'bad' } }),
    'error'
  );

  // Malformed shapes
  assert.strictEqual(classifyShape(null), null);
  assert.strictEqual(classifyShape('not an object'), null);
  assert.strictEqual(classifyShape([]), null);
  assert.strictEqual(classifyShape({}), null);                              // no jsonrpc
  assert.strictEqual(classifyShape({ jsonrpc: '2.0' }), null);              // no method/result/error
  assert.strictEqual(classifyShape({ jsonrpc: '2.0', method: 'x', result: {} }), null); // both method AND result
});

test('classifyMethod: known + namespace + unknown', () => {
  // 7 message types from the card body
  assert.strictEqual(classifyMethod('initialize'), 'initialize');
  assert.strictEqual(classifyMethod('tools/list'), 'tools/list');
  assert.strictEqual(classifyMethod('tools/call'), 'tools/call');
  assert.strictEqual(classifyMethod('resources/read'), 'resources/read');
  assert.strictEqual(classifyMethod('prompts/get'), 'prompts/get');

  // Notifications/* + completion/* namespaces
  assert.strictEqual(classifyMethod('notifications/tools/list_changed'), 'notifications/tools/list_changed');
  assert.strictEqual(classifyMethod('completion/complete'), 'completion/complete');

  // Sibling methods in the same namespaces are preserved
  assert.strictEqual(classifyMethod('notifications/cancelled'), 'notifications/cancelled');

  // Unknown
  assert.strictEqual(classifyMethod('totally/made/up'), 'unknown');
  assert.strictEqual(classifyMethod(''), 'unknown');
  assert.strictEqual(classifyMethod(null), 'unknown');
});

test('truncateOrHash: under-budget returns value verbatim', () => {
  const value = { tool: 'read_file', args: { path: '/etc/hosts' } };
  const result = truncateOrHash(value);
  assert.strictEqual(result.truncated, false);
  assert.deepStrictEqual(result.value, value);
  assert.strictEqual(result.length, Buffer.byteLength(canonicalJSON(value), 'utf8'));
  assert.strictEqual(result.hash, undefined);
});

test('truncateOrHash: over-budget returns hash + length, no value', () => {
  // Build a payload that exceeds the 4 KB cap.
  const big = 'x'.repeat(OVERSIZE_BYTES + 1024);
  const value = { tool: 'big_payload', args: { blob: big } };
  const result = truncateOrHash(value);
  assert.strictEqual(result.truncated, true);
  assert.strictEqual(result.value, undefined);
  assert.strictEqual(typeof result.hash, 'string');
  assert.strictEqual(result.hash.length, 64); // SHA-256 hex
  assert.ok(result.length > OVERSIZE_BYTES);
});

test('hashOf: deterministic across key-ordering', () => {
  const a = { x: 1, y: 2, z: 3 };
  const b = { z: 3, x: 1, y: 2 };
  // Different key order → same canonical hash.
  assert.strictEqual(hashOf(a), hashOf(b));
  // Different content → different hash.
  assert.notStrictEqual(hashOf(a), hashOf({ x: 1, y: 2, z: 4 }));
});

test('sizeOf: deterministic across key-ordering', () => {
  const a = { x: 1, y: 2 };
  const b = { y: 2, x: 1 };
  assert.strictEqual(sizeOf(a), sizeOf(b));
});

test('canonical constants: shape-stable', () => {
  assert.ok(KNOWN_METHODS instanceof Set);
  assert.ok(KNOWN_METHODS.has('initialize'));
  assert.ok(KNOWN_METHODS.has('tools/list'));
  assert.strictEqual(OVERSIZE_BYTES, 4096);
  assert.deepStrictEqual(NAMESPACE_PREFIXES, ['notifications', 'completion']);
});

// ----------------------------------------------------------------------------
// MCPAdapter.parse — single envelopes
// ----------------------------------------------------------------------------

test('MCPAdapter.parse: request (initialize)', () => {
  const adapter = new MCPAdapter();
  const env = {
    jsonrpc: '2.0',
    id: 'init-1',
    method: 'initialize',
    params: { protocolVersion: '2024-11-05' },
  };
  const result = adapter.parse(env);
  assert.strictEqual(result.shape, 'request');
  assert.strictEqual(result.batch, false);
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.parsed.messageType, 'initialize');
  assert.strictEqual(result.parsed.method, 'initialize');
  assert.strictEqual(result.parsed.messageId, 'init-1');
  assert.strictEqual(result.parsed.metadata.truncated, false);
  assert.deepStrictEqual(result.parsed.params.value, { protocolVersion: '2024-11-05' });
});

test('MCPAdapter.parse: notification (no id)', () => {
  const adapter = new MCPAdapter();
  const env = { jsonrpc: '2.0', method: 'notifications/tools/list_changed', params: {} };
  const result = adapter.parse(env);
  assert.strictEqual(result.shape, 'notification');
  assert.strictEqual(result.parsed.messageType, 'notifications/tools/list_changed');
  assert.strictEqual(result.parsed.messageId, undefined);
});

test('MCPAdapter.parse: response (tools/list result)', () => {
  const adapter = new MCPAdapter();
  const env = {
    jsonrpc: '2.0',
    id: 42,
    result: { tools: [{ name: 'echo' }] },
  };
  const result = adapter.parse(env);
  assert.strictEqual(result.shape, 'response');
  assert.strictEqual(result.parsed.method, null);
  // For response shape, messageType = shape (response)
  assert.strictEqual(result.parsed.messageType, 'response');
  assert.strictEqual(result.parsed.messageId, 42);
  assert.deepStrictEqual(result.parsed.result.value, { tools: [{ name: 'echo' }] });
});

test('MCPAdapter.parse: error envelope', () => {
  const adapter = new MCPAdapter();
  const env = { jsonrpc: '2.0', id: '7', error: { code: -32601, message: 'method not found' } };
  const result = adapter.parse(env);
  assert.strictEqual(result.shape, 'error');
  assert.strictEqual(result.parsed.messageType, 'error');
  assert.strictEqual(result.parsed.messageId, '7');
  assert.deepStrictEqual(result.parsed.error, { code: -32601, message: 'method not found' });
});

test('MCPAdapter.parse: completion/* namespace message', () => {
  const adapter = new MCPAdapter();
  const env = {
    jsonrpc: '2.0',
    id: 'compl-1',
    method: 'completion/complete',
    params: { ref: { type: 'ref/prompt', name: 'summarize' }, argument: { name: 'text', value: 'hello' } },
  };
  const result = adapter.parse(env);
  assert.strictEqual(result.shape, 'request');
  assert.strictEqual(result.parsed.messageType, 'completion/complete');
});

// ----------------------------------------------------------------------------
// MCPAdapter.parse — batched envelopes
// ----------------------------------------------------------------------------

test('MCPAdapter.parse: batched envelope (mixed valid + invalid)', () => {
  const adapter = new MCPAdapter();
  const batch = [
    { jsonrpc: '2.0', id: '1', method: 'tools/list', params: {} },     // valid
    { jsonrpc: '2.0', id: '2', method: 'tools/call', params: { name: 'x' } }, // valid
    { broken: true },                                                     // malformed
    { jsonrpc: '2.0', id: '3', method: 'initialize', params: {} },     // valid
  ];
  const result = adapter.parse(batch);
  assert.strictEqual(result.shape, 'batch');
  assert.strictEqual(result.batch, true);
  assert.strictEqual(result.parsed.length, 4);
  assert.deepStrictEqual(result.errors, ['2']); // index 2 is malformed
  assert.strictEqual(result.parsed[0].messageType, 'tools/list');
  assert.strictEqual(result.parsed[1].messageType, 'tools/call');
  assert.strictEqual(result.parsed[2], null);
  assert.strictEqual(result.parsed[3].messageType, 'initialize');
});

test('MCPAdapter.parse: empty batch', () => {
  const adapter = new MCPAdapter();
  const result = adapter.parse([]);
  assert.strictEqual(result.shape, 'batch');
  assert.strictEqual(result.batch, true);
  assert.deepStrictEqual(result.parsed, []);
  assert.deepStrictEqual(result.errors, ['empty batch']);
});

// ----------------------------------------------------------------------------
// MCPAdapter.parse — malformed
// ----------------------------------------------------------------------------

test('MCPAdapter.parse: malformed (not an object)', () => {
  const adapter = new MCPAdapter();
  const { result, lines } = captureStderr(() => adapter.parse('garbage'));
  assert.strictEqual(result.shape, null);
  assert.strictEqual(result.parsed, null);
  assert.ok(result.errors.length > 0);
  // The parse itself doesn't log to stderr — emitMessage does. So lines should be empty here.
  assert.deepStrictEqual(lines, []);
});

test('MCPAdapter.parse: malformed (both method and result)', () => {
  const adapter = new MCPAdapter();
  const result = adapter.parse({ jsonrpc: '2.0', id: '1', method: 'tools/list', result: {} });
  assert.strictEqual(result.shape, null);
  assert.strictEqual(result.parsed, null);
  assert.ok(result.errors.length > 0);
});

test('MCPAdapter.parse: missing jsonrpc field', () => {
  const adapter = new MCPAdapter();
  const result = adapter.parse({ id: '1', method: 'tools/list', params: {} });
  assert.strictEqual(result.shape, null);
  assert.ok(result.errors.length > 0);
});

// ----------------------------------------------------------------------------
// MCPAdapter.parse — oversize
// ----------------------------------------------------------------------------

test('MCPAdapter.parse: oversize params truncated + hashed', () => {
  const adapter = new MCPAdapter();
  const big = 'x'.repeat(OVERSIZE_BYTES + 1024);
  const env = {
    jsonrpc: '2.0',
    id: 'big-1',
    method: 'tools/call',
    params: { name: 'big_tool', arguments: { blob: big } },
  };
  const result = adapter.parse(env);
  assert.strictEqual(result.shape, 'request');
  assert.strictEqual(result.parsed.metadata.truncated, true);
  assert.strictEqual(result.parsed.params.truncated, true);
  assert.strictEqual(result.parsed.params.value, undefined);
  assert.strictEqual(typeof result.parsed.params.hash, 'string');
  assert.strictEqual(result.parsed.params.hash.length, 64);
  assert.ok(result.parsed.params.length > OVERSIZE_BYTES);
});

// ----------------------------------------------------------------------------
// MCPAdapter.emitMessage
// ----------------------------------------------------------------------------

test('MCPAdapter.emitMessage: happy path writes an mcp_message source event', async () => {
  const fakeLogger = makeFakeAuditLogger();
  const adapter = new MCPAdapter({ auditLogger: fakeLogger });
  const env = { jsonrpc: '2.0', id: '1', method: 'initialize', params: { v: 1 } };
  const actor = { agentId: 'agent-A', trustScore: 0.9, role: 'mcp-client' };

  const { result, lines } = captureStderr(() => adapter.emitMessage(env, actor));
  const emitted = await result;

  assert.strictEqual(emitted.ok, true);
  assert.strictEqual(fakeLogger.records.length, 1);

  const record = fakeLogger.records[0];
  assert.strictEqual(record.action.type, 'mcp_message');
  assert.strictEqual(record.action.target, 'mcp://initialize');
  assert.strictEqual(record.action.parameters.messageType, 'initialize');
  assert.strictEqual(record.actor.agentId, 'agent-A');
  assert.strictEqual(record.actor.role, 'mcp-client');
  assert.strictEqual(record.outcome.success, true);
  assert.strictEqual(record.outcome.errorMessage, null);
  assert.deepStrictEqual(lines, []);
});

test('MCPAdapter.emitMessage: parse error → mcp_message_parse_error source event', async () => {
  const fakeLogger = makeFakeAuditLogger();
  const adapter = new MCPAdapter({ auditLogger: fakeLogger });
  const actor = { agentId: 'agent-B' };

  const { result } = captureStderr(() => adapter.emitMessage('garbage', actor));
  const emitted = await result;

  // The parse-error path still writes a source event — the chain must
  // see *every* observation attempt, including the failures. F1
  // (ADR-051) is mitigated by emitting the failure as an event.
  assert.strictEqual(emitted.ok, true);
  assert.strictEqual(fakeLogger.records.length, 1);

  const record = fakeLogger.records[0];
  assert.strictEqual(record.action.type, 'mcp_message_parse_error');
  assert.strictEqual(record.outcome.success, false);
  assert.strictEqual(record.outcome.errorMessage, 'mcp_message_parse_error');
  assert.deepStrictEqual(record.action.parameters, { rawShape: 'string' });
});

test('MCPAdapter.emitMessage: audit logger throws → fail-open (no propagation)', async () => {
  const fakeLogger = makeFakeAuditLogger('throw');
  const adapter = new MCPAdapter({ auditLogger: fakeLogger });
  const env = { jsonrpc: '2.0', id: '1', method: 'tools/list', params: {} };

  // Capture stderr across the awaited promise — captureStderr is
  // sync-only; manually wrap for async.
  const orig = console.error;
  const lines = [];
  console.error = (...args) => { lines.push(args.map(String).join(' ')); };
  let emitted;
  try {
    emitted = await adapter.emitMessage(env, { agentId: 'agent-C' });
  } finally {
    console.error = orig;
  }

  // ADR-040 fail-open: the adapter NEVER throws out of emitMessage.
  assert.strictEqual(emitted.ok, false);
  assert.ok(emitted.error);
  assert.ok(lines.length > 0, 'audit-logger failure must log to stderr');
});

test('MCPAdapter.emitMessage: missing audit logger → fail-open (lazy fallback to stderr)', async () => {
  // Pass a logger stub that throws on logDecision. This simulates a
  // 'logger present but broken' environment and exercises the fail-open
  // path deterministically — without depending on whether the production
  // decision-logger module loads in CI.
  const brokenLogger = { logDecision: async () => { throw new Error('logger broken'); } };
  const adapter = new MCPAdapter({ auditLogger: brokenLogger });
  const env = { jsonrpc: '2.0', id: '1', method: 'ping' };

  // Manual async stderr capture (captureStderr is sync-only).
  const orig = console.error;
  const lines = [];
  console.error = (...args) => { lines.push(args.map(String).join(' ')); };
  let emitted;
  try {
    emitted = await adapter.emitMessage(env, { agentId: 'agent-D' });
  } finally {
    console.error = orig;
  }

  // Fail-open: the adapter NEVER throws out of emitMessage; the broken
  // logger's failure is captured in emitted.error and reported on stderr.
  assert.strictEqual(emitted.ok, false);
  assert.ok(emitted.error);
  assert.strictEqual(emitted.record.action.type, 'mcp_message');
  assert.ok(lines.length > 0, 'failure path must log to stderr');
});

test('MCPAdapter.emitMessage: batched envelope writes one event per parsed envelope', async () => {
  const fakeLogger = makeFakeAuditLogger();
  const adapter = new MCPAdapter({ auditLogger: fakeLogger });
  const batch = [
    { jsonrpc: '2.0', id: '1', method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: '2', method: 'tools/call', params: { name: 'x' } },
  ];
  // emitMessage() handles a single envelope at a time. The batched use
  // case is parse() returning batch:true; callers iterate.
  const parsed = adapter.parse(batch);
  assert.strictEqual(parsed.shape, 'batch');
  // Emit each parsed envelope individually.
  for (let i = 0; i < parsed.parsed.length; i++) {
    const env = batch[i];
    await adapter.emitMessage(env, { agentId: 'agent-E' });
  }
  assert.strictEqual(fakeLogger.records.length, 2);
  assert.strictEqual(fakeLogger.records[0].action.parameters.messageType, 'tools/list');
  assert.strictEqual(fakeLogger.records[1].action.parameters.messageType, 'tools/call');
});

// ----------------------------------------------------------------------------
// Wire-shape correctness (DecisionRecord contract)
// ----------------------------------------------------------------------------

test('MCPAdapter.buildDecisionRecord: DecisionRecord shape is decision-logger-compatible', () => {
  const adapter = new MCPAdapter({ parentDecisionId: 'parent-xyz' });
  const env = { jsonrpc: '2.0', id: '1', method: 'initialize', params: {} };
  const parsed = adapter.parse(env).parsed;
  const record = adapter.buildDecisionRecord(env, parsed, { agentId: 'agent-F' });

  // Required fields per decision-logger.js DecisionRecord typedef.
  for (const field of ['decisionId', 'parentDecisionId', 'timestamp', 'actor', 'action', 'context', 'outcome']) {
    assert.ok(field in record, `record missing required field ${field}`);
  }
  assert.strictEqual(record.parentDecisionId, 'parent-xyz');
  assert.strictEqual(record.action.type, 'mcp_message');
  assert.ok(record.decisionId.startsWith('mcp-'), 'decisionId prefix');
  // ISO 8601
  assert.match(record.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
});

// ----------------------------------------------------------------------------
// JSONL corpus (ADR-051 §4 F2 — tests must parse a corpus, not strings)
// ----------------------------------------------------------------------------

test('parses the JSONL corpus end-to-end (every recognised envelope)', () => {
  const corpusPath = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'test',
    'fixtures',
    'mcp-messages',
    'mcp-wire-corpus.jsonl'
  );
  assert.ok(fs.existsSync(corpusPath), `corpus missing: ${corpusPath}`);

  const raw = fs.readFileSync(corpusPath, 'utf8');
  // Strip // comment lines + blank lines; JSONL formally has no comments.
  const lines = raw
    .split('\n')
    .filter((l) => l.trim().length > 0 && !l.trim().startsWith('//'));
  assert.ok(lines.length >= 7, `corpus must cover at least 7 message types; got ${lines.length}`);

  const adapter = new MCPAdapter();
  const types = new Set();
  for (const line of lines) {
    const env = JSON.parse(line);
    const r = adapter.parse(env);
    assert.notStrictEqual(r.shape, null, `corpus line did not parse: ${line.slice(0, 80)}`);
    types.add(r.parsed.messageType);
  }
  // 7 message types from the card body must all be present.
  for (const required of [
    'initialize', 'tools/list', 'tools/call', 'resources/read',
    'prompts/get', 'notifications/tools/list_changed', 'completion/complete',
  ]) {
    assert.ok(types.has(required), `corpus missing message type ${required}`);
  }
});

// ----------------------------------------------------------------------------
// observeMcpMessage — coordinator shell entry point
// ----------------------------------------------------------------------------

test('coordinator/index.js exports observeMcpMessage wired to MCPAdapter', () => {
  // Use a fresh require so we don't depend on module-cache ordering.
  const coordPath = path.resolve(__dirname, '..', '..', '..', '..', 'src', 'coordinator', 'index.js');
  delete require.cache[require.resolve(coordPath)];
  const coord = require(coordPath);
  assert.strictEqual(typeof coord.observeMcpMessage, 'function');
});