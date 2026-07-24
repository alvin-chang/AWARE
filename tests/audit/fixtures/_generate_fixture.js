#!/usr/bin/env node
/*
 * Generate the aware_chain_1k.jsonl fixture by calling AWARE's real
 * decision-logger.js logDecision() N times. This guarantees the
 * canonical JSON + SHA256 math is identical to what production AWARE
 * emits — the verifier's round-trip test then validates our Python
 * implementation against the canonical implementation.
 *
 * Usage: node tests/audit/fixtures/_generate_fixture.js <count> <out.jsonl>
 */
'use strict';

const path = require('path');
const fs = require('fs');

// Force decision-logger.js to use our temp dir, not /data/audit.
const OUT = path.resolve(process.argv[3] || 'tests/audit/fixtures/aware_chain_1k.jsonl');
const COUNT = parseInt(process.argv[2] || '1000', 10);
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'aware-fixt-'));
process.env.AUDIT_DIR = TMP;

// decision-logger mutates lastHash via loadIndex(); we need a fresh
// process-equivalent state, so use a local require here. The
// logDecision() call is async and updates the in-memory `lastHash`,
// which is exactly what production code does.
const { logDecision, GENESIS_HASH } = require(path.resolve(__dirname,
    '../../../src/audit/decision-logger'));

// Synthesize plausible decision records. The exact field values don't
// matter for hash correctness; what matters is that logDecision() writes
// each record the same way production code does.
function makeDecision(i) {
    return {
        decisionId: `dec-${i.toString().padStart(6, '0')}`,
        parentDecisionId: i === 0 ? null : `dec-${(i - 1).toString().padStart(6, '0')}`,
        timestamp: new Date(1700000000000 + i * 1000).toISOString(),
        actor: { agentId: `agent-${i % 7}`, trustScore: 0.5 + (i % 50) / 100 },
        action: {
            type: i % 3 === 0 ? 'route' : (i % 3 === 1 ? 'tool-call' : 'respond'),
            target: `target-${i}`,
            reason: `step-${i}`,
        },
        context: {
            pheromoneScores: { explore: i / COUNT, exploit: 1 - i / COUNT },
            heuristicWeights: { recency: 0.6, frequency: 0.4 },
            policyId: 'policy-default',
            policyVersion: '1.0.0',
        },
        outcome: {
            success: i % 17 !== 0,
            latencyMs: 10 + (i % 200),
            errorMessage: i % 17 === 0 ? 'synthetic-error' : null,
        },
    };
}

async function main() {
    const stream = fs.createWriteStream(OUT, { encoding: 'utf-8' });

    // Capture each line as logDecision appends it. Easier: re-read the
    // log file after every write (decision-logger only writes through
    // appendToLog()). We poll the on-disk file after each call.
    for (let i = 0; i < COUNT; i++) {
        await logDecision(makeDecision(i));
    }

    // Now copy the temp file to OUT, stripping any index side-effects.
    const src = path.join(TMP, 'decision-chain.jsonl');
    fs.copyFileSync(src, OUT);
    fs.unlinkSync(src);
    // Clean up index sidecar.
    try { fs.unlinkSync(path.join(TMP, 'decision-chain.idx')); } catch (_) {}
    fs.rmdirSync(TMP);

    const lines = fs.readFileSync(OUT, 'utf-8').trim().split('\n');
    if (lines.length !== COUNT) {
        console.error(`FAIL: expected ${COUNT} lines, got ${lines.length}`);
        process.exit(1);
    }
    console.log(`wrote ${OUT} (${COUNT} records)`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});