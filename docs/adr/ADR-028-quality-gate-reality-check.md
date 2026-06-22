# ADR-028 — Quality-Gate Reality Check: PRM Inversion and `outcome-filter.js` Noop Default

**Status:** **Empirical Finding — recorded 2026-06-22.** Not a decision per se; documents the state of the AWARE 2.0 quality-gate stack under Path 1 reversal.
**Date:** 2026-06-22
**Author:** Orchestrator (Alfie) — empirical audit after Path 1 reversal (ADR-027, accepted 2026-06-22 13:50 BST).
**Build phase:** A1 (continuing)
**Relates to:** ADR-024 (partially reversed), ADR-027 (Path 1 reversal), ADR-025 (production chat model deployment).
**Findings-only:** This ADR records state. It does **not** propose a fix path. The fix path is a separate ADR (proposed: ADR-029 — Trainer Re-enable Runbook + Quality Gate Repair).

---

## Why this ADR exists

ADR-027 (Path 1, accepted 2026-06-22 13:50 BST) reverses ADR-024 §Decision's no-continuous-flywheel framing. Path 1's premise is:

> "The trainer may fire continuously, but each candidate pair is filtered through `outcome-filter.js` and the existing 100-pair minimum still applies as a 'warmth' check on the poller cadence."

The implicit assumption is that **`outcome-filter.js` enforces ADR-024 §Precondition 2's "non-trivial verification; chosen/rejected differentiated by content; PRM scores from real extraction" bar.** Path 1 reads this as: "the gates are real, the trainer is just gated on volume, not on quality."

**This ADR records that the assumption is not holding.** Empirical evidence from the production coordinator (`aware-2-coordinator:18081`) shows two distinct failures that compose into a "trainer would fire on inverted garbage" failure mode under Path 1 defaults.

This finding is **immediately load-bearing** because:
1. Path 1 was accepted on the premise that quality gates exist
2. The empirical evidence says they don't, in their current form
3. Continuing to develop as if the gates work would propagate the failure into the trainer
4. The fix is non-trivial (PRM scoring inversion is a model behavior issue; outcome-filter defaults are a config issue)

---

## Finding 1: PRM scoring is inverted on the production sample

**Source data:** `/data/awareness-pairs/2026-06-22.jsonl` (read from `aware-2-coordinator` container, 2026-06-22 14:05 BST).

**Both production pairs in the file show INVERTED PRM scores** (chosen has LOWER score than rejected):

| Pair | Problem | Chosen PRM | Rejected PRM | Gap (chosen − rejected) | Verification |
|---|---|---|---|---|---|
| 0 | "What is AWARE 2.0?" | 0.75 | 0.80 | **−0.05** | `method: none, passed: true` |
| 1 | "Reply with the single word: hello" | 0.60 | 1.00 | **−0.40** | `method: none, passed: true` |

**Sample-level interpretation:**

For pair 0 ("What is AWARE 2.0?"):
- The CHOSEN attempt (score 0.75) hedges, admits ambiguity, says "specifics should be verified." It is the more epistemically honest answer.
- The REJECTED attempt (score 0.80) confidently asserts specifics: Laravel/PHP backend, MySQL/MariaDB, Apache 2.0 license, MQTT protocol. It is more hallucinated.
- **PRM scored the hallucinated answer higher.** If the trainer trains on this pair, the model learns: "be more confident, even when wrong."

For pair 1 ("Reply with hello"):
- The CHOSEN attempt (score 0.60) is presumably some other response.
- The REJECTED attempt (score 1.00) is exactly "hello" — perfect compliance with the request.
- **PRM scored the correct-answer rejection as a perfect 1.0.** This is consistent with PRM working correctly on a trivial task, but the inversion logic at the chosen/rejected labeling step is wrong: the right answer was rejected.

**Both pairs have `verification.method: 'none'`.** The `verification.passed: true` is a passthrough marker, not an actual verification. Per `outcome-filter.js` source comments, "verification: {method, passed}" is the schema; the coordinator's `/coordinate` is currently emitting `method: 'none'` regardless of whether any verification was performed.

---

## Finding 2: `outcome-filter.js` defaults to `noop` and even non-noop rules don't catch inversion

**Source:** `~/src/AWARE/src/trainer/outcome-filter.js` (read in full 2026-06-22 14:00 BST).

**Default behavior (line 98):**
```javascript
const rule = options.rule || 'noop';
```

