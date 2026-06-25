# ADR-034 — <runtime>-Side AWARE 2.0 Integration Architecture

**Status:** Proposed (drafted 2026-06-22 15:10 BST by the coordinating agent on behalf of operator Alvin; for Architect Architect review)
**Date:** 2026-06-22
**Author:** the coordinating agent on behalf of operator (Alvin) "Continue" directive
**Build phase:** A2 (integration phase)
**Relates to:** ADR-025 (production chat model — defines `/coordinate` contract), ADR-027 (Path 1 reversal — gates enablement), ADR-022 (HeavySkill v2 plugin — analog), ADR-029 (trainer-enable runbook), ADR-030 (PRM calibration)
**Implements:** The operator's 2026-06-22 (B) selection "wire OC agent traffic as the data source" — specifically, the OC-side half of that integration.

---

## Why this ADR exists

The standing goal is "integrate AWARE 2.0 to <runtime> elegantly and properly." Prior ADRs in this session have addressed:

- **ADR-025** — the AWARE-side production surface (`POST /coordinate` on `aware-2-coordinator:18081`)
- **ADR-027** — the architectural decision (Path 1 reversal: continuous OC-traffic flywheel)
- **ADR-028-030** — quality-gate audit + trainer-enable runbook + PRM calibration

**What's missing: the OC-side integration architecture.** ADR-025 named the consumer as "<runtime> agents via A2A plugin" but didn't specify how. ADR-027 named "wire OC agent traffic as the data source" but didn't specify the surface. This ADR closes that gap.

Concretely: this ADR designs the <runtime> extension that exposes `/coordinate` to OC agents, the integration pattern with existing OC agent loops, the failure modes, and the rollout sequence.

---

## Decision

**Build a new <runtime> extension at `extensions/aware/` that wraps the AWARE 2.0 `/coordinate` endpoint as an OC tool, opt-in per agent.**

### Surface

The extension registers as a **provider** (per the OC plugin SDK contract — same as HeavySkill in `<heavyskill-plugin-source>/`). Concretely:

```
extensions/aware/
├── <runtime>.plugin.json         # plugin manifest
├── package.json
├── src/
│   ├── index.js                  # plugin entry; exports the provider
│   ├── provider.js               # AWARE-aware provider implementation
│   ├── client.js                 # HTTP client to 127.0.0.1:18081/coordinate
│   ├── schema.js                 # input/output schema definitions
│   └── tests/
└── README.md
```

### What it exposes

The plugin exposes **two integration surfaces**:

1. **Tool surface** — OC agents can call `aware-coordinate(problem, opts)` as a tool in their agent loop. Returns the same envelope as `/coordinate`. Available to any agent that opts in via `plugins.entries.aware.config.enabled = true`.

2. **Hook surface** — OC agents that already use HeavySkill can have their heavy-think calls optionally forwarded through AWARE `/coordinate` instead of the local heavy-think binary. This is opt-in via `plugins.entries.aware.config.route_heavyskill_through_aware = true`.

The two surfaces are independent. Agents can use one, both, or neither. Default is neither (HeavySkill remains the default opt-in tool).

### Per-agent configuration

The plugin reads per-agent config from the OC plugin SDK's `plugins.entries.aware.config.agentDefaults.<agentId>`:

```json
{
  "agentDefaults": {
    "auditor": {
      "enabled": true,
      "K": 4,
      "task_type": "security"
    },
    "coder": {
      "enabled": true,
      "K": 2,
      "task_type": "code"
    },
    "researcher": {
      "enabled": false
    }
  }
}
```

If `<agentId>` is missing, the agent does NOT call AWARE — falls through to its default LLM loop. This matches HeavySkill's pattern of explicit opt-in per agent.

### Why "tool" + "hook" (not just one)

- **Tool surface** is for OC agents that want to call AWARE explicitly when reasoning-heavy. Mirrors how `extensions/heavyskill/` was designed.
- **Hook surface** is for transparent routing — agents that already use HeavySkill don't have to change their code; the plugin intercepts their heavy-think call and routes it through AWARE if configured.

