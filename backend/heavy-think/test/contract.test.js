/**
 * Heavy-think contract test.
 *
 * Guards against the regression that motivated this file: a stub tree
 * (11-line index.js exporting `{run: ...}` instead of a callable
 * function) was committed locally and shipped as the AWARE coordinator's
 * heavy-think source. The coordinator calls heavy_think({...}) as a
 * function, so the stub produced: `TypeError: heavyThink is not a function`.
 *
 * This test asserts the operator-facing contract:
 *   1. The package's `main` export is a callable async function
 *   2. Calling it with minimal options returns a result object with
 *      the documented shape (refined_trace, confidence, attempts, etc.)
 *   3. The call surface does NOT regress to an object with a .run method
 *
 * The test does NOT mock the LLM — it uses a fakeClient to keep it
 * fast and offline. This is intentionally separate from heavy-think.test.js
 * so a stub regression is caught even if the heavier pipeline tests fail.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { heavy_think } from "../src/index.js";

test("contract: heavy_think is exported as a callable async function", () => {
  assert.equal(
    typeof heavy_think,
    "function",
    `heavy_think must be a callable async function (got typeof=${typeof heavy_think}). ` +
      `This guards against the stub regression where src/index.js was a ` +
      `11-line file exporting {run: ...} instead of an async function. ` +
      `See ADR-042 for context.`
  );
});

test("contract: heavy_think is NOT an object with a .run method", () => {
  // The stub tree exposed `module.exports = { run: async () => {...} }`.
  // Reject that shape explicitly so the contract is unambiguous.
  assert.equal(
    typeof heavy_think?.run,
    "undefined",
    "heavy_think must be a function, not an object with a .run method. " +
      "AWARE's coordinator calls heavy_think({...}) as a function."
  );
});

test("contract: heavy_think returns the documented result shape", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "heavy-think-contract-"));
  try {
    const fakeClient = {
      model: "fake",
      async generate(_prompt, opts) {
        if (opts?.phase === "prm_score") {
          return {
            reasoning: JSON.stringify({
              score: 5,
              strengths: ["ok"],
              weaknesses: []
            }),
            cost_usd: 0
          };
        }
        if (opts?.phase === "refine") {
          return {
            reasoning: "REFINED: ok",
            confidence: 0.8,
            cost_usd: 0
          };
        }
        return {
          reasoning: "answer",
          cost_usd: 0
        };
      }
    };

    const result = await heavy_think({
      problem: "what is 1+1?",
      task_type: "simple",
      client: fakeClient,
      output_dir: tmpDir,
      k: 1
    });

    // The result must be an object with the documented fields.
    assert.equal(typeof result, "object");
    assert.notEqual(result, null);
    assert.ok("refined_trace" in result, "result.refined_trace missing");
    assert.ok("confidence" in result, "result.confidence missing");
    assert.ok("attempts" in result, "result.attempts missing");
    assert.ok("cost" in result, "result.cost missing");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
