# ADR-024 — AWARE 2.0 Has No Continuous Data Flywheel

**Status:** Proposed
**Date:** 2026-06-21
**Author:** Archimedes (Architect) on behalf of operator "Continue" directive (2026-06-21)
**Supersedes:** Implicit "continuous improvement" assumption in ADR-020 §Decision 1 (AZR + MetaClaw + HeavySkill-as-flywheel); follows from ADR-023 (HeavySkill not the flywheel) by naming what *is*.
**Complementary:** ADR-022 (HeavySkill v2 plugin implementation stands — K+S is opt-in tool, not a flywheel); ADR-023 (HeavySkill not the flywheel — *what is*?).
**Build phase:** A1 (continuing)

---

## Context

ADR-020 commits AWARE 2.0 to two RL pipelines (AZR self-play on Modal + MetaClaw dialogue) feeding a shared weight store via DPO fine-tuning. ADR-023 closed the question "is HeavySkill the flywheel?" with **no**. This ADR answers the follow-on "what is?"

By 2026-06-21, the actual state is:

1. **The trainer pipeline is proven end-to-end (2026-06-13).** Smoke test drove a real DPO training run on Modal A100-80GB with 5 synthetic pairs, trained-model base model, LoRA r=16/α=16/dropout=0.05. Run completed: `{"event": "job_end", "status": "ok", "run_id": "run-1781341473932-cl85ug"}`. Merged checkpoint is 8182.1MB and loadable. Bug ledger (1-9) closed in commits `40d383e`, `8110033`, `d5d7b1a`, `50742ee`, `1f2286c`. **The engineering pipeline works.**
2. **Trainer is currently off by policy.** `AWARE_TRAINER_ENABLED=0` in `docker-compose.coordinator.yml:312`. Trainer container boots clean post-`927d68a` (env audit 2026-06-13), but no run is submitted because the gate is `AWARE_TRAINER_MIN_PAIRS_PER_RUN=100` (line 314) and the source of pairs (`aware_conversations` Postgres table) is **empty** — <internal-doc> §"D5 run attempt": "v2 postgres: empty `aware_conversations` table".
3. **The writer IS writing, but emitting garbage.** `<host-config>/awareness-pairs/2026-06-17.jsonl` (the only file in the dir, 2,110 bytes) contains 3 pairs with placeholder reasoning strings ("passthrough call #8 for model=minimax/primary-model"), fabricated PRM scores (0.75, 0.5, 1), and `verification.method: "none"`. This is because `wrapHeavyskillInferenceStream` in the OC shim is **still a passthrough** (<internal-doc> §"Layer 3 outstanding": "returns `ctx?.streamFn` unchanged. The paper-faithful K-Parallel + Summarize implementation is delivered in a follow-up patch.") — so "chosen" and "rejected" are not differentiated by content, only by which model produced them. The Postgres `aware_conversations` table doesn't even receive these garbage rows because the coordinator's `logger.logPair({ pair_path: result.pair_path || null })` only writes a row when the heavy-think envelope returns a real `pair_path` (commit `db78a2d` flywheel fix). Garbage pairs land in JSONL, not DB.
4. **No production chat model.** The v14 LoRA (`qwen35-9b-dpo-smoke-v14`) is a 5-pair smoke-test artifact. Status §"Phase 2 — MetaClaw Integration + HeavySkill Production" lists every Phase 2 deliverable except HeavySkill (which shipped) as `[ ]`. Phase 1 (Coordinator Foundation) has six `[ ]` items including "Hello-world task: user prompt → coordinator → worker → response." **There is no AWARE chat model running in production to consume training signal.**
5. **AZR self-play is unimplemented.** Phase 3 checklist (`<internal-doc>` lines 71-79): all eight items `[ ]`. The Modal app `aware-trainer` (ap-1tBuAGUUdYjxqwMQiyKzYD) is deployed with 0 GPU minutes used. AZR executor, Modal training Dockerfile, proposer/solver/verifier prompts, self-play loop, DPO training on Qwen 2.5 7B, synthetic task corpus — none of this exists.
6. **MetaClaw is unimplemented.** Phase 2 §"Conversation logger hook into <runtime> session lifecycle" is `[ ]`. The operator dialogue batch that would feed MetaClaw DPO is not being captured.
7. **The IUK TRL 7 blocker persists.** Scout's 8 June stress test flagged "no operational deployment evidence" as the gate for TRL 7. No production deployment exists; IUK re-application cannot claim TRL 7 until one does.

