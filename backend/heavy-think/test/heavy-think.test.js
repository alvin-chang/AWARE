/**
 * Heavy-think smoke tests.
 *
 * Exercises the K-Parallel + PRM + Refine + preference-pair
 * pipeline against a deterministic mock LLM client so the
 * algorithm is verified without touching the network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { heavy_think } from "../src/index.js";
import { parallelReasoning } from "../src/parallel.js";
import { refine } from "../src/refine.js";
import { scoreWithPRM } from "../src/prm.js";
import { verify } from "../src/verify.js";
import { defaultKForTaskType, K_CONFIGS } from "../src/config.js";

function buildMockClient({ attemptResponse = "raw attempt", prmScoreFor = () => 7 } = {}) {
	return {
		model: "mock-1",
		async generate(prompt, opts) {
			if (opts?.phase === "prm_score") {
				return {
					reasoning: JSON.stringify({
						score: prmScoreFor(opts.attempt_index ?? 0),
						strengths: ["ok"],
						weaknesses: []
					}),
					cost_usd: 0
				};
			}
			if (opts?.phase === "refine") {
				return { reasoning: "REFINED: improved", confidence: 0.9, cost_usd: 0 };
			}
			return {
				reasoning: `${attemptResponse} #${opts?.attempt_index ?? 0}`,
				cost_usd: 0
			};
		}
	};
}

test("parallelReasoning issues K attempts and aggregates cost", async () => {
	const client = buildMockClient();
	const result = await parallelReasoning({
		problem: "Q?",
		K: 4,
		task_type: "standard",
		client
	});
	assert.equal(result.attempts.length, 4);
	assert.equal(result.attempts[0].attempt_index, 0);
	assert.equal(result.attempts[3].attempt_index, 3);
	assert.equal(result.cost_usd, 0);
});

test("scoreWithPRM parses a JSON response and normalizes score to 0-1", async () => {
	const client = buildMockClient({
		prmScoreFor: () => 8
	});
	const out = await scoreWithPRM({
		problem: "Q?",
		reasoning: "reasoning text",
		task_type: "standard",
		client
	});
	assert.equal(out.score, 0.8);
	assert.deepEqual(out.strengths, ["ok"]);
});

test("refine returns refined_trace + confidence", async () => {
	const client = buildMockClient();
	const out = await refine({
		problem: "Q?",
		best_attempt: "best",
		task_type: "standard",
		client
	});
	assert.equal(out.refined_trace, "REFINED: improved");
	assert.equal(out.confidence, 0.9);
});

test("verify with method=none returns passed=true", async () => {
	const r = await verify({
		trace: "irrelevant",
		verification: { method: "none" }
	});
	assert.equal(r.passed, true);
	assert.equal(r.method, "none");
});

test("verify with method=citation_check extracts URLs", async () => {
	const r = await verify({
		trace: "see https://example.com and https://other.org/page for context",
		verification: { method: "citation_check" }
	});
	assert.equal(r.passed, true);
	assert.equal(r.details.urls_found, 2);
});

test("defaultKForTaskType returns expected defaults", () => {
	assert.equal(defaultKForTaskType("simple"), 2);
	assert.equal(defaultKForTaskType("standard"), 4);
	assert.equal(defaultKForTaskType("security"), 6);
	assert.equal(defaultKForTaskType("financial"), 6);
	assert.equal(defaultKForTaskType("creative"), 3);
	assert.equal(defaultKForTaskType("nonsense"), 4); // falls back to standard
});

test("K_CONFIGS is frozen", () => {
	assert.equal(Object.isFrozen(K_CONFIGS), true);
	assert.equal(Object.isFrozen(K_CONFIGS.standard), true);
});

test("heavy_think: K-Parallel + PRM + Refine + preference pair", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ht-test-"));
	const pairPath = join(dir, "pairs.jsonl");
	try {
		// Attempt 0 scores highest → should be selected as the seed.
		const client = buildMockClient({
			prmScoreFor: (i) => 10 - i
		});
		const r = await heavy_think({
			problem: "Q?",
			K: 3,
			task_type: "standard",
			client,
			preferencePairPath: pairPath
		});

		assert.equal(r.attempts.length, 3);
		assert.equal(r.refined_trace, "REFINED: improved");
		assert.equal(r.confidence, 0.9);
		assert.equal(r.pair_written, true);
		assert.equal(r.cache.enabled, false);

		const selected = r.attempts.find((a) => a.selected);
		assert.equal(selected.attempt_index, 0); // attempt 0 had the highest PRM score
		assert.equal(r.attempts[0].prm_score, 1.0); // 10/10

		// Second call with same problem → dedup → pair_written=false
		const r2 = await heavy_think({
			problem: "Q?",
			K: 3,
			client,
			preferencePairPath: pairPath
		});
		assert.equal(r2.pair_written, false);

		const contents = await readFile(pairPath, "utf8");
		const lines = contents.trim().split("\n");
		assert.equal(lines.length, 1);
		const rec = JSON.parse(lines[0]);
		assert.equal(rec.problem, "Q?");
		assert.equal(rec.task_type, "standard");
		assert.equal(rec.chosen.reasoning, "REFINED: improved");
		assert.equal(rec.rejected.reasoning, "raw attempt #0");
		assert.ok(rec._content_hash);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("heavy_think: missing problem throws", async () => {
	await assert.rejects(
		() => heavy_think({ client: buildMockClient() }),
		/problem is required/
	);
});

test("heavy_think: K < 1 throws", async () => {
	await assert.rejects(
		() => heavy_think({ problem: "Q?", K: 0, client: buildMockClient() }),
		/K must be >= 1/
	);
});
