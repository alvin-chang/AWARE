// test/rlm/errors.test.js — RlmError hierarchy unit tests
//
// Verifies:
//   - error classes are subclasses of Error
//   - name property is set correctly
//   - constructor stores partial_tree and run_id on base RlmError
//   - RlmConfigError is NOT an RlmError (programmer error)
//   - security error carries attempted_op + audit_id

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RlmError,
  RlmBudgetExceededError,
  RlmTimeoutError,
  RlmSecurityError,
  RlmEnvironmentError,
  RlmConfigError,
} from '../../src/rlm/errors.js';

test('errors: RlmError is an Error subclass', () => {
  const e = new RlmError('boom');
  assert.ok(e instanceof Error);
  assert.ok(e instanceof RlmError);
  assert.equal(e.name, 'RlmError');
  assert.equal(e.message, 'boom');
  assert.equal(e.partial_tree, null);
  assert.equal(e.run_id, null);
});

test('errors: RlmError stores partial_tree + run_id', () => {
  const partial = { kind: 'leaf', answer: 'partial' };
  const e = new RlmError('boom', partial, 'run-42');
  assert.equal(e.partial_tree, partial);
  assert.equal(e.run_id, 'run-42');
});

test('errors: RlmBudgetExceededError carries partial_tree', () => {
  const partial = { kind: 'internal', partial: true };
  const e = new RlmBudgetExceededError('budget hit', partial, 'run-99');
  assert.ok(e instanceof RlmError);
  assert.ok(e instanceof RlmBudgetExceededError);
  assert.equal(e.name, 'RlmBudgetExceededError');
  assert.equal(e.partial_tree, partial);
  assert.equal(e.run_id, 'run-99');
});

test('errors: RlmTimeoutError carries partial_tree', () => {
  const partial = { kind: 'leaf' };
  const e = new RlmTimeoutError('timeout', partial, 'run-7');
  assert.ok(e instanceof RlmTimeoutError);
  assert.ok(e instanceof RlmError);
  assert.equal(e.name, 'RlmTimeoutError');
});

test('errors: RlmSecurityError carries attempted_op + audit_id', () => {
  const partial = { kind: 'leaf' };
  const e = new RlmSecurityError(
    'forbidden syscall',
    'eval(compile(open("/etc/passwd").read()))',
    'audit-12345',
    partial,
    'run-1'
  );
  assert.ok(e instanceof RlmSecurityError);
  assert.ok(e instanceof RlmError);
  assert.equal(e.name, 'RlmSecurityError');
  assert.equal(e.attempted_op, 'eval(compile(open("/etc/passwd").read()))');
  assert.equal(e.audit_id, 'audit-12345');
  assert.equal(e.partial_tree, partial);
  assert.equal(e.run_id, 'run-1');
});

test('errors: RlmEnvironmentError does NOT carry attempted_op (env crash, not security)', () => {
  const e = new RlmEnvironmentError('subprocess crashed', { kind: 'leaf' }, 'run-2');
  assert.ok(e instanceof RlmEnvironmentError);
  assert.ok(e instanceof RlmError);
  assert.equal(e.name, 'RlmEnvironmentError');
  assert.equal(e.attempted_op, undefined);
});

test('errors: RlmConfigError is NOT an RlmError (programmer error)', () => {
  const e = new RlmConfigError('bad config');
  assert.ok(e instanceof Error);
  assert.ok(!(e instanceof RlmError), 'RlmConfigError must NOT extend RlmError so it does not get caught by the catch-all');
  assert.equal(e.name, 'RlmConfigError');
});

test('errors: stack trace is preserved', () => {
  const e = new RlmError('test');
  assert.ok(typeof e.stack === 'string' && e.stack.length > 0);
});