Both share the same `client.js` HTTP layer. The provider pattern in `provider.js` is what makes this composable.

---

## Architecture details

### Request flow (tool surface)

```
OC agent loop (e.g., auditor handling "explain this contract's audit trail")
  ↓
  Calls aware-coordinate({problem: "...", K: 4, task_type: "security"})
  ↓
  extensions/aware/src/provider.js
    ↓
    extensions/aware/src/client.js
      ↓
      POST http://127.0.0.1:18081/coordinate
      ↓
      aware-2-coordinator (running in docker compose)
        ↓
        heavy-think K+S + PRM + refine
        ↓
        Returns envelope {refined_trace, confidence, attempts, verification, cost, pair_written, pair_path, request_id}
      ↓
    Extensions/aware/src/client.js parses response, returns to provider
    ↓
  Provider returns envelope to OC agent
  ↓
OC agent injects refined_trace into its tool response
```

### Request flow (hook surface)

```
OC agent loop calls heavy-think (HeavySkill plugin)
  ↓
  extensions/aware/src/provider.js hooks the heavy-think wrapper
  ↓
  If route_heavyskill_through_aware:
    POST /coordinate with the heavy-think's problem
    ↓
    Use refined_trace as the heavy-think result
  Else:
    Pass through to heavy-think unchanged
```