The 19 June reversal (ADR-023) caught the gap between *stated intent* (HeavySkill as flywheel) and *actual state* (no producer, no consumer, no model). This ADR catches the gap between *ADR-020 §Decision 1's framing* (AZR + MetaClaw + HeavySkill as flywheel) and the same actual state — the *stated intent* that **something** is a continuous flywheel is wrong, not just the specific claim that HeavySkill is it.

---

## Decision

**AWARE 2.0 has no continuous data flywheel.** The trainer poller (proven by 2026-06-13 smoke test) remains the canonical trigger mechanism, but it is **gated on three preconditions** that do not currently hold:

1. A production chat model running and serving user requests.
2. ≥ `AWARE_TRAINER_MIN_PAIRS_PER_RUN` (default 100) **real** preference pairs in `aware_conversations` (real = chosen/rejected differentiated by content, not passthrough placeholders; PRM scores from real extraction or removed; verification pass non-trivial).
3. A `/version` endpoint reporting the active LoRA checkpoint is wired to the coordinator's model router (`AWARE_TRAINER_WEIGHTS_DIR` integration — <internal-doc> §"D5 run attempt" line ~710: "1-line change in coordinator's model router").

**Until all three preconditions hold:**

- Trainer container stays at `AWARE_TRAINER_ENABLED=0`.
- `AWARE_LORA_WIRED` stays a partial signal (wire-up echo exists, but no production model).
- v14 LoRA smoke artifact remains the most recent training run; no v15 until a real D5 run with real data.
- Model improvement happens on **demand** (operator triggers an AZR batch, a MetaClaw batch, or a hand-curated batch) or on a **fixed compliance cadence** (recommended: quarterly review, see Consequences §3).

