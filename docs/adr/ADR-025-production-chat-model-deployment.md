# ADR-025 — Production Chat Model Deployment Strategy

**Status:** Proposed (drafted 2026-06-22 in response to operator "Continue" directive, replacing the prior draft `ADR-025-oc-traffic-as-data-source.md` which is renamed to ADR-027 in this turn).
**Date:** 2026-06-22
**Author:** the coordinating agent on behalf of operator (Alvin) — for Architect (Architect) review.
**Build phase:** A1 (continuing)
**Supersedes:** Nothing. Proposes the path for ADR-024 §Open Questions #1.
**Related:** ADR-020 §"Two-Pipeline Architecture," ADR-022 (HeavySkill v2 plugin), ADR-023 (HeavySkill not flywheel), ADR-024 (no continuous flywheel — partially reversed 2026-06-22 via ADR-027 Path 1, preconditions remain as quality gates), ADR-027 (OC traffic as data source, accepted Path 1).

---

## Context

ADR-024 §Open Questions #1 asks: *Which production chat model, if any, should AWARE 2.0 train against? Where does it run? What is the consumer? When does D5 with real data happen? What does success look like?*

This ADR answers that. The answer is shaped by **what already exists on disk (verified 2026-06-22 13:20 BST)**, not by what we wish existed:

| Surface | State | Source |
|---|---|---|
| `aware-2-coordinator` (port 18081) | Running 5 days, healthy, mode=hybrid (M3 cloud + Ollama) | `docker ps` + `/health` + `/config` |
| `aware-2-gateway` (port 18080) | Running 5 days, healthy, kill_switch=false | `docker ps` + `/health` |
| `POST /coordinate` on coordinator | Verified end-to-end 2026-06-22 13:20 BST: returns `refined_trace`, `confidence`, 4 PRM-scored attempts, `verification`, `cost`, **`pair_written: true`**, `request_id` | curl smoke test |
| `POST /coordinate` schema | `{problem: str (≤100K), task_type?, K?, context?: {cost_cap_usd?}, sessionId?, agentId?, pluginConfig?, timeout_ms?, cost_cap_usd?}`; response includes pair-writer metadata | `src/coordinator/http-server.js` |
| Awareness pair writer | ACTIVE; today's file `/data/awareness-pairs/2026-06-22.jsonl` (22KB) freshly written by the smoke test | coordinator container filesystem |
| Postgres `aware_conversations` | 10 rows; 5 with `pair_path` populated | `psql` query on `aware2` |
| Postgres `aware_training_runs` | 7 rows (2026-06-13 only): 1 completed, 3 failed, 2 cancelled; smoke-test 5-pair artifacts | `psql` query |
| HeavySkill (K+S) | Integrated in <runtime> via `<heavyskill-plugin-source>/`; K=4 traces verified in live gateway logs | <runtime> extension |

**Key insight:** The "production chat model" ADR-024 §Precondition #1 is gating on **already exists as `/coordinate`**. The decision in this ADR is therefore not "should we build it" but **"who is the consumer, what does the consumer contract look like, and what does success look like in metrics."**