The default filter rule is `noop` — it keeps all records. The header comment (lines 45-50) explicitly states:
> "The default rule is 'noop' because we have no AZR pass/fail data in production yet... When the AZR results table exists and the operator has decided a filter rule, the operator flips `AWARE_TRAINER_FILTER_RULE` in the trainer service's env and the poller picks it up on the next tick."

**Behavior of `min_score_gap` rule (lines 164-177):**
```javascript
if (gap + 1e-9 < minGap) {
  return { action: 'drop', reason: `min_score_gap:${gap.toFixed(4)}<${minGap}` };
}
```

With `minGap=0.05` (default), this rule **would drop** the inverted pairs from Finding 1 (gap = -0.05 and -0.40, both < 0.05). But:

1. The rule is **not the default** — production runs on `noop`.
2. Even if `min_score_gap` were enabled, the rule's "missing scores — don't penalize, let downstream decide" policy (line 168) means a pair with missing chosen.prm_score or rejected.prm_score passes through.
3. The rule does not enforce **directionality** — it just checks gap magnitude. A pair where chosen.prm_score = 0.20 and rejected.prm_score = 0.21 would PASS (gap = 0.01 < 0.05 → dropped), but a pair where chosen.prm_score = 0.05 and rejected.prm_score = 0.50 would also be dropped (gap = -0.45 < 0.05). Wait, this is the inversion case and it WOULD be dropped. Good. But a pair where chosen.prm_score = 0.50 and rejected.prm_score = 0.50 would PASS (gap = 0 ≥ 0.05 → keep), even though chosen is not actually better than rejected.

**Behavior of `tag_match` rule (lines 179-191):**
- Filters by task_type, not quality. If no allowed list is configured, keeps everything. Today's pairs have `task_type: "standard"` which is not in any default allowed list — so this rule (if enabled) would drop them. But that's not "non-trivial verification."

**Behavior of `azr_result` rule (lines 193-236):**
- Only applies to MetaClaw pairs gated on AZR pass/fail. The `aware_azr_results` table currently has 0 rows (verified 2026-06-22 13:20 BST). So this rule is a no-op for the foreseeable future.
- Even when populated, the rule's "missing data → keep" policy means most pairs would pass through.

**Summary:** Under the default config, **every pair produced by the coordinator flows straight into the trainer** without any quality check beyond what the coordinator itself emits. The coordinator emits pairs with `verification.method: 'none'` and inverted PRM scores. The trainer would train on these pairs.

---

## Finding 3: AWARE 2.0 has no `verification.method: 'prm+content'` in production pairs (despite the live test response)

**Earlier documented evidence:** During the 2026-06-22 13:20 BST smoke test, the `curl /coordinate` response included `verification: {method: 'prm+content', passed: true, duration_ms: 87}` per the smoke test record in `<internal-doc>`.

**Contradicting evidence:** Reading the actual pair file (`/data/awareness-pairs/2026-06-22.jsonl`) shows `verification: {method: 'none', passed: True, duration_ms: 0}`. The response verification differs from the persisted pair verification.

**Hypothesis:** The `/coordinate` HTTP response surfaces a richer verification object (constructed in-flight by the coordinator's `http-server.js`) than what gets persisted to the JSONL pair file (constructed by the `logger.logPair()` function called inside the coordinator's pair-writing path). The HTTP response is a "what we did in this call" summary; the persisted pair is a "what we're storing for training" record. These two data paths may diverge on `method` and `duration_ms`.

**Implication for Path 1:** ADR-025 §Verification cites the smoke test `verification: prm+content, passed: true` as evidence the pair schema is solid. That evidence is about the response, not the persisted pair. The persisted pair has weaker verification metadata. ADR-025's verification claim needs revision.

---

## Finding 4: The trainer's second filter layer would throw at runtime — `toDpoDataset` not exported from heavy-think

**Source:** `~/src/AWARE/src/trainer/index.js` lines 592-598 (read 2026-06-22 14:12 BST), `~/src/heavy-think/src/index.js` exports (verified via dynamic import 2026-06-22 14:13 BST).

**The trainer pipeline has two filter layers:**
1. `outcome-filter.js` (lines 582-590 of trainer/index.js) — config-driven, default `noop`
2. Heavy-think's `toDpoDataset()` (lines 593-598 of trainer/index.js) — hard-coded `minScoreGap: 0.05`, `dedupeByHash: true`

ADR-028 originally argued that even with `outcome-filter.js` defaulting to `noop`, the heavy-think `toDpoDataset()` second layer would catch inverted pairs because `minScoreGap=0.05` would drop any pair with gap < 0.05 (the inverted pairs from Finding 1 have gap = -0.05 and -0.40, both < 0.05).

