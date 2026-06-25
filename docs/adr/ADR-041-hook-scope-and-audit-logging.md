# ADR-041 — AWARE hook scope correction + audit logging

**Status:** Accepted (2026-06-23)
**Author:** the coordinating agent
**Amends:** ADR-040 (v0.4.0/v0.4.1 hook semantics)
**Implements:** Two corrections to the v0.4 hook architecture discovered in production review.

## Context

ADR-040 shipped `before_tool_call` auto-interception with a 3-tier gate:
plugin-level (`auto_intercept.enabled`) → agent-level (`agentDefaults.<id>.enabled` OR `auto_intercept.agent_ids`) → **tool-name gate** (`auto_intercept.intercept_patterns`, default `["*"]`).

In production 2026-06-23 with `intercept_patterns: ["exec", "exec_*"]` enabled for `coder`, two issues surfaced:

### Issue 1: `intercept_patterns` as inclusion filter is unjustified

The original design intent (ADR-034 §"Hook surface") was "agents that already use HeavySkill have their heavy-think calls optionally forwarded through AWARE." HeavySkill is called on reasoning decisions, not on specific tool names. Translating that intent into a tool-name denylist — "intercept these tool names" — is an arbitrary restriction I imposed at implementation time. There is no design rationale for **excluding** `read_file`, `write_file`, `search`, etc., from interception when an agent is opted in.

Worse, the practical effect is: a `coder` agent that reads a 1000-line config and writes a comment never goes through AWARE, even though it's exactly the kind of reasoning-heavy decision that AWARE was built for. The current narrow pattern filter accidentally excludes the most valuable use cases.

### Issue 2: No audit log

OC's plugin SDK exposes three audit-relevant hooks (`before_tool_call`, `after_tool_call`, `tool_result_persist`) plus `traceId` for end-to-end correlation. ADR-040 wired `before_tool_call` only. There is no record of:

- Which calls were intercepted vs passed through
- Whether the refined answer actually replaced the original params (or whether AWARE returned an empty/error)
- What the tool's outcome was (success, error, duration, result size)
- The correlation between `runId` / `traceId` / `toolCallId`

Verification of v0.4.1's blocking semantics in production required log archaeology: pulling gateway log lines lines, computing duration deltas, correlating across multiple log sources. **This is a missing feature that should be standard for any system that intercepts and modifies agent behavior.** AWARE's pair files (in `/data/awareness-pairs/`) capture training data but not the agent-facing audit trail.

## Decision

### Decision 1: `intercept_patterns` becomes a denylist, default empty

When `auto_intercept.enabled` is true and the agent gate passes, **all tool calls are eligible for interception**. `intercept_patterns` is renamed in semantics to a denylist: `["read_file", "search"]` would skip those tools; default `[]` skips nothing.

Rationale: when an agent is opted in, the operator's intent is "send reasoning-heavy decisions through AWARE," and reasoning happens across many tools. The denylist gives operators a precision tool for known-low-value exclusions (cheap reads) without requiring an explicit allowlist that drifts as new tools are added.

This is a **breaking schema change** for anyone who set `intercept_patterns` to a non-`*` list in v0.4.0/v0.4.1 expecting inclusion semantics. Migration: invert the list (e.g. `["exec", "exec_*"]` → `[]` if you want all tools, or `["read_file"]` if you specifically wanted to exclude reads). Bumping to v0.5.0.

### Decision 2: Add `after_tool_call` hook for outcome-side auditing

Register a second hook on `after_tool_call`. It receives `{ toolName, params, runId, toolCallId, result, error, durationMs, traceId }`. The hook writes a JSONL audit line per call to `<runtime-config-dir>/audit/aware-tool-calls.jsonl`.

**The audit line is written unconditionally for every `before_tool_call` decision** (intercepted AND passed-through). Rationale: the audit log's value is the record of what the system considered doing, not just what it did. A pass-through is informative ("AWARE considered intercepting this but didn't, because the gate failed"), and writing it lets operators verify gate logic.

### Decision 3: Audit log shape

Each line in `<runtime-config-dir>/audit/aware-tool-calls.jsonl`:

```json
{
  "ts": "2026-06-23T17:30:42.123Z",
  "traceId": "abc-123-...",
  "runId": "00764373",
  "toolCallId": "ik7xk020nqsk_1",
  "agentId": "coder",
  "toolName": "exec",
  "phase": "before" | "after",
  "intercepted": true | false,
  "interceptionDecision": "passed" | "skipped_recursion" | "skipped_plugin_off" | "skipped_no_agent" | "skipped_denied" | "skipped_aware_self" | "interpolated" | "refined" | "pass_through" | "fail_open",
  "paramsDigest": "sha256:...",
  "paramsProblemBefore": "find SUID binaries",
  "paramsProblemAfter": "[AWARE refined] find SUID binaries and explain each risk",
  "awareRequestId": null | "aware-uuid",
  "awareConfidence": null | 0.85,
  "awareCostUsd": null | 0.003,
  "awarePairWritten": null | true,
  "toolResultSummary": null | { "ok": true, "bytes": 1234, "lines": 12 },
  "toolError": null | "ENOENT: ...",
  "durationMs": 580
}
```

The `interceptionDecision` field is the load-bearing one — it tells you exactly why each call was handled the way it was. Operators can grep for `fail_open` to find broken-interception cases, `skipped_denied` to verify the denylist, etc.

### Decision 4: Audit writes are async + bounded

Audit writes use `fs.appendFile` (not `writeFileSync`). Failures are caught and logged at warn level — the hook MUST NEVER throw (per ADR-040 §"Fail-open contract"). If the audit file is unreachable, the hook continues serving traffic; the failure is visible in the gateway log, not in the agent's behavior.

A simple bounded queue (cap 1000 pending writes) prevents unbounded memory growth if the disk stalls. If the queue is full, the write is dropped and counted; the counter is logged every 100 drops.

## Scope

**In scope:**
- `before_tool_call` continues to gate on `agentDefaults` + `auto_intercept.agent_ids`. The third tier (`intercept_patterns`) becomes a denylist.
- New `after_tool_call` hook writes the after-side audit line.
- New audit module at `src/audit.js` (or inline in `hook.js`).
- Schema bump in `openclaw.plugin.json` reflecting the denylist rename + new audit options.
- New tests covering: denylist semantics, audit line shape, audit failure isolation.

**Out of scope:**
- Centralized audit collection across multiple AWARE plugins (one plugin = one audit file, operators aggregate downstream).
- Log shipping to external systems (the JSONL is the source; ship via existing log rotation).
- Pairing audit lines with `/coordinate` request_ids at the coordinator level (that mapping already exists in the AWARE pair file; cross-referencing is an analyst task).
- Replacing the `agentDefaults` opt-in surface with a single `auto_intercept` surface. The two surfaces OR-combined in v0.4.0/v0.4.1 stay (separately documented as schema drift in P66).

## Verification (planned, to be performed in this PR)

- Unit tests: 8 new tests covering denylist semantics (default empty = all pass; `["exec"]` excludes exec; glob support; recursion-skip still respected) + audit line shape (before-side fields populated, after-side fields populated, async write doesn't block hook, audit failure doesn't break hook).
- Integration: gate the live `auto_intercept` on `coder` and let a real `exec` call land; verify the audit file gets a `before` line + `after` line with matching `traceId`.
- Schema: `openclaw.plugin.json` validates; v0.4.1 → v0.5.0 migration is documented in the description field.

## Trade-offs

| Pro | Con |
|---|---|
| Denylist matches operator intent (intercept by default, exclude specific tools) | Breaking schema change — operators with `intercept_patterns` set need to migrate |
| Audit log gives operators instant visibility into hook behavior | Disk I/O per call (mitigated by `appendFile` + bounded queue) |
| `interceptionDecision` field makes gate logic debuggable | Adds a schema field that may be hard to evolve without breaking consumers |
| Async + bounded queue prevents audit from blocking the agent | If disk stalls, audit gaps silently — counter in gateway log is the only signal |
| Two new fields (`paramsProblemBefore`, `paramsProblemAfter`) capture the refinement delta | String fields can be large for tool calls with big prompts — cap at 2KB each, hash the rest |

## References

- `~/src/aware-plugin/src/hook.js` — `shouldIntercept` (gate logic), `awareBeforeToolCallHook` (handler)
- `~/src/aware-plugin/src/index.js` — `api.registerHook` wiring
- `~/src/aware-plugin/openclaw.plugin.json` — schema
- <plugin-runtime>/src/plugins/hook-types.ts:676-683 — `before_tool_call` + `after_tool_call` hook contracts
- ADR-040 §"Verification" — v0.4.1 production evidence (the 13.2s exec call durations that motivated this ADR)
- ADR-034 §"Hook surface" — original HeavySkill-wrapping intent
- P66 (saved skill) — config-surface drift between `agentDefaults` and `auto_intercept`
