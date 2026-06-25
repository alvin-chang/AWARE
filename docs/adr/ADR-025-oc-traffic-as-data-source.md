# ADR-025 — <runtime> Agent Traffic as AWARE 2.0 Data Source (Draft)

**Status:** **DRAFT — pending operator decision.** Not approved, not committed.
**Date:** 2026-06-22
**Author:** the coordinating agent draft on behalf of operator (Alvin) — for Architect (Architect) review.
**Build phase:** A1 (continuing)
**Supersedes:** Nothing yet — this ADR proposes the path forward; supersedes any prior assumption only on operator confirmation.
**Related:** ADR-023 (HeavySkill not flywheel), ADR-024 (no continuous flywheel), ADR-020 §"Two-Pipeline Architecture," ADR-022 (HeavySkill v2 plugin), and the operator's 2026-06-22 (B) selection "Full AWARE 2.0 stack — bring up the 5-service compose, add OC plugins for coordinator + PRM cache + DPO trainer + awareness-pairs, wire OC agent traffic as the data source."

---

## Context

This ADR exists because the operator's 2026-06-22 (B) selection directly names a goal — "wire OC agent traffic as the data source (replace the killed HeavySkill-flywheel with the new-as-yet-undesigned flywheel)" — that is **incompatible with ADR-024's current canonical state**. ADR-024 §Decision: *"AWARE 2.0 has no continuous data flywheel. The trainer poller ... remains the canonical trigger mechanism, but it is gated on three preconditions that do not currently hold."*

ADR-024 §Open Questions #3 specifies the **re-evaluation trigger** for ending the no-flywheel state: *"production chat model deployed AND ≥1000 real preference pairs in `aware_conversations` AND ≥1 successful v15+ LoRA deployment via the coordinator's model router."*

So the question is: does the operator's (B) selection override ADR-024 (a new decision supersedes the no-flywheel decision), or does it operate within ADR-024's frame (a new way to satisfy one of the three preconditions, without reintroducing a continuous flywheel)?

These are not the same decision. They have different consequences, different risks, and different costs. This ADR names the contradiction explicitly so the operator can resolve it before any integration work proceeds.

---

## What "wire OC agent traffic as the data source" means (as I read it)

Two plausible interpretations:

### Interpretation 1 — Continuous flywheel (overrides ADR-024)

OC agent calls flow → AWARE 2.0 records the call → AWARE 2.0 emits preference pairs (chosen vs rejected based on agent acceptance/edit) → pairs land in `aware_conversations` → trainer poller fires → D5 run consumes pairs → LoRA checkpoint updates → coordinator's `/version` returns new LoRA → OC agents load new LoRA on next call. **Closed loop.**

This is what ADR-023 (HeavySkill not flywheel) explicitly closed and what ADR-024 (no continuous flywheel) explicitly said is not the design. Reinstating it requires either:
- Superseding ADR-024 with this ADR and renaming the three preconditions to include "OC agent traffic as continuous source," or
- Deciding that the operator's reversal (2026-06-19) captured in ADR-023/024 is itself being reversed now.

### Interpretation 2 — Periodic batch retraining (within ADR-024's frame)

OC agent calls flow → AWARE 2.0 records the call → pairs accumulate in `aware_conversations` (Postgres table inside the 5-service compose stack) → when ≥ `AWARE_TRAINER_MIN_PAIRS_PER_RUN` (default 100) pairs accumulate, the trainer poller fires → D5 run consumes pairs → LoRA checkpoint updates. **Bounded loop with a real trigger.**

This honors ADR-024 §Decision as written: there is still no *continuous* flywheel (the trainer waits for the pair count to cross the threshold), but OC agent traffic *is* now a real source that can satisfy precondition 2. The other two preconditions (production chat model deployed, `/version` wired to model router) still stand and still gate trainer re-enable.

This interpretation is what ADR-024 §Open Questions #4 *kind of* anticipates: *"A2A agents that call AWARE for security reasoning are potential real-traffic sources ... could become the production model consumer. Out of scope for this ADR but flagged for cross-ADR awareness."* If OC agents are the A2A agents in question, then (B) is the "out of scope" follow-on that ADR-024 flagged but didn't decide.

---

## What is actually on disk (verified 2026-06-22)

| Component | State | Source |
|---|---|---|
| AWARE 2.0 branch | `feature/aware-2.0` at `d2ca39a` on local and Gitea (just pushed) | `git log` |
| HeavySkill paper-faithful K+S | Shipped in commits `2fda655` + `d2ca39a` (no longer passthrough) | AWARE commits |
| HeavySkill live in gateway | Yes — recent traces at `2026-06-22T12:58:14+01:00` (today, minutes ago) | `<host-config>/logs/gateway.log` |
| <runtime> `extensions/heavyskill/` working tree | **Deleted** in working tree, uncommitted; live install is at a separate path | `git -C <HOME>/src/<runtime> status` |
| OC repo divergence from origin | `main` is 10916 ahead, 65 behind — mid-refactor, not a stable editing surface | `git status` |
| OC working tree clean to touch? | **No** — divergent, heavyskill extension deletion pending, doc churn | `git diff --stat` |
| `<heavyskill-plugin-source>/` | Functional repo, branch `main`, last commit `adf8518` ("test: add strategy integration tests + fix baseStreamFn await bug"), v5 PRM scaffold landed (`948d3bd`), v4 source reconciliation landed (`f14ee60`) | `git log` |
| 5-service compose stack | Code-complete, **never run**, trainer at `AWARE_TRAINER_ENABLED=0` | `docker-compose.coordinator.yml:312` |
| Trainer | Smoke-tested 2026-06-13, run `run-1781341473932-cl85ug`, status `ok` | <internal-doc> §"D5 run attempt" |
| `aware_conversations` table | Empty (the only writer is gated on non-passthrough pair_path return; OC shim was passthrough until `2fda655`) | <internal-doc> |
| HeavySkill pair writer | Producing garbage pairs (`passthrough call #8 for model=minimax/primary-model`, fabricated PRM scores) → JSONL only, not Postgres | ADR-024 §"Context #3" |
| <internal-doc> outstanding list | **Stale** — says wrap is "still passthrough" and "Gitea push still pending"; both are false since `2fda655` + `d2ca39a` | <internal-doc> §"Layer 3 outstanding" |
| ADR-023 + ADR-024 in code | Yes, committed (`24d82ee docs(ADR): 023 HeavySkill-not-flywheel + 024 no-continuous-flywheel`) | git log |

---

## The decision space

Three concrete resolution paths the operator can pick from. Each has a distinct ADR-025 status implication.

### Path 1 — Override ADR-024 (Continuous flywheel from OC traffic)

- **Status of ADR-025**: Accepted; ADR-024 changes to "Superseded by ADR-025"
- **What changes**: AWARE 2.0 has a continuous flywheel sourced from OC agent traffic. The three preconditions in ADR-024 are replaced with a single condition: the loop is wired and observed producing data.
- **Cost**: Higher compute, higher risk. Continuous loop means every OC agent call writes to `aware_conversations`; trainer fires automatically when threshold met; LoRA updates automatically. Failure modes compound.
- **Risk**: The 2,265-restart-loop failure mode of the trainer (which is why `AWARE_TRAINER_ENABLED=0` exists) was never root-caused per ADR-024. Re-enabling on a continuous loop re-exposes that risk at higher throughput.
- **Who needs to act**: Operator (Alvin) explicitly approves ADR-024 → Superseded. Architect (Architect) drafts revised decision record. the coordinating agent implements the loop, monitors it, and surfaces regressions.

### Path 2 — Bring up stack within ADR-024 (Bounded loop, OC traffic as source)

- **Status of ADR-025**: Accepted; ADR-024 stays canonical; ADR-025 is the "OC traffic satisfies precondition 2" follow-on.
- **What changes**: AWARE 2.0's 5-service compose stack runs (gateway/coordinator/UI/db/trainer); OC agent calls feed `aware_conversations` when ≥100 pairs accumulate; trainer fires on the existing poller; LoRA updates on demand (not continuously). The three preconditions in ADR-024 stand, with this ADR satisfying precondition 2.
- **Cost**: Lower compute, lower risk. Loop is bounded by the existing `AWARE_TRAINER_MIN_PAIRS_PER_RUN=100` threshold and the existing quarterly cadence per ADR-024 §"Compliance cadence."
- **Risk**: If OC traffic doesn't accumulate real pairs (e.g. agents don't differentiate "chosen" from "rejected" enough, or pair schema doesn't capture signal), the loop is dormant indefinitely. Same risk as the HeavySkill pair writer today.
- **Who needs to act**: Operator (Alvin) approves ADR-025 as the OC-traffic = precondition-2 follow-on. Architect signs off on schema (chosen/rejected differentiation; PRM extraction or removal; verification pass non-trivial — per ADR-024 §"Precondition 2"). Stack is brought up, wires OC traffic source, monitors pair accumulation.

### Path 3 — Stand up stack, defer flywheel design (Defer ADR-025)

- **Status of ADR-025**: Deferred (this draft kept on file as a record of the operator's (B) signal; resolution postponed).
- **What changes**: 5-service compose stack runs with trainer off (per ADR-024). Pair store stays empty. OC traffic integration deferred — no `aware_conversations` writes from OC. Model improvements happen only via AZR batch / <meta-rl-pipeline> batch / hand-curated batch per ADR-024 §"Open Questions #1."
- **Cost**: Lowest. No new architecture decisions. Operator gets the stack running and visible; can experiment with what's already wired (PRM cache, awareness-pairs store reads, coordinator API).
- **Risk**: Stack runs without producing data. If pair store stays empty for the quarterly review cadence, ADR-024 §"Compliance cadence" triggers a "trigger one as part of the cadence" — but with what pairs? (AZR is unimplemented; <meta-rl-pipeline> is unimplemented; hand-curated batch is operator burden.)
- **Who needs to act**: Operator picks (B2/Path 3) over (B1/Path 1) and (B3/Path 2). Stack is brought up, surfaces the empty-pair-store situation honestly on the next quarterly review.

---

## My recommendation

**Path 2.** Reasoning:

1. It honors ADR-024 as written (the no-continuous-flywheel decision was deliberate and operator-confirmed per ADR-024 §Status).
2. It satisfies the operator's (B) goal — "wire OC agent traffic as the data source" — within ADR-024's frame, by making OC traffic the concrete instance of "real-traffic source" that ADR-024 §Open Questions #4 anticipated.
3. It reuses existing infrastructure (`AWARE_TRAINER_MIN_PAIRS_PER_RUN=100` threshold, quarterly cadence, the trainer smoke-tested 2026-06-13) rather than introducing new continuous-loop machinery.
4. Path 1 has the 2,265-restart-loop risk unaddressed. Path 3 doesn't actually integrate OC traffic at all (defeats the spirit of (B)).

But the cost of Path 2 is real: the HeavySkill pair writer today emits garbage (ADR-024 §"Context #3"). Making it emit *real* pairs (chosen/rejected differentiated by content; PRM scores from real extraction or removed; verification pass non-trivial) is non-trivial work that needs a schema design and an Architect sign-off. That schema design is the actual unblock for this ADR to be implementable, not the ADR itself.

---

## What I will NOT do without explicit operator sign-off on ADR-025

- Bring up the 5-service compose stack (changes host port bindings, adds Postgres + Redis + Ollama + Trainer processes; visible to other agents; touches gateway config indirectly via awareness-pairs wiring).
- Touch the <runtime> `extensions/heavyskill/` working tree (it's mid-refactor, 10916 commits ahead of origin, not mine to touch).
- Modify `<heavyskill-plugin-source>/` (separate repo, separate working tree, not part of this integration scope).
- Add new <runtime> plugin entries for AWARE 2.0 coordinator / PRM cache / DPO trainer / awareness-pairs (each is a new plugin manifest; each requires gateway restart; per AGENTS.md this is the high-impact collaboration class).

---

## Files involved

- This ADR exists at `docs/adr/ADR-025-oc-traffic-as-data-source.md` as a draft (status=Draft).
- Companion to (not replacement for): `docs/adr/ADR-023-no-heavyskill-as-flywheel.md`, `docs/adr/ADR-024-no-continuous-flywheel.md`.
- The stale "Layer 3 outstanding" section in `<internal-doc>` should be updated to reflect that the passthrough wrap and Gitea push are now closed. That update is follow-on work and requires an operator decision on this ADR (because the next outstanding item depends on which path is picked).

---

*Drafted by the coordinating agent (Alfie) on operator reversal/continuation signal 2026-06-22. Status: Draft — pending operator decision on Path 1 / Path 2 / Path 3. Architect review invited. Once operator picks a path, ADR-025 status moves from "Draft" to "Accepted" or "Rejected," and the corresponding follow-on work proceeds under explicit collaboration.*