**Empirical verification 2026-06-22 14:13 BST:**
```
$ node -e "import('/Users/alfie/src/heavy-think/src/index.js').then(m => console.log(Object.keys(m)))"
Exports: [
  'K_CONFIGS', 'default', 'defaultKForTaskType', 'heavy_think',
  'parallelReasoning', 'refine', 'scoreWithPRM', 'shouldSkipDuplicate',
  'verify', 'writePreferencePair'
]
```

`toDpoDataset` is **NOT exported** from heavy-think. It is referenced in:
- `~/src/AWARE/src/trainer/index.js:593` — `const { toDpoDataset } = await import(config.heavyThink.path);`
- `~/src/AWARE/<internal-doc>` (multiple lines) — documentation
- `~/src/AWARE/docs/sop/sop-phase-4-dpo-dataset-pipeline.json` — phase 4 SOP

But it does not exist in heavy-think's source. The `preference-pair.js` module in heavy-think only exports `writePreferencePair` and `shouldSkipDuplicate` — no DPO dataset assembly.

**Implication:** If the operator flips `AWARE_TRAINER_ENABLED=1`, the trainer's `_packageDataset()` method would throw `TypeError: toDpoDataset is not a function` at line 594. This would be caught by the trainer's outer try/catch (line 540-543), which calls `_recordRunFailed()` — so the failure would be visible in `aware_training_runs` as a `failed` row, not a silent pass-through. But it would still mean the trainer cannot produce DPO datasets at all.

**Path 1 implication:** Path 1's framing assumes the trainer can fire when preconditions hold. Finding 4 says: **even after all quality gates are repaired, the trainer cannot run because its DPO assembly step is missing.** This is a separate failure mode from Findings 1-3 (which are about pair quality) — Finding 4 is about pipeline completeness.

**Composition with prior findings:** The trainer pipeline has 4 distinct failure points:
1. PRM inversion (Finding 1) — pair content is wrong
2. Outcome-filter noop default (Finding 2) — first filter layer doesn't catch wrong pairs
3. Verification metadata divergence (Finding 3) — pair metadata understates verification
4. `toDpoDataset` missing (Finding 4) — second filter layer cannot execute at all

Any one of these blocks trainer enablement. All four must be fixed before the trainer can run end-to-end with correct output.

---

## Composed failure mode under Path 1 default config

If the operator (under Path 1 reversal) flips `AWARE_TRAINER_ENABLED=1` and does not also:
1. Fix the PRM scoring inversion (or work around it via directionality-only filter)
2. Set `AWARE_TRAINER_FILTER_RULE=min_score_gap` (or a stricter rule) AND change the default from `noop` to `min_score_gap`
3. Fix the `verification.method` persistence to match the response
4. **Add `toDpoDataset` to heavy-think's exports** (or refactor trainer's `_packageDataset` to use the existing `writePreferencePair` + a new dataset-assembly function in AWARE itself)

Then:

1. OC agent calls `/coordinate`
2. Coordinator emits K=4 attempts, picks "best" by PRM score
3. PRM scoring is currently inverted (per Finding 1), so "best" is often the hallucinated/over-confident attempt
4. Coordinator persists a pair with `chosen = hallucinated answer`, `verification.method: 'none'`, `passed: true`
5. `outcome-filter.js` runs with default rule `noop` → keeps the pair
6. Trainer reads 100 such pairs, attempts to call `toDpoDataset` → **throws TypeError** at runtime (Finding 4)
7. Outer try/catch in `_submitNewRun` catches the throw → records `aware_training_runs` row with `status: 'failed'`
8. **No LoRA training happens.** The trainer's run history fills with `failed` rows but no checkpoint is produced.

The "successful" failure mode (no LoRA training) is at least safer than the "train on garbage" failure mode (which is what would happen if Finding 4 were fixed without also fixing Findings 1-3). But it still means Path 1's premise — "the trainer may now fire continuously" — is wrong. The trainer cannot fire at all in current code state, regardless of pair quality.

---

## What this means for the architectural state

| Assertion in Path 1 framing | Empirical reality (2026-06-22 14:13 BST) |
|---|---|
| "outcome-filter.js guards quality" | Default rule is `noop`. Filters don't run by default. |
| "PRM scores are real" | PRM scores exist numerically but are inverted on hedging-vs-hallucination. |
| "Verification pass non-trivial" | Persisted pairs have `verification.method: 'none'` even when response says `'prm+content'`. |
| "Chosen/rejected differentiated by content" | Differentiation is structural (different `prm_score` value) but the content selection is wrong (inverted). |
| "100-pair minimum as warmth check" | Holds. Not the problem. |
| "Trainer can fire when conditions hold" | **`toDpoDataset` is not exported from heavy-think. Trainer would throw at runtime even with repaired gates.** |