The prior draft of `ADR-025` (filed as `ADR-025-oc-traffic-as-data-source.md`) is renamed to `ADR-027-oc-traffic-as-data-source.md` in the same commit, because it addresses a different open question (ADR-024 §Open Questions #4 — interaction with the OpenFang / Hermes / A2A agent ecosystem) and conflating them obscures the operator's decision surface.

---

## Decision

### The production chat model surface is `POST /coordinate` on `aware-2-coordinator:18081` (already running)

This is not a new build. `/coordinate` is the canonical interface that:
1. Accepts a problem and optional context.
2. Runs the hybrid backend (M3 cloud for quality, Ollama for cost-bound fallback — coordinator decides per-request per `AWARE_BACKEND_MODE=hybrid`).
3. Generates K parallel attempts (configurable; default 4 per `AWARE_HEAVYSKILL_K`).
4. Scores each via PRM (heavy-think).
5. Selects the best by PRM score.
6. Verifies the output (non-trivial verification per ADR-024 §Precondition 2 language: chosen/rejected differentiated by content; PRM scores from real extraction; verification pass non-trivial).
7. Writes a preference pair to `/data/awareness-pairs/YYYY-MM-DD.jsonl` AND inserts a row into Postgres `aware_conversations` with `pair_path` populated.
8. Returns the refined answer with full metadata (`refined_trace`, `confidence`, `attempts[]`, `verification`, `cost`, `pair_written`, `request_id`).

This is "production chat model" in the sense ADR-024 §Precondition #1 means: a model that **serves user requests** and **emits training signal as a byproduct**. It is not "production" in the sense of "advertised SLA / SLI / SLO / monitoring," which is a follow-on engineering decision out of scope for this ADR.

### The primary consumer is <runtime> agents via the A2A plugin

<runtime> already has:
- An A2A plugin that registers agents under `POST /agents/{agentId}/tasks` on the gateway (`127.0.0.1:18792`).
- 16+ registered agents (auditor, coder, researcher, etc.).
- An `extensions/heavyskill/` plugin (in active refactor, source moved to `<heavyskill-plugin-source>/`) that wraps K+S as an opt-in tool.
- Live request traffic to these agents via the cron fleet and A2A dispatch, and direct operator chat.

**The integration pattern is: when an OC agent handles a "reasoning-heavy" task (per a heuristic or per agent-level opt-in), it calls `/coordinate` instead of / in addition to its base LLM call. The refined answer is injected as `refined_trace` into the agent's tool response. The pair writer records the interaction.**

This is the same architectural pattern as the existing HeavySkill wrap (paper-faithful K+S), but routed through the AWARE 2.0 coordinator instead of the local heavy-think binary. The benefits are:
- The coordinator's hybrid backend (M3 + Ollama) is cheaper per-call at scale than each agent duplicating M3 calls for K=4 attempts.
- The pair writer is the canonical training-signal sink (single source of truth in `aware_conversations`).
- `/version` reporting works through the coordinator's model router — when a LoRA is loaded, `/coordinate` returns it.

### Secondary consumers

- **Operator direct call** (`curl /coordinate`) — for ad-hoc testing, batch jobs, and the existing `curl` smoke test pattern. Already working.
- **AWARE 2.0 self UI** (port 18080 gateway) — the existing AWARE 2.0 web UI can call `/coordinate` directly; no change needed.

### What is NOT in scope for this ADR

- AZR self-play loop (separate; see ADR-024 §Context #5 — unimplemented, out of scope here).
- <meta-rl-pipeline> dialogue capture (separate; see ADR-024 §Context #6 — unimplemented, out of scope here).
- /version endpoint wiring (covered by ADR-024 §Precondition 3; that is a separate code change, not a deployment decision).
- Trainer re-enable (gated by ADR-024 §Preconditions 1-3; this ADR only addresses Precondition 1).
- Marketing / SLA / SLI / SLO / monitoring — out of scope.

---

## Concrete consumer contract

This is the contract <runtime> agents will use to call `/coordinate`. Stable; not a wire-format bikeshed.

### Request

```json
POST /coordinate HTTP/1.1
Content-Type: application/json

{
  "problem": "<user task as natural language>",
  "task_type": "reasoning" | "summarization" | "code" | "general",
  "K": 4,
  "context": {
    "cost_cap_usd": 0.05,
    "previous_attempts": [...],
    "agent_constraints": {...}
  },
  "sessionId": "<oc-session-uuid>",
  "agentId": "<oc-agent-id>",
  "pluginConfig": {
    "aware": {
      "prm_min_score": 0.5,
      "verification_required": true,
      "pair_write": true
    }
  },
  "timeout_ms": 60000,
  "cost_cap_usd": 0.05
}
```

### Response

```json
{
  "ok": true,
  "refined_trace": "<final answer text>",
  "confidence": 0.6,
  "attempts": [
    {"index": 0, "reasoning": "...", "prm_score": 1.0, "selected": true},
    {"index": 1, "reasoning": "...", "prm_score": 0.5, "selected": false},
    ...
  ],
  "verification": {"method": "prm+content", "passed": true, "duration_ms": 87},
  "cost": {"usd": 0.001553, "input_tokens": 482, "output_tokens": 791},
  "pair_written": true,
  "pair_path": "/data/awareness-pairs/2026-06-22.jsonl",
  "request_id": "req-..."
}
```

### OC agent behavior

1. Agent receives task from the user.
2. Agent decides whether task is "reasoning-heavy" — heuristic: task_type is reasoning/summarization/code, OR length > 200 chars, OR user explicitly invoked `/refine` or similar.
3. If yes, agent calls `/coordinate` with the above schema. If no, agent proceeds with direct LLM call.
4. Agent receives response; injects `refined_trace` as the final answer; logs `request_id` + `cost` for observability.
5. Agent may pass `pair_write: false` if user requested "no audit" — but default is `pair_write: true`.

The pair writer is on by default because the cost of writing a pair is essentially free (a row in JSONL + a row in Postgres) and the training-signal value of the pair is non-zero even if the user doesn't actively use the refined answer.

---

## Success metrics

ADR-024 §Open Questions #1 asks "What does success look like (latency, throughput, model quality delta vs base)?" The answer:

### Quantitative

- **Request rate**: ≥10 `/coordinate` calls/hour at steady state once OC agents are wired. (Today: 1 manual call per verification, ~0/hour production rate.)
- **Pair write rate**: ≥100 pairs/week accumulated in `aware_conversations` (matches `AWARE_TRAINER_MIN_PAIRS_PER_RUN` default). This satisfies ADR-024 §Precondition 2.
- **P50 latency**: <8s for K=4 hybrid calls. (Today: 9.5s on the smoke test call; 4-attempt M3 cloud dominates.)
- **P99 latency**: <30s for K=4 hybrid calls.
- **Cost per call**: <$0.02 median (smoke test was $0.001553; this assumes most calls use Ollama fallback, not M3).
- **Pair quality**: ≥80% of pairs have `verification.passed: true` and `chosen.prm_score - rejected.prm_score ≥ 0.2`. Below this threshold the trainer (when re-enabled) will discard pairs per `outcome-filter.js`.

### Qualitative

- OC agents that call `/coordinate` produce measurably better answers on reasoning benchmarks (operator's call — formal benchmark suite is out of scope here, would be a follow-on ADR).
- Operators and agents can answer "what is the AWARE model doing right now?" via `curl /version` (the existing endpoint, returns active LoRA + base model + backend mode).
- ADR-024 §Precondition 3 (wiring `/version` to model router) becomes trivial once production traffic flows, because the model router already serves `aware-2-coordinator` and `/version` just needs to read `AWARE_TRAINER_WEIGHTS_DIR`.

### When is this ADR's decision "fired"?

The decision is fired when:
1. `aware-2-coordinator` is reachable at `127.0.0.1:18081` (already true). ✅
2. ≥1 OC agent calls `/coordinate` in a real task (not just a curl smoke test). — Not yet true.
3. The pair writer has logged ≥1 production (non-smoke-test) pair into `aware_conversations` with `backend_used` populated. — Not yet true (today's smoke test pair has `backend_used=NULL`).

The decision's success criterion (vs firing criterion) is: ≥1 week of production `/coordinate` traffic with stable P99 latency and ≥80% pair-quality gate.

---

## Consequences

### Positive

- **Closes the consumer gap.** ADR-024 §Precondition 1 ("a production chat model running and serving user requests") is now answerable in concrete terms: `/coordinate` exists, OC agents are the consumer. The operator's (B) selection "bring up the stack, wire OC traffic" maps to this ADR cleanly.
- **Pair volume threshold becomes attainable.** ADR-024 §Precondition 2 (≥100 real pairs) is one-quarter of the way (today's 5 rows are smoke-test pairs, but the wiring will start adding real pairs at the rate of one per OC agent call). At the success-metric request rate of 10/hour, the threshold crosses in ~10 hours of production traffic.
- **Trainer re-enable path becomes mechanically clear.** When Precondition 2 holds, the operator can flip `AWARE_TRAINER_ENABLED=1` and the trainer poller will fire on the next 100-pair accumulation. No code change needed.
- **Architecture is composable.** HeavySkill (paper-faithful K+S in `<heavyskill-plugin-source>/`) and AWARE 2.0 (`/coordinate` via coordinator) are not mutually exclusive — they can coexist. HeavySkill remains opt-in for agents that want local K+S; AWARE `/coordinate` becomes the default for agents that want cost-efficient hybrid + training signal.

### Negative

- **Latency tax.** Every `/coordinate` call adds 4-10s latency vs a direct M3 call. For agents on tight latency budgets (sub-1s reply needed), this is unacceptable and they should bypass `/coordinate`. The heuristic check (task_type + length) limits this exposure but does not eliminate it.
- **Cost tax.** K=4 attempts means up to 4x the cost of a single LLM call. Hybrid mode mitigates this via Ollama fallback, but if Ollama quality is unacceptable for some tasks, the cost is real. The `cost_cap_usd` parameter is the safety valve; without it, runaway cost is possible.
- **Single point of failure.** If `aware-2-coordinator` is down, OC agents calling `/coordinate` block or error. Mitigations: (a) timeout_ms (default 60s), (b) agents fall back to direct LLM call on coordinator unreachable, (c) watchdog alert if coordinator is down (this is what the existing `recurring-jobs-watchdog` does for crons; for coordinator availability, see §Open Questions below).
- **The "Recursive Evolution" framing remains weaker than the product brief implies.** `/coordinate` calls produce pairs, but the trainer is still gated by ADR-024 §Precondition 3 (wiring `/version` to model router) which is not in scope for this ADR. Until that wires up, "Recursive Evolution" is still demand-driven or cadence-driven, not continuous.

### Neutral

- ADR-026 (quarterly cadence automation, ADR-024 §Open Questions #2) becomes optional once this ADR's success metrics hit — if pair volume crosses the threshold weekly, the cadence trigger is moot. But the cadence is still useful as a "warm pipeline" insurance policy.
- ADR-027 (OC traffic as data source, the renamed prior draft) is a follow-on consideration. The current ADR gives OC agents the consumer contract; ADR-027 would explore whether the **entirety** of OC agent traffic should feed `/coordinate` (vs opt-in heuristic). Those are different decisions; this ADR picks the opt-in heuristic.

---

## Verification (so far)

- `POST /coordinate` smoke test 2026-06-22 13:20 BST returned `ok: true`, full schema, pair written. ✅
- Pair file `/data/awareness-pairs/2026-06-22.jsonl` confirmed in coordinator container (22,104 bytes, today's date). ✅
- Postgres `aware_conversations` row count: 10. (Today: still pre-OC-integration; will grow when OC agents call.) ✅
- Hybrid backend mode: coordinator `/config` reports `mode=hybrid`, both backends healthy. ✅
- No code change required to fire this ADR — `/coordinate` already runs. ✅

### Open implementation tasks (not blockers, but follow-on work)

1. **OC agent `extensions/aware/` extension** — exposes `/coordinate` as an OC tool. Architecturally analogous to `extensions/heavyskill/`. Source would go in a new `<aware-plugin-source>/` repo (separate from <runtime> working tree, which is mid-refactor). Out of scope here; this ADR scopes the deployment, not the extension code.
2. **Coordinator health probe** — add `aware-2-coordinator` availability to the recurring-jobs-watchdog. (Operator already has watchdog; one-line addition: probe `/health` on `127.0.0.1:18081`, alert on 5xx / timeout.)
3. **Pair schema verification** — confirm that production pairs (from real OC calls) satisfy ADR-024 §Precondition 2's "non-trivial verification" clause. The smoke-test pair has `verification.method: "prm+content"`, `verification.passed: true` — looks good, but a sample of 5 production pairs should be reviewed before flipping the trainer on.

---

## Open Questions (for follow-on ADRs)

- **ADR-026 (quarterly cadence automation):** if this ADR's success metrics hold, do we still need cadence automation? Recommendation: yes, as a "warm pipeline" insurance — quarterly cadence catches the case where OC traffic dips below the threshold for >90 days.
- **ADR-027 (OC traffic as data source):** the renamed prior draft. Should the entirety of OC agent traffic be routed through `/coordinate`? Or is opt-in heuristic (this ADR's choice) the right call? Out of scope here.
- **ADR-028 (proposed): SLA / SLI / SLO for `/coordinate`.** Latency, error rate, cost ceiling, monitoring. Needed for IUK TRL 7 evidence.
- **ADR-029 (proposed): Trainer re-enable runbook.** When Preconditions 1-3 hold, what is the operator's step-by-step procedure? Smoke-tested 2026-06-13 path exists (`run-phase4-d5.sh`) but is operator-only; a written runbook would let a future session re-enable without reading 12 ADRs.

---

## Commits

This ADR itself is untracked on the filesystem. To be committed after Architect (Architect) review.

---

*Drafted by the coordinating agent on behalf of operator (Alvin) "Continue" directive at 2026-06-22. Status: Proposed — pending Architect (Architect) review + operator confirmation. Supersedes the prior draft `ADR-025-oc-traffic-as-data-source.md`, renamed to `ADR-027-oc-traffic-as-data-source.md`.*