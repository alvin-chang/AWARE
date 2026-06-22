# ADR-029 — AWARE 2.0 Trainer Re-enable Runbook + Quality Gate Repair

**Status:** Proposed (drafted 2026-06-22 14:18 BST by Orchestrator Alfie on behalf of operator Alvin; for Archimedes Architect review)
**Date:** 2026-06-22
**Author:** Orchestrator (Alfie) on behalf of operator (Alvin) "Continue" directive
**Build phase:** A1 → A2 transition (Phase 4 deliverable)
**Relates to:** ADR-024 (partially reversed), ADR-025 (production chat model), ADR-027 (Path 1 reversal), ADR-028 (four quality-gate findings this runbook addresses)
**Implements:** ADR-024 §Open Questions #3 (re-evaluation trigger for the no-flywheel state) — now redefined under Path 1
**Supersedes:** Implicit assumption in ADR-027 §Path Selected that "outcome-filter.js + 100-pair minimum is sufficient gating" — it is not.

---

## Why this ADR exists

ADR-028 (accepted 2026-06-22 14:01 BST) records four empirical findings that block trainer enablement:

1. **PRM scoring inversion** (Finding 1) — chosen < rejected on hedging-vs-hallucination
2. **`outcome-filter.js` defaults to `noop`** (Finding 2) — first filter layer doesn't run
3. **Verification metadata divergence** (Finding 3) — response vs persisted pair
4. **`toDpoDataset` not exported from heavy-think** (Finding 4) — second filter layer throws at runtime

ADR-027 Path 1 reversal assumed "the trainer may fire continuously, gated only by quality filters." ADR-028 showed that **none of those filters work in current code state, and the trainer's DPO assembly step is missing entirely.** The trainer cannot run at all today, regardless of pair quality.

This ADR is the runbook for fixing all four findings, in dependency order, with verification steps. It is the operator's go/no-go checklist for flipping `AWARE_TRAINER_ENABLED=1` after fixes.

**The runbook is sequenced for safety:** each fix is independently verifiable, and the operator can stop after any step if the empirical evidence changes.

---

## Repair 1: Fix `outcome-filter.js` default + add directionality check

**Addresses:** Finding 2 (no-op default). Also covers the directionality gap in `min_score_gap` rule that allows ties to pass.

### Why first

This is the **cheapest, lowest-risk** fix. It's a code change in a single file with clear semantics, fully unit-testable, and immediately verifiable via the existing trainer's filter pipeline. No DB schema changes, no model behavior changes, no coordination with heavy-think.

### Changes

**File:** `~/src/AWARE/src/trainer/outcome-filter.js`

**Change A (line 98):**
```diff
- const rule = options.rule || 'noop';
+ const rule = options.rule || 'min_score_gap';  // safer default; explicit opt-in to noop
```

**Change B (line 167-176, `min_score_gap` case):**
```diff
  case 'min_score_gap': {
    const chosenScore = rec?.chosen?.prm_score;
    const rejectedScore = rec?.rejected?.prm_score;
    if (typeof chosenScore !== 'number' || typeof rejectedScore !== 'number') {
-     return { action: 'keep' };  // missing scores — don't penalize, let downstream decide
+     return { action: 'drop', reason: 'min_score_gap:missing_prm_scores' };
    }
-   const minGap = typeof options.minGap === 'number' ? options.minGap : 0.05;
-   const gap = chosenScore - rejectedScore;
-   // Use a small epsilon to match heavy-think's toDpoDataset convention
-   if (gap + 1e-9 < minGap) {
-     return { action: 'drop', reason: `min_score_gap:${gap.toFixed(4)}<${minGap}` };
-   }
-   return { action: 'keep' };
+   const minGap = typeof options.minGap === 'number' ? options.minGap : 0.05;
+   const gap = chosenScore - rejectedScore;
+   // Directionality check (NEW): drop any pair where chosen ≤ rejected
+   if (gap <= 0) {
+     return { action: 'drop', reason: `min_score_gap:inverted:${gap.toFixed(4)}<=0` };
+   }
+   // Magnitude check: drop if gap below threshold
+   if (gap + 1e-9 < minGap) {
+     return { action: 'drop', reason: `min_score_gap:${gap.toFixed(4)}<${minGap}` };
+   }
+   return { action: 'keep' };
  }
```

