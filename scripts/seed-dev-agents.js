#!/usr/bin/env node
/**
 * scripts/seed-dev-agents.js
 * 
 * Generates dev-only agent fixtures at install/setup time.
 * These are NOT real agents — they're test data for local development.
 * 
 * Usage: node scripts/seed-dev-agents.js
 * Output: src/data/agents.json (gitignored)
 * 
 * Security: This file is committed because it's the seeder SOURCE.
 * The OUTPUT (src/data/agents.json) is gitignored and generated at install.
 * 
 * The credential values are SHA-256 of the literal agent names. They are
 * NOT secrets — they're reproducible fixtures so anyone running
 * `npm run seed:dev` gets the same hashes.
 * 
 * See: docs/security/history-rewrites.md for context on why this is the
 * install-time pattern (post-[date-redacted] privacy filter rollout).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function fixtureCredential(agentId) {
  return crypto.createHash('sha256').update(agentId).digest('hex');
}

const now = new Date().toISOString();
const agents = [
  {
    id: 'e89f5d91-45c2-4c4a-98a5-cdcd9f578822',
    agentId: 'agent:tester:instance-abc123',
    name: 'Test Agent',
    type: 'tester',
    model: 'primary-model',
    version: '1.0.0',
    capabilities: ['test_execute', 'assertions'],
    clearance: 'internal_only',
    trustScore: 0.5,
    state: 'pending',
    credentials: {
      current: fixtureCredential('agent:tester:instance-abc123'),
      previous: null,
      rotatedAt: now,
    },
    metadata: {},
    createdAt: now,
    updatedAt: now,
    lastSeenAt: null,
    decommissionedAt: null,
  },
  {
    id: 'c3cb2d0f-b6b7-4ebb-99c1-11a11f81efcb',
    agentId: 'agent:coder:instance-xyz789',
    name: 'Coder (Test)',
    type: 'coder',
    model: 'qwen-coder',
    version: '1.0.0',
    capabilities: ['code_write', 'test_write', 'git_push'],
    clearance: 'internal_only',
    trustScore: 0.85,
    state: 'revoked',
    credentials: {
      current: fixtureCredential('agent:coder:instance-xyz789'),
      previous: null,
      rotatedAt: now,
    },
    metadata: { registeredBy: 'system', registrationSource: 'api' },
    createdAt: now,
    updatedAt: now,
    lastSeenAt: null,
    decommissionedAt: null,
  },
  {
    id: 'd4dc3e1e-c7c8-5fcc-a0d2-22b22f92f0dc',
    agentId: 'agent:researcher:instance-uvw456',
    name: 'Researcher (Test)',
    type: 'researcher',
    model: 'primary-model',
    version: '1.0.0',
    capabilities: ['web_search', 'summarize'],
    clearance: 'trusted',
    trustScore: 0.7,
    state: 'active',
    credentials: {
      current: fixtureCredential('agent:researcher:instance-uvw456'),
      previous: fixtureCredential('agent:researcher:instance-uvw456-prev'),
      rotatedAt: now,
    },
    metadata: { registeredBy: 'system', registrationSource: 'api' },
    createdAt: now,
    updatedAt: now,
    lastSeenAt: null,
    decommissionedAt: null,
  },
];

const outputPath = path.join(__dirname, '..', 'src', 'data', 'agents.json');
fs.writeFileSync(outputPath, JSON.stringify({ agents }, null, 2) + '\n');
console.log(`✅ Wrote ${agents.length} dev agents to ${outputPath}`);
console.log('   These are TEST FIXTURES — never use for production.');