**HeavySkill wrap hook remains a separate, opt-in shipping surface** per ADR-022. The follow-up patch to implement paper-faithful K-Parallel + Summarize in `wrapHeavyskillInferenceStream` (<internal-doc> §"Layer 3 outstanding") is **not blocked** by this ADR — that work proceeds independently. When the patch lands, the writer will emit real pairs (assuming the wrap is configured to fire, per ADR-022's 4 activation surfaces). Whether those pairs flow into `aware_conversations` (DB) for the trainer is a separate decision covered by preconditions 1-2 above.

---

## Consequences

### Positive

- **Honest scope.** Future sessions reading the ADRs will not rediscover the gap between "AWARE 2.0 has a flywheel" and "AWARE 2.0 has no flywheel." The product brief at `<host-config>/projects/aware-evolution-2/AWARE-PRODUCT-BRIEF.md` describes AWARE 2.0 as "Adaptive Workflow Agent with Recursive Evolution" — the "Recursive Evolution" framing is now explicitly **demand-driven, not continuous**.
- **No flywheel engineering.** The cost of standing up AZR self-play as a continuous producer (Modal compute, Proposer/Solver/Verifier prompt maintenance, failure-mode surface) is **deferred** to the demand-trigger case. If quarterly batch retraining is sufficient, the Phase 3 build is much smaller (batch runner + verifier, not self-play loop + automated corpus generation).
- **Trainer stays intentionally dormant.** `AWARE_TRAINER_ENABLED=0` is a recorded architectural choice, not a kill-switch recovery action. Re-enabling requires the three preconditions; that re-enabling is an event, not an accident.
- **HeavySkill remains useful.** Removing the flywheel responsibility does not remove HeavySkill. The plugin is a K+S operator tool per ADR-022; its value is unchanged.

### Negative

- **No continuous improvement path.** Until preconditions 1-3 hold, AWARE 2.0's model can only improve when an operator triggers an explicit retraining run. The implicit "model gets better every day" promise of a flywheel is not delivered.
- **The "Recursive Evolution" framing is weaker.** A demand-driven retraining cycle is *evolution*, but it is *not recursive* (no consumer → trainer loop). The product brief's name is now partly aspirational; this ADR records the gap rather than papering over it.
- **Phase 3 + Phase 4 scope is open.** AZR self-play and MetaClaw remain the *named* producers in ADR-020 §Decision 1, but this ADR removes the implicit obligation to keep them continuously running. They can be built as batch pipelines (trigger on demand) without the continuous-loop infrastructure. The D5 runbook (smoke-tested 2026-06-13) already supports this — `run-phase4-d5.sh` is operator-triggered.
- **IUK TRL 7 timeline depends on production model.** The "no operational deployment evidence" blocker (Scout 8 June) persists until preconditions 1-3 hold. IUK re-application timing is decoupled from "flywheel works" timing.

### Compliance cadence (recommendation, not a hard rule)

For audit/compliance reasons (CSA UK Chapter posture, Good CISO Ltd grant readiness), AWARE 2.0 should adopt a **quarterly review cadence**:

- Every 90 days: operator (Alvin) reviews (a) `aware_conversations` row count, (b) `aware_training_runs` history, (c) `/version` reporting whether the active LoRA is current. If a real-D5 run with real data has not happened in the prior 90 days, **trigger one** as part of the cadence — even if just to keep the pipeline warm and to produce evidence for IUK TRL 7.
- The cadence is recorded in this ADR; the actual schedule lives in the operator's calendar, not in the codebase. (Automation of the cadence trigger is a P0.5+ candidate; see Open Questions.)

This is **not** a flywheel. It is a scheduled batch retraining cycle. The distinction matters: a flywheel produces data; a cadence consumes data already produced. AWARE 2.0 in this state has the latter, not the former.

---

## Verification (so far)

- Trainer pipeline proven end-to-end (smoke test 2026-06-13, commit `8110033` + run `run-1781341473932-cl85ug`) ✅
- Trainer boot path resolved (env audit 2026-06-13, commit `927d68a`) ✅
- Data flywheel write-side proven (3 rows with non-NULL `pair_path` after commit `db78a2d` fix) ✅ — but pairs are passthrough garbage, not real K-Parallel output
- 307/307 unit tests pass (per <internal-doc> §"Trainer environment audit" verification)
- 89.64% line coverage, 81.61% branch coverage (gate passing)
- 4/4 security scans PASS (gitleaks, trivy, npm-audit, bandit)
- Modal app `aware-trainer` deployed with 0 GPU minutes used (ap-1tBuAGUUdYjxqwMQiyKzYD)
- Trainer container currently stopped (off by policy, not by bug) ✅

This ADR does not require code changes. It is a recording of architectural state + a forward-looking decision. The next code changes that *would* matter are: (a) paper-faithful K-Parallel in `wrapHeavyskillInferenceStream` (Layer 3 follow-up), (b) production chat model deployment (Phase 1 deliverables), (c) coordinator model router integration of `AWARE_TRAINER_WEIGHTS_DIR` (Phase 1 line).

---

## Commits

None yet. This ADR is the canonical record of the no-continuous-flywheel decision. <internal-doc> should be updated to reflect this; that is follow-on work.

---

## Open Questions (for follow-on ADRs)

1. **ADR-025 (proposed): Production chat model deployment strategy.** Where does the AWARE 2.0 chat model run? What is the consumer (operator direct calls? Telegram group sessions? An <runtime> agent harness)? When does D5 with real data happen? What does success look like (latency, throughput, model quality delta vs base)?
2. **ADR-026 (proposed): Quarterly cadence automation.** Is the cadence hard-coded (cron-driven D5 runbook trigger), operator-driven (calendar entry only), or skipped entirely until preconditions hold? If automated, what does the audit trail look like (logs, run summaries, /version snapshots)?
3. **Re-evaluation trigger for this ADR.** When does "no flywheel" become "flywheel" again? Proposed trigger: production chat model deployed AND ≥1000 real preference pairs in `aware_conversations` AND ≥1 successful v15+ LoRA deployment via the coordinator's model router. Until then, this ADR stands.
4. **Interaction with the OpenFang / Hermes / A2A agent ecosystem.** A2A agents that call AWARE for security reasoning are potential real-traffic sources. If an AWARE-backed A2A skill ships and gets usage, that could become the production model consumer. Out of scope for this ADR but flagged for cross-ADR awareness.

---

*Recorded by Archimedes (Architect) on behalf of operator "Continue" directive at 2026-06-21 16:34 UTC. Status: Proposed — pending operator confirmation that this ADR accurately captures the no-continuous-flywheel decision, separate from ADR-023's no-HeavySkill-as-flywheel decision.*