**Change C (config defaults — `~/src/AWARE/src/config/index.cjs` line 221):**
```diff
- get filterRule() { return str('AWARE_TRAINER_FILTER_RULE', 'noop'); },
+ get filterRule() { return str('AWARE_TRAINER_FILTER_RULE', 'min_score_gap'); },
```

And (line 227):
```diff
- get filterMinGap() { return num('AWARE_TRAINER_FILTER_MIN_GAP', 0.05, { min: 0, max: 1 }); },
+ get filterMinGap() { return num('AWARE_TRAINER_FILTER_MIN_GAP', 0.20, { min: 0, max: 1 }); },
```

### Verification (Repair 1)

1. Run existing unit tests: `cd ~/src/AWARE && pnpm test trainer/outcome-filter` (or `node --test src/trainer/__tests__/outcome-filter.test.js`).
2. Add a new test case asserting that today's inverted pair (gap = -0.05) is dropped with reason `min_score_gap:inverted:-0.0500<=0`.
3. Add a test case asserting that today's other inverted pair (gap = -0.40) is dropped with the same reason.
4. Add a test case asserting that a non-inverted pair with gap = 0.25 passes (above 0.20 default minGap).
5. Add a test case asserting that a non-inverted pair with gap = 0.15 is dropped (below 0.20).
6. Confirm the existing 17 passing tests still pass (no regressions in the kept-rules).
7. **Operator sign-off required** before proceeding to Repair 2.

### Operator decision points

- **`minGap = 0.20` vs `0.05`**: The current default of 0.05 is too lenient (would not have caught the gap=-0.05 inverted pair, only the gap=-0.40 one). The proposed 0.20 is stricter but means fewer pairs pass. ADR-028 recommends 0.20; Archimedes review may revise.
- **"Missing scores → drop" policy change**: The current code's "missing scores → keep" was a lenient policy to avoid dropping pairs when PRM scoring failed. The new policy "missing scores → drop" is stricter. This is a deliberate trade-off: we accept dropping some pairs (where PRM failed) in exchange for not training on pairs where we can't verify quality. Archimedes review may propose a third policy (e.g., "missing scores → quarantine for re-scoring").

---

## Repair 2: Reconcile verification metadata (response vs persisted pair)

**Addresses:** Finding 3. The persisted pair's `verification.method` is `"none"` while the HTTP response advertises `"prm+content"`. This is dishonest advertising — the trainer cannot trust the response verification, only the persisted pair's.

### Why second

This is a **small refactor** (one or two files), but it requires understanding two code paths in the coordinator (`http-server.js` and `logger.logPair()`). Verifying the fix requires end-to-end curl smoke test + persisted pair inspection. Lower risk than Repair 3 (model behavior) but higher than Repair 1.

### Changes

**Investigation:** Identify where the divergence happens. The hypothesis from ADR-028 §Finding 3:
- HTTP response: constructed in-flight by `coordinator/http-server.js` from the in-memory verification result
- Persisted pair: constructed by `coordinator/logger.logPair()` (or equivalent) at pair-write time

**Two acceptable fixes:**

**Option A (preferred):** Make the persisted pair carry the same `verification` object as the response.
- Modify `logger.logPair()` to accept a `verification` argument and include it in the JSONL record.
- Modify the call site (likely `coordinator/index.js` or `coordinator/refine.js`) to pass the same `verification` object that the HTTP response uses.
- Result: HTTP response and persisted pair have identical `verification` blocks.

