// test/rlm/environment.test.js — Context loader + REPL ops unit tests
//
// Verifies:
//   - inline string context returns kind:'inline' + summary
//   - typed context requires absolute path + workspaceDir
//   - typed context rejects paths outside workspaceDir (sandbox)
//   - log loader returns 0-indexed lines array
//   - directory loader walks the tree with the small_repo fixture
//   - REPL ops work (read/grep/slice/len/keys/print)
//   - REPL read blocks path traversal outside workspace
//   - bad context shapes throw RlmConfigError

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadContext, REPL_OPS } from '../../src/rlm/environment.js';
import { RlmConfigError } from '../../src/rlm/errors.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_DIR = resolve(__dirname, 'fixtures');
const SMALL_REPO = resolve(FIXTURE_DIR, 'small_repo');
const SAMPLE_LOG = resolve(FIXTURE_DIR, 'sample.log');
const SAMPLE_PDF = resolve(FIXTURE_DIR, 'sample.pdf');
const KNOWN_BAD = resolve(FIXTURE_DIR, 'known_bad');

test('environment: inline string returns kind=inline with summary', async () => {
  const env = await loadContext('hello world', '/tmp');
  assert.equal(env.kind, 'inline');
  assert.equal(env.text, 'hello world');
  assert.match(env.summary, /inline text/);
});

test('environment: empty inline string returns kind=inline', async () => {
  const env = await loadContext('', '/tmp');
  assert.equal(env.kind, 'inline');
  assert.equal(env.text, '');
});

test('environment: missing context throws RlmConfigError', async () => {
  await assert.rejects(
    () => loadContext(null, '/tmp'),
    (err) => err instanceof RlmConfigError
  );
});

test('environment: non-string non-object context throws RlmConfigError', async () => {
  await assert.rejects(
    () => loadContext(42, '/tmp'),
    (err) => err instanceof RlmConfigError
  );
});

test('environment: typed context without workspaceDir throws RlmConfigError', async () => {
  await assert.rejects(
    () => loadContext({ path: '/tmp/x', type: 'directory' }, undefined),
    (err) => err instanceof RlmConfigError && /workspaceDir/.test(err.message)
  );
});

test('environment: typed context with relative path throws RlmConfigError', async () => {
  await assert.rejects(
    () => loadContext({ path: 'relative/path', type: 'directory' }, '/tmp'),
    (err) => err instanceof RlmConfigError && /absolute/.test(err.message)
  );
});

test('environment: typed context with path outside workspaceDir throws RlmConfigError', async () => {
  await assert.rejects(
    () => loadContext({ path: '/etc/passwd', type: 'directory' }, SMALL_REPO),
    (err) => err instanceof RlmConfigError && /inside workspaceDir/.test(err.message)
  );
});

test('environment: bad context.type throws RlmConfigError', async () => {
  await assert.rejects(
    () => loadContext({ path: '/tmp/x', type: 'banana' }, '/tmp'),
    (err) => err instanceof RlmConfigError && /type/.test(err.message)
  );
});

test('environment: directory loader walks tree (small_repo fixture)', async () => {
  const env = await loadContext({ path: SMALL_REPO, type: 'directory' }, SMALL_REPO);
  assert.equal(env.kind, 'directory');
  assert.ok(Array.isArray(env.tree));
  // small_repo has src/ and tests/ subdirectories
  const names = env.tree.filter(n => n.type === 'dir').map(n => n.name).sort();
  assert.ok(names.includes('src') && names.includes('tests'),
    `expected small_repo to have src/ and tests/, got: ${JSON.stringify(names)}`);
  assert.match(env.summary, /directory tree/);
});

test('environment: log loader returns 0-indexed lines', async () => {
  const env = await loadContext({ path: SAMPLE_LOG, type: 'log' }, FIXTURE_DIR);
  assert.equal(env.kind, 'log');
  assert.ok(Array.isArray(env.lines));
  assert.ok(env.lines.length > 0, 'sample.log should have at least one line');
  // lines are 0-indexed by index access, not by line numbering
  assert.equal(typeof env.lines[0], 'string');
  assert.match(env.summary, /log file/);
});