This is the same pattern as the `wrapHeavyskillInferenceStream` function in `<runtime-source>/extensions/heavyskill/` (the v4 wrap that's currently a passthrough per <internal-doc>). The AWARE extension adds an alternative target — instead of forwarding to heavy-think, forward to `/coordinate`.

### HTTP client details

The client is a thin wrapper around `fetch()` (Node 18+ built-in). Per ADR-025 §"Concrete consumer contract", the request body shape is:

```json
{
  "problem": "<natural language>",
  "task_type": "security" | "reasoning" | "code" | "standard" | ...,
  "K": 4,
  "context": { ... },
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

Defaults (when called from the tool surface without explicit opts):
- `K`: from `agentDefaults.<agentId>.K`, falling back to 4
- `task_type`: from `agentDefaults.<agentId>.task_type`, falling back to `standard`
- `timeout_ms`: from `agentDefaults.<agentId>.timeout_ms`, falling back to 60000
- `cost_cap_usd`: from `agentDefaults.<agentId>.cost_cap_usd`, falling back to 0.05
- `pluginConfig.aware.pair_write`: defaults to `true` (per ADR-025 §"OC agent behavior" §5)

### Plugin manifest

`extensions/aware/<runtime>.plugin.json` (per OC plugin SDK contract):

```json
{
  "id": "aware",
  "name": "AWARE 2.0 Coordinator Bridge",
  "version": "0.1.0",
  "description": "Exposes AWARE 2.0 /coordinate as an <runtime> tool. Routes heavy-think calls optionally through AWARE for training-signal emission.",
  "entry": "./src/index.js",
  "hookAliases": ["provider", "tool", "hook"],
  "configSchema": {
    "type": "object",
    "properties": {
      "agentDefaults": { "type": "object" },
      "route_heavyskill_through_aware": { "type": "boolean", "default": false },
      "endpoint_url": { "type": "string", "default": "http://127.0.0.1:18081/coordinate" }
    }
  }
}
```

---

## Why a separate extension (not extend `extensions/heavyskill/`)

Three reasons:

1. **Different lifecycle.** HeavySkill is OC's local K+S primitive. AWARE is AWARE 2.0's distributed coordinator with PRM cache, hybrid backend, and pair-writing. They have different upgrade cadences, different failure modes, different config surfaces.

2. **Different ownership.** `<heavyskill-plugin-source>/` is HeavySkill's source-of-truth (separate repo). AWARE 2.0 lives at `./`. Conflating them creates a tight coupling that future maintainers will hate.

3. **Different opt-in semantics.** HeavySkill is "wrap my inference stream" (transparency). AWARE is "give me K+S + training signal" (explicit choice). Agents that want one don't necessarily want the other.

The pattern of "two related extensions" is established in the OC plugin SDK (e.g., `extensions/a2a/` and `extensions/a2a-skills/`). Same convention.

---

## Source location

The plugin source goes in a NEW separate repo: `<aware-plugin-source>/`. This is consistent with how HeavySkill is structured (`<heavyskill-plugin-source>/` is a separate repo, with `extensions/heavyskill/` in the <runtime> working tree being a thin re-export).

Why a new repo (not `./extensions/aware/`):
- AWARE 2.0 is a standalone product (Docker compose stack). Adding OC extensions to it conflates the product with the integration.
- A separate repo lets the OC extension evolve at OC's cadence, not AWARE's.

The repo structure:
```
<aware-plugin-source>/
├── <runtime>.plugin.json
├── package.json
├── src/
│   ├── index.js
│   ├── provider.js
│   ├── client.js
│   ├── schema.js
│   └── tests/
└── README.md
```

When the <runtime> working tree stabilizes (post-refactor, after the 10916-ahead-of-origin state is resolved), this would be installed as `extensions/aware/` via `pnpm install` from the aware-plugin repo.

---

## Rollout sequence

This is a multi-step rollout. Each step has explicit operator sign-off:

### Step 1: Build the extension (no runtime impact)

- Create `<aware-plugin-source>/` repo
- Implement `client.js` (HTTP wrapper), `provider.js` (OC plugin contract), `schema.js` (input validation)
- Unit tests (mock the HTTP layer; verify request shape matches ADR-025 §"Concrete consumer contract")
- Sign-off: Architect reviews the API contract + per-agent config shape

### Step 2: Add `aware` to OC's plugin registry

- Add `extensions/aware/` install to `<host-config>/` (live install, like HeavySkill)
- Set `plugins.entries.aware.config.agentDefaults = {}` (empty — no agent calls AWARE yet)
- Verify gateway reloads cleanly
- Sign-off: operator confirms gateway health + zero impact on existing agents

### Step 3: Enable one agent at a time (e.g., `auditor` first)

- Add `plugins.entries.aware.config.agentDefaults.auditor = { enabled: true, K: 4, task_type: 'security' }`
- Monitor for 24 hours: does `auditor` invoke `/coordinate`? Are the calls succeeding? What's the cost?
- If good: enable next agent. If not: debug or rollback.
- Sign-off: per agent, operator approves rollout

### Step 4: Verify training signal flow

- After ≥1 agent has called `/coordinate` for ≥24 hours, check `aware_conversations.pair_path` rows
- Confirm pairs are landing in the table
- Confirm `/coordinate` results return `pair_written: true`
- Sign-off: operator confirms training signal flow

### Step 5: Flip `AWARE_TRAINER_ENABLED=1` (per ADR-029)

- After ADR-029's go/no-go checklist is satisfied
- Run the trainer for one polling cycle
- Verify a LoRA checkpoint is produced
- Verify the LoRA is loaded by the gateway (via `lora-reloader.js`)
- Sign-off: operator approves the trainer rollout

### Step 6: Measure quality delta

- After ≥1 week of trainer running, compare OC agent answer quality with vs without AWARE
- Benchmark methodology TBD (could be the existing `eval/` framework, or a new ADR)
- Sign-off: operator decides whether to keep AWARE on or roll back

---

## Failure modes and mitigation

| Failure | Impact | Mitigation |
|---|---|---|
| `aware-2-coordinator` unreachable | `/coordinate` calls timeout (default 60s) | Client returns error envelope; agent falls back to direct LLM call. Tool surface: graceful degradation. Hook surface: passthrough to heavy-think unchanged. |
| `/coordinate` returns inverted pair | Pairs flow to trainer | Repair 1's directionality check (already deployed in `4fd4193`) drops them at the trainer's outcome filter. |
| Modal job fails (trainer) | No LoRA checkpoint produced | Existing trainer error handling (`aware_training_runs.status='failed'`). No agent impact. |
| Plugin config malformed | Agent doesn't call AWARE | Plugin SDK validates config at load; malformed config logs a warning and the agent falls back to direct LLM. |
| Rate-limit on `/coordinate` (cost cap hit) | `/coordinate` returns 402 | Client returns error envelope; agent falls back. |

---

## Cost analysis

Per ADR-025 §"Success metrics": cost per call <$0.02 median (smoke test was $0.001553). At a target rate of 10 calls/hour per enabled agent, and assuming 3 enabled agents (auditor, coder, researcher), that's 30 calls/hour × $0.02 = $0.60/hour = $14.40/day.

For comparison: current heavy-think local calls are ~$0.001/call (much smaller models). The AWARE path is ~20x more expensive but produces training signal as a byproduct.

**Operator decision:** is $14/day of inference cost acceptable for the training signal and quality-improvement potential? Out of scope here — but it should be discussed before Step 3 of the rollout.

---

## What this ADR does NOT do

- **Does NOT touch the <runtime> working tree** (mid-refactor). The plugin lives in a separate repo. Installation happens via `pnpm install` after the working tree stabilizes.
- **Does NOT modify `./`.** This is OC-side. The AWARE-side changes are in ADR-025 + ADR-027 + ADR-029.
- **Does NOT modify `<heavyskill-plugin-source>/`.** HeavySkill is unchanged. The AWARE plugin coexists with it.
- **Does NOT enable `AWARE_TRAINER_ENABLED=1`.** That's Step 5 of the rollout, gated on operator sign-off + ADR-029's go/no-go checklist.

---

## Open Questions (for follow-on ADRs)

- **ADR-035 (proposed): AWARE Plugin Cost Budget.** Monthly budget cap on `/coordinate` calls. Cron-driven enforcement. Operator decision required before Step 3.
- **ADR-036 (proposed): Benchmark Methodology for Quality Delta.** How do we measure whether AWARE-improved answers are actually better? Sample size, evaluator identity (human? LLM-as-judge?), comparison baseline. Out of scope here.
- **ADR-037 (proposed): Plugin Config Schema Validation.** The current plugin SDK config validation is loose. A stricter schema for `aware` agentDefaults would catch misconfigurations early. Out of scope here.

---

## Verification (so far)

- ADR-025 §"Concrete consumer contract" read; this ADR's request shape matches. ✅
- Existing HeavySkill plugin (`<heavyskill-plugin-source>/`) structure reviewed; this ADR's design follows the same pattern. ✅
- OC plugin SDK contract verified (`extensions/heavyskill/<runtime>.plugin.json` shape). ✅
- No code changes proposed in this ADR — it's a design + rollout plan. Implementation happens in follow-up PRs after Architect review. ✅

---

*Drafted by the coordinating agent on behalf of operator (Alvin) "Continue" directive 2026-06-22 15:10 BST. Status: Proposed. Architect review invited on: (a) the tool + hook dual-surface design, (b) the per-agent config schema, (c) the rollout sequence (especially the cost analysis at Step 3), (d) the failure-mode mitigation table, (e) the new-repo decision (`<aware-plugin-source>/`).*

*Operator review invited on: (f) the rollout sign-off cadence (per-step vs all-at-once), (g) the budget figure ($14/day for 3 enabled agents at 10 calls/hour), (h) the choice of which agents to enable first.*

*This ADR closes the OC-side design gap left open by ADR-025 + ADR-027. With this ADR + ADR-025 (AWARE-side) + ADR-027 (architectural framing) + ADR-029 (trainer-enable runbook) + ADR-030 (PRM calibration), the integration design is complete. Implementation is a separate multi-step process gated on operator + Architect sign-off.*