**Option B (fallback):** Downgrade the HTTP response to match the persisted pair.
- Modify `coordinator/http-server.js` to construct its `verification` block from the same source the pair writer uses.
- Result: both report the same minimal `verification: {method: 'none', passed: True, duration_ms: 0}` (or whatever the coordinator's actual verification layer produces).

**Archimedes should pick:** Option A is preferred because it surfaces real verification work to the trainer. Option B is fallback if Option A's plumbing is too invasive.

### Verification (Repair 2)

1. After fix, run a new `curl /coordinate` smoke test:
   ```bash
   curl -X POST http://127.0.0.1:18081/coordinate \
     -H 'Content-Type: application/json' \
     -d '{"problem":"test","task_type":"standard"}' \
     | jq .verification
   ```
2. Capture the new pair file (`docker exec aware-2-coordinator ls -la /data/awareness-pairs/`) and read the new record:
   ```bash
   docker exec aware-2-coordinator cat /data/awareness-pairs/$(date -u +%Y-%m-%d).jsonl | tail -1 | jq .verification
   ```
3. **Assert: response and persisted `verification` blocks are equal.** If not equal, the fix is incomplete.
4. Document the new `verification.method` value in <internal-doc> (overwrite ADR-025's smoke-test citation).
5. **Operator sign-off required** before proceeding to Repair 3.

---

## Repair 3: Diagnose + work around PRM inversion

**Addresses:** Finding 1. The PRM judge ranks hedging answers lower than confident-but-hallucinated answers.

### Why third

This is the **highest-risk, hardest-to-verify** fix. PRM scoring depends on the PRM model (heavy-think's `prm.js`), the prompt template, and the candidate answers. Diagnosis requires gathering ≥30 production pairs and analyzing scoring patterns. The repair could be: (a) re-prompt the PRM, (b) swap the PRM model, (c) add a post-hoc scoring adjustment in the coordinator, or (d) accept the inversion and rely on Repair 1's directionality check to filter inverted pairs.

### Investigation steps (before any code change)

1. **Sample size:** Gather ≥30 production pairs by running 30+ `/coordinate` calls with varied problem types (security, code, reasoning, factual Q&A, single-word).
2. **Distribution analysis:** For each pair, record `chosen.prm_score`, `rejected.prm_score`, `gap`, `problem.length`, `task_type`, and a human-judged "which is better?" label. Save to `~/src/AWARE/eval-results/prm-inversion-study-2026-06-22.jsonl`.
3. **Calculate inversion rate:** `count(gap < 0) / count(total)`. If inversion rate is high (>50%), the issue is structural. If low (<20%), it may be domain-specific (e.g., single-word answers where confidence dominates).
4. **Categorize:** Are inverted pairs concentrated in:
   - Long answers (>500 chars)? → PRM may reward length
   - Specific technical details (Laravel, MQTT, etc.)? → PRM may reward specificity
   - Single-word correct answers? → Trivial case, not meaningful
   - Hedging language ("may", "might", "unverified")? → PRM may penalize epistemic honesty
5. **Report findings to ADR-030** (proposed: PRM Calibration Methodology) with the inversion study data.

### Acceptable outcomes

**Outcome A — Inversion is structural (>50% of pairs):** Root-cause fix is needed.
- **Repair 3a:** Re-prompt `prm.js` with explicit anti-hallucination clause ("penalize answers that assert specific technical details without verification").
- **Repair 3b:** Swap PRM model to a model that scores more conservatively (out of scope — requires Archimedes design).
- **Repair 3c:** Add a post-PRM scoring adjustment in the coordinator's `refine.js` that penalizes high-confidence answers when verification is "none" (i.e., apply a "trust gap" that's inversely proportional to verification rigor).

**Outcome B — Inversion is domain-specific (<20% of pairs):** Workaround is sufficient.
- **Repair 3d:** Add a per-task-type PRM calibration map in `prm.js` (e.g., `task_type: 'security'` → use stricter PRM; `task_type: 'standard'` → use default PRM).

**Outcome C — Inversion is rare but real (<5%):** Directionality check from Repair 1 is sufficient. Skip Repair 3 entirely.

### Verification (Repair 3)

1. After Repair 3a/b/c/d, re-run the ≥30-pair inversion study.
2. **Target:** inversion rate drops to <10% (from baseline, whatever it was).
3. If target not met, revert Repair 3 and rely on Repair 1's directionality check as the only guard.
4. **Operator sign-off required** before proceeding to Repair 4 (regardless of outcome).

### Operator decision points

- **Time investment:** The inversion study requires ~30-60 minutes of curl calls + analysis. Archimedes may prefer to skip the study and jump to Repair 3a (re-prompt PRM) directly. Trade-off: study gives evidence-based decision; jumping to fix is faster but may miss the root cause.
- **Repair 3c (post-hoc adjustment)** is the most pragmatic — it doesn't require modifying the PRM model, just adding a coordinator-side scoring adjustment. But it's the most "compensating for broken upstream" of the options.

---

## Repair 4: Implement `toDpoDataset` (or refactor trainer's DPO assembly)

**Addresses:** Finding 4. The trainer's `_packageDataset()` references `toDpoDataset` which doesn't exist in heavy-think.

### Why fourth

This is the **largest code change** of the four repairs. It either adds a function to heavy-think (touches a sibling repo's API) or refactors the trainer to assemble DPO rows internally (touches AWARE's trainer module). Either way, it's a multi-file change with integration testing required.

By the time we get here, Repairs 1-3 have been verified, so the trainer is processing higher-quality pairs. The integration test can focus on the DPO assembly shape (does the JSONL Modal receives match the expected format?) rather than pair quality.

### Recommended fix (Option B from ADR-028 §Finding 4)

**Create a new module:** `~/src/AWARE/src/trainer/dpo-dataset.js`

This module exports a `toDpoDataset(records, options)` function that:
1. Accepts filtered preference records (from outcome-filter + Repair 1's directionality)
2. Filters by `minScoreGap` (configurable, default 0.05 — same as heavy-think's old hard-coded value)
3. Dedupes by `_content_hash`
4. Transforms each record into a DPO row in "messages" format:
   ```json
   {"messages": [
     {"role": "user", "content": "<problem>"},
     {"role": "assistant", "content": "<chosen.reasoning>"}
   ], "rejected_response": "<rejected.reasoning>"}
   ```
5. Returns `{rows, skipped: {lowGap, duplicate, invalid}}`

**Modify trainer/index.js (line 593):**
```diff
- const { toDpoDataset } = await import(config.heavyThink.path);
+ const { toDpoDataset } = await import('./dpo-dataset.js');
```

This keeps heavy-think as a K+S primitive (its actual job) and makes DPO assembly a trainer concern (where it logically belongs). The trainer is the only consumer of DPO-shaped output; it shouldn't depend on a sibling repo for that shape.

### Verification (Repair 4)

1. Unit test the new module with:
   - Empty input → empty rows
   - Single valid pair → 1 row in messages format
   - Pair with low gap → skipped
   - Pair with duplicate content hash → second occurrence skipped
   - Malformed pair (missing fields) → invalid, skipped
2. Integration test: manually invoke trainer's `_packageDataset()` (with mock pool + mock logger) on the existing `2026-06-22.jsonl` data. Verify it returns valid `{rowsWritten, rowsDropped, sourceFilesRead}` and the JSONL output parses as DPO rows.
3. **Smoke test the trainer end-to-end** (without enabling production):
   - Set `AWARE_TRAINER_ENABLED=1` on the trainer container
   - Set `AWARE_TRAINER_MIN_PAIRS_PER_RUN=2` (temporarily, to trigger fast)
   - Wait for one polling cycle
   - Verify `aware_training_runs` has a new row (status: 'pending' → 'running' → 'completed' or 'failed')
   - Verify Modal job was submitted (check `aware_training_runs.modal_job_id`)
   - If 'failed': read `error_message` column; diagnose; revert.
   - If 'completed': verify a new LoRA checkpoint was produced at `/opt/aware/weights/active`.
4. **Operator sign-off required** before flipping `AWARE_TRAINER_ENABLED=1` for production.

### Operator decision points

- **Modal cost:** Running a smoke test on Modal incurs GPU cost (A100-80GB at ~$2/hr). The smoke test should use `n_pairs=2` (minimum) to keep cost low (~5 min × $2 = $0.17). Operator may want to skip the smoke test and rely on unit + integration tests.
- **Checkpoint staging:** The trainer's atomic-symlink-swap (`/opt/aware/weights/active`) means a successful smoke test will replace the current LoRA pointer. If the smoke test LoRA is bad, the coordinator will start using it on next `/coordinate` call. Operator may want to backup the current `/opt/aware/weights/active` before the smoke test.

---

## Operator's go/no-go checklist (after all four repairs)

Before flipping `AWARE_TRAINER_ENABLED=1` for production:

- [ ] **Repair 1 verified:** outcome-filter default changed to `min_score_gap` with directionality check; all unit tests pass; today's two inverted pairs would be dropped.
- [ ] **Repair 2 verified:** HTTP response and persisted pair have identical `verification` blocks (asserted via curl + docker exec cat).
- [ ] **Repair 3 verified:** Inversion rate dropped to <10% on ≥30-pair study (or Repair 3 explicitly skipped with directionality check as the only guard).
- [ ] **Repair 4 verified:** New `dpo-dataset.js` module tested (unit + integration); trainer's `_packageDataset()` runs without TypeError; smoke test produced a valid LoRA checkpoint.
- [ ] **Operator runbook review:** This ADR reviewed by Archimedes; all four repair decisions documented in <internal-doc>.
- [ ] **Rollback procedure:** Operator knows the reverse of each repair (revert env vars, revert code changes, restore backup LoRA at `/opt/aware/weights/active`).

If any box is unchecked, **do not flip `AWARE_TRAINER_ENABLED=1`**. Path 1's continuous-flywheel framing remains valid; runtime enablement remains gated on these four repairs.

---

## Rollback procedure (if trainer fires and produces bad LoRA)

The risk: trainer runs successfully, replaces LoRA at `/opt/aware/weights/active`, and the new LoRA degrades `/coordinate` quality.

**Step 1:** Flip `AWARE_TRAINER_ENABLED=0` immediately. The trainer's kill switch is re-read on every poll (`AWARE_TRAINER_ENABLED` line 200 of config/index.cjs).

**Step 2:** Identify the previous LoRA. The trainer's atomic-symlink-swap should leave the previous checkpoint at a sibling path (e.g., `/opt/aware/weights/previous`). If not, the operator may have a recent backup (if Repair 4's verification step created one).

**Step 3:** Manually restore the previous symlink:
```bash
docker exec aware-2-trainer ls -la /opt/aware/weights/  # find previous
docker exec aware-2-trainer ln -sfn /opt/aware/weights/<previous-id> /opt/aware/weights/active
```

**Step 4:** Verify `/coordinate` quality on a smoke-test problem (use the "What is AWARE 2.0?" probe from ADR-028 §Finding 1). If quality is restored, rollback is complete. If not, the previous LoRA was already bad — escalate to Archimedes.

**Step 5:** Document the rollback in <internal-doc> with timestamp, root cause, and any new findings.

---

## Open Questions (for follow-on ADRs)

- **ADR-030 (proposed): PRM Calibration Methodology.** What's the validation set for PRM scoring? What's the acceptable inversion rate? How do we measure whether PRM is improving over time? Out of scope here.
- **ADR-031 (proposed): Quarterly Cadence Automation.** ADR-024 §Open Questions #2 still applies — even under continuous flywheel, quarterly cadence is "warm pipeline insurance." This runbook enables the flywheel; ADR-031 enables the cadence.
- **ADR-032 (proposed): Modal Cost Budget.** The trainer's Modal jobs cost real money. What's the operator's monthly budget? How do we cap Modal spend? Out of scope here.

---

## Verification (so far)

- All four ADR-028 findings have proposed repairs in this ADR. ✅
- Repair sequencing is dependency-safe (1→2→3→4 with operator sign-off between each). ✅
- Repair 1's code changes are small (one file, ~10 lines diff). ✅
- Repair 4's recommended approach (new `dpo-dataset.js` module in AWARE) avoids touching heavy-think. ✅
- No code changes proposed in this ADR — it's a runbook, not an implementation. The implementation happens in follow-up commits after Archimedes review.

---

*Drafted by Orchestrator (Alfie) on behalf of operator (Alvin) "Continue" directive 2026-06-22 14:18 BST. Status: Proposed. Archimedes review invited on: (a) the four-repair sequencing, (b) the `minGap=0.20` choice, (c) the directionality check policy, (d) the new `dpo-dataset.js` module design, (e) the operator's go/no-go checklist.*

*Operator (Alvin) decision points are clearly marked. The runbook is intended to be read top-to-bottom once, then executed repair-by-repair with verification between each.*