test('environment: pdf loader returns pages array (pdftotext or placeholder)', async () => {
  const env = await loadContext({ path: SAMPLE_PDF, type: 'pdf' }, FIXTURE_DIR);
  assert.equal(env.kind, 'pdf');
  assert.ok(Array.isArray(env.pages));
  assert.ok(env.pages.length > 0, 'pdf should have at least one page');
  assert.match(env.summary, /PDF/);
});

test('environment: pdf loader on non-existent path throws RlmConfigError', async () => {
  await assert.rejects(
    () => loadContext({ path: resolve(FIXTURE_DIR, 'nonexistent.pdf'), type: 'pdf' }, FIXTURE_DIR),
    (err) => err instanceof RlmConfigError && /not exist/.test(err.message)
  );
});

test('environment: sqlite returns stub (v1)', async () => {
  const env = await loadContext({ path: '/tmp/fake.db', type: 'sqlite' }, '/tmp');
  assert.equal(env.kind, 'sqlite');
  assert.equal(env.vec._stub, true);
  assert.match(env.summary, /vec_search stub/);
});

test('environment: directory on non-existent path throws RlmConfigError', async () => {
  await assert.rejects(
    () => loadContext({ path: resolve(FIXTURE_DIR, 'nonexistent_dir'), type: 'directory' }, FIXTURE_DIR),
    (err) => err instanceof RlmConfigError && /not a directory/.test(err.message)
  );
});

test('REPL_OPS: read blocks path outside workspace', async () => {
  const env = { _workspace: '/tmp' };
  const r = await REPL_OPS.read(env, '/etc/passwd');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'path_outside_workspace');
});

test('REPL_OPS: grep returns matches across lines (use log env)', async () => {
  const env = await loadContext({ path: SAMPLE_LOG, type: 'log' }, FIXTURE_DIR);
  env._workspace = FIXTURE_DIR;
  // Sample fixture log has at least one recognizable line
  const r = REPL_OPS.grep(env, 'INFO|WARN|ERROR|started|started|complete', 'lines');
  // Either matches or no-match is valid; we just check the contract
  if (r.ok) {
    assert.ok(Array.isArray(r.value));
  } else {
    assert.equal(r.error, 'target_not_found');
  }
});

test('REPL_OPS: grep with invalid regex returns ok:false error:invalid_regex', async () => {
  const env = { lines: ['abc', 'def'], _workspace: '/tmp' };
  const r = REPL_OPS.grep(env, '[invalid', 'lines');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'invalid_regex');
});

test('REPL_OPS: slice returns substring', () => {
  const env = { text: 'hello world' };
  const r = REPL_OPS.slice(env, undefined, 0, 5);
  assert.equal(r.ok, true);
  assert.equal(r.value, 'hello');
});

test('REPL_OPS: slice on array returns array slice', () => {
  const env = { lines: ['a', 'b', 'c', 'd'] };
  const r = REPL_OPS.slice(env, undefined, 1, 3);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, ['b', 'c']);
});

test('REPL_OPS: len returns string length or array length', () => {
  const env1 = { text: 'hello' };
  assert.equal(REPL_OPS.len(env1).value, 5);
  const env2 = { lines: [1, 2, 3] };
  assert.equal(REPL_OPS.len(env2).value, 3);
});

test('REPL_OPS: keys returns non-_ prefixed keys', () => {
  const env = { _workspace: '/tmp', kind: 'inline', text: 'hi' };
  const r = REPL_OPS.keys(env);
  assert.deepEqual(r.value.sort(), ['kind', 'text']);
});

test('REPL_OPS: print stringifies', () => {
  const r = REPL_OPS.print({}, 42);
  assert.equal(r.value, '42');
});