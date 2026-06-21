# ADR-023 — HeavySkill Is No Longer the AWARE 2.0 Data Flywheel

**Status:** Proposed
**Date:** 2026-06-19
**Author:** Archimedes (Architect) on behalf of operator (Alvin) reversal
**Supersedes:** Implicit assumption in ADR-020 §"Two-Pipeline Architecture" (MetaClaw + AZR + HeavySkill as the data flywheel); complementary to ADR-022 (HeavySkill v2 plugin implementation, which stands)
**Build phase:** A1 (continuing)
**Related session:** `20260619_155545_0be6f6` — System Diagram Audit, 2026-06-19 09:40 BST

---

## Context

ADR-020 commits AWARE 2.0 to two RL pipelines (AZR self-play + MetaClaw dialogue) feeding a shared weight store via DPO fine-tuning. The implicit third producer was **HeavySkill v2** (ADR-022): HeavySkill's K+S call patterns generate preference pairs on every invocation, and those pairs were expected to be the **primary continuous source** of training data — the "flywheel" that keeps AWARE 2.0's model improving in production.

Three pieces of evidence accumulated by 2026-06-19 made the operator reverse that assumption:

1. **The flywheel is a leak, not a loop.** `<host-config>/awareness-pairs/2026-06-17.jsonl` = 2,110 bytes, the sole output in 2+ days. HeavySkill is enabled (`plugins.entries.heavyskill.config`), K=4 is the default, and the OC heavyskill extension is running — but pairs are not being written at the rate the flywheel design assumed. Either the writer is gated behind a feature flag that is off by default, or the writer is broken, or both. The 19 June audit did not reach a root cause.
2. **The trainer is off.** `docker-compose.coordinator.yml` has `AWARE_TRAINER_ENABLED=0` and `restart: "no"`. The trainer was kill-switched after 2,265 restart loops. Even if the flywheel were producing pairs, there is no consumer.
3. **There is no production model.** The LoRA (v14, `qwen35-9b-dpo-smoke-v14`) is a smoke-test artefact (5 synthetic pairs). The `feature/aware-2.0` branch has a wire-up echo (`AWARE-LORA-WIRED`) but no deployed AWARE chat model that would consume training signal. Reference doc: `<canonical-credential-store>/skills/a2a-bridge/references/awareness-trained-model-location-2026-06-16.md`.

The 19 June system-diagram audit caught the drift between *stated intent* (HeavySkill as flywheel) and *actual state* (no producer, no consumer, no model). The operator decision on that day: **HeavySkill is no longer the data flywheel for AWARE 2.0.**

---

## Decision

**HeavySkill v2 (ADR-022) remains a shipping surface** — the paper-faithful K+S plugin, its 4 activation surfaces, the OC shim, and the `/heavyskill on|off|K=N` runtime toggle. None of that changes.

**HeavySkill is removed from the AWARE 2.0 data flywheel design.** Preference-pair writing from HeavySkill calls is no longer a goal. If the writer ever existed as a code path, it is deprecated; if it does not exist, it must not be added.

**The data flywheel role is now an open design question.** The replacement has been *decided* (HeavySkill is not it) but not yet *designed*. AZR self-play (ADR-020 §Decision 1) and MetaClaw (ADR-020 §Decision 1) remain the two named pipelines; whether either is the flywheel, or whether the flywheel is a different mechanism, is **deferred to a follow-on ADR** (placeholder: ADR-024).

---

## Consequences

### Positive

- **Honest scope.** AWARE 2.0 is no longer committed to a flywheel that does not exist. Future sessions reading the ADRs will not rediscover the gap.
- **HeavySkill stays useful.** Removing the flywheel responsibility does not remove HeavySkill. The plugin is a K+S operator tool; it can be used on demand, opt-in, per the activation surfaces in ADR-022. Its value is unchanged.
- **Trainer stays off intentionally.** `AWARE_TRAINER_ENABLED=0` is now a recorded architectural choice, not a kill-switch recovery action. Re-enabling the trainer requires a new ADR (ADR-024 or equivalent) that names a flywheel.

### Negative

- **AWARE 2.0 has no continuous-improvement path documented.** Until ADR-024 lands, the only ways AWARE 2.0's model can improve are: (a) manual DPO runs against hand-curated pairs, (b) AZR self-play runs against the existing Modal budget, (c) MetaClaw runs against user dialogue batches. None of these is "continuous" in the way HeavySkill-as-flywheel was supposed to be.
- **Documentation drift still exists.** Four decision-bearing layers still claim HeavySkill is the flywheel: AWARE commits, <internal-doc>, the OC heavyskill extension, and any source-level integration. This ADR is the canonical record; the other layers need to be updated to match.
- **MemoryStone KG is silent on the reversal.** No `supersedes/replaces` triple exists yet for ADR-023. That gap should be filled when the KG is next writable.

---

## Verification (so far)

- This ADR exists at `docs/adr/ADR-023-no-heavyskill-as-flywheel.md` ✅
- ADR-020, ADR-022, and <internal-doc> are not yet updated to match; that is follow-on work, not a blocker for this ADR ✅
- `awareness-pairs/` data flow is unchanged; no production code change is required by this decision ✅
- The trainer remains off (`AWARE_TRAINER_ENABLED=0`) — consistent with the decision ✅

---

## Commits

None yet. This ADR is the canonical record; commits updating <internal-doc>, the OC heavyskill extension docs, and the KG are follow-on work.

---

## Open Questions (for ADR-024)

1. **What is the data flywheel?** Candidates: AZR self-play scaled up, MetaClaw with operator-curated dialogue batches, a third pipeline (synthetic preference generation against the existing model), or accepting that AWARE 2.0 has *no* continuous flywheel and ships with periodic batch retraining only.
2. **What is the production chat model path?** v14 LoRA is smoke-test. When does a real training run happen? What is the input? What does success look like?
3. **Is the trainer's 2,265-restart-loop failure mode understood?** Re-enabling the trainer without a root-cause fix is a footgun.
4. **How does this affect the IUK re-application strategy?** Scout's TRL 7 stress test (8 June) flagged "no operational deployment evidence" as the blocker. If the flywheel is the missing piece, the IUK timeline depends on ADR-024 landing first.

---

*Recorded by Archimedes (Architect) on behalf of operator reversal captured in session `20260619_155545_0be6f6`. Status: Proposed — pending operator confirmation that this ADR accurately reflects the 19 June decision.*
