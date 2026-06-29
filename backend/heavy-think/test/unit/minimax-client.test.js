// test/unit/minimax-client.test.js — Client constructor + error behavior
// Live API test lives in test/integration/minimax-client-live.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeMinimaxClient,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  ANTHROPIC_VERSION,
} from '../../src/clients/minimax.js';

const DUMMY_KEY = 'dummy-key-for-construction-test-only';

function withEnv(overrides, fn) {
  const saved = {};
  for (const k of Object.keys(overrides)) {
    saved[k] = process.env[k];
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('makeMinimaxClient throws when no apiKey in env and no apiKey in options', () => {
  withEnv({ LLM_API_KEY: undefined }, () => {
    assert.throws(
      () => makeMinimaxClient(),
      /LLM_API_KEY is not set/
    );
  });
});

test('makeMinimaxClient throws with helpful error message naming both options', () => {
  withEnv({ LLM_API_KEY: undefined }, () => {
    assert.throws(
      () => makeMinimaxClient(),
      /apiKey.*explicitly|LLM_API_KEY/
    );
  });
});

test('makeMinimaxClient accepts apiKey from options without reading env', () => {
  withEnv({ LLM_API_KEY: undefined }, () => {
    const client = makeMinimaxClient({ apiKey: DUMMY_KEY });
    assert.equal(client.provider, 'minimax');
    assert.equal(client.model, DEFAULT_MODEL);
    assert.equal(typeof client.generate, 'function');
  });
});

test('makeMinimaxClient prefers options.apiKey over env when both are set', () => {
  withEnv({ LLM_API_KEY: DUMMY_KEY }, () => {
    const client = makeMinimaxClient({ apiKey: 'options-key' });
    assert.ok(client);
    assert.equal(client.model, DEFAULT_MODEL);
  });
});

test('makeMinimaxClient reads LLM_API_KEY from env when no options.apiKey', () => {
  withEnv({ LLM_API_KEY: DUMMY_KEY }, () => {
    const client = makeMinimaxClient();
    assert.equal(client.provider, 'minimax');
  });
});

test('makeMinimaxClient respects option overrides for baseUrl and model', () => {
  const client = makeMinimaxClient({
    apiKey: DUMMY_KEY,
    baseUrl: 'https://custom.example.com/anthropic',
    model: 'MiniMax-M2.7',
    maxTokens: 2048,
  });
  assert.equal(client.model, 'MiniMax-M2.7');
  assert.ok(client);
});

test('exports include the documented constants', () => {
  assert.equal(typeof DEFAULT_BASE_URL, 'string');
  assert.match(DEFAULT_BASE_URL, /^https?:\/\//);
  assert.equal(typeof DEFAULT_MODEL, 'string');
  assert.equal(DEFAULT_MODEL, 'MiniMax-M3');
  assert.equal(typeof ANTHROPIC_VERSION, 'string');
  assert.match(ANTHROPIC_VERSION, /^\d{4}-\d{2}-\d{2}$/);
});