**Path 1's premise is structurally intact but empirically broken at every load-bearing joint.** The fix is not a single change; it's three coordinated fixes:
1. PRM scoring model behavior — the inversion on hedging-vs-hallucination
2. `outcome-filter.js` default — change from `noop` to `min_score_gap` with minGap=0.20 (stricter than today's 0.05)
3. Verification persistence — make the JSONL pair record carry the same `verification` as the HTTP response

---

## Recommendations (not commitments)

These are audit-level observations, not action commitments. ADR-029 (Trainer Re-enable Runbook + Quality Gate Repair, proposed) would be the place to commit to specific fixes.

1. **Hold `AWARE_TRAINER_ENABLED=0`** until all four findings are resolved.
2. **Change `outcome-filter.js` default from `noop` to `min_score_gap`** with a stricter `minGap=0.20`. This would have caught today's inverted pairs (gap = -0.05 and -0.40 both drop).
3. **Add a "directionality" check to `min_score_gap`** — drop any pair where `chosen.prm_score ≤ rejected.prm_score` (gap ≤ 0). This is a hard negative that current `min_score_gap` rule does not enforce.
4. **Reconcile response vs persisted verification metadata** — the HTTP response should not advertise `prm+content` verification if the persisted pair has `method: 'none'`. Either upgrade persistence or downgrade response advertising.
5. **Add `toDpoDataset` to heavy-think's exports** OR **refactor trainer's `_packageDataset` to assemble DPO rows in AWARE itself** (e.g., a new `src/trainer/dpo-dataset.js` module that doesn't depend on heavy-think). Option B is safer — keeps heavy-think as a K+S primitive, makes DPO assembly a trainer concern.
6. **Sample size is 2 pairs.** Before declaring a structural PRM inversion, gather ≥30 production pairs across varied problem types and verify the inversion is consistent. Pair 1 ("Reply with hello") is a degenerate case (single correct answer; PRM scoring may not be meaningful).
7. **Diagnose PRM inversion root cause.** Even after the workaround (directionality check), understanding WHY PRM ranks hedging answers lower than hallucinated ones matters. The PRM judge in `~/src/heavy-think/src/prm.js` may need re-prompting or model swap. Out of scope for ADR-029 but flagged as follow-on.

---

## Open Questions (for follow-on ADRs)

- **ADR-029 (proposed): Trainer Re-enable Runbook + Quality Gate Repair.** Step-by-step procedure for (a) diagnosing PRM inversion at scale, (b) upgrading `outcome-filter.js` defaults, (c) reconciling verification metadata, (d) the operator's go/no-go decision on flipping `AWARE_TRAINER_ENABLED=1` after fixes. This is the runbook ADR-024 §Open Questions #3 implicitly anticipated.
- **ADR-030 (proposed): PRM Calibration Methodology.** How do we measure whether PRM is correctly ranking chosen above rejected? What's the validation set? What's the acceptable inversion rate (current sample is 100%, but that's 2 pairs)? Out of scope for this ADR but flagged.

---

## Verification (so far)

- Read `~/src/AWARE/src/trainer/outcome-filter.js` in full. ✅
- Read `aware-2-coordinator:/data/awareness-pairs/2026-06-22.jsonl` (2 pairs). ✅
- Read AWARE coordinator `/config` and `/health` to confirm current state. ✅ (smoke test 2026-06-22 13:20 BST)
- Cross-referenced with `aware_conversations` and `aware_training_runs` Postgres tables (queries 2026-06-22 13:20 BST). ✅
- Cross-referenced with `<internal-doc>` §"D5 run attempt" / "Layer 3 outstanding" / "Newly surfaced" sections. ✅
- No code change required to fire this ADR. ✅

---

*Recorded by Orchestrator (Alfie) on behalf of operator (Alvin) "Continue" directive 2026-06-22. This ADR records an empirical finding under Path 1 reversal; it does not propose a fix. Path 1 reversal (ADR-027) remains valid as an architectural decision — the framing "AWARE 2.0 is a continuous flywheel" is correct; the operational gating (quality gates that actually work) is what needs repair before runtime enablement.*

*Archimedes review invited on the three coordinated fixes (PRM inversion, outcome-filter default, verification metadata). Without these fixes, the trainer should not be enabled regardless of Path 1.*