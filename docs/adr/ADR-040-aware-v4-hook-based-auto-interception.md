# ADR-040 — AWARE 2.0 v0.4 hook-based auto-interception

**Status:** Accepted (2026-06-23)
**Author:** AWARE maintainers
**Supersedes:** part of v0.2.0 (InferenceStrategy) and v0.3.0 (explicit tool call only)

## Context

v0.1.0–v0.3.0 of the AWARE OpenClaw plugin required every agent to explicitly
invoke `aware-coordinate(problem, opts)` from its loop. This has three problems:

1. **Agents forget to call it.** Without a hard rule "every problem goes through
   AWARE", agents routinely emit answers directly without consulting the
   coordinator. The whole point of AWARE was to standardize answer quality,
   so any agent that forgets defeats the system.
2. **Opt-in per agent creates a per-agent config burden.** Every agent that
   wants AWARE has to remember to wire `aware-coordinate(problem)` into its
   loop. New agents inherit the same burden.
3. **v0.2.0 attempted transparent routing** via `registerInferenceStrategy`,
   which is OC's hook for inference-time interception. It failed because of
   two OC loader bugs: (a) `registerSkipped` hash check at
   `loader.ts:1877-1883` skips re-registration, and (b) the inference-load
   scope filter at `providers.ts:63` excludes non-provider-owner plugins
   (AWARE is not a provider, only a coordinator).

v0.3.0 worked around (a)+(b) by switching to the explicit tool surface, which
sidesteps both bugs. But the explicit-tool workaround re-introduces problem
#1 above.

## Decision

**v0.4.0 registers a `before_tool_call` hook** that automatically intercepts
tool calls and routes them through AWARE. The hook is opt-in via a new
`auto_intercept` config block; when off, the hook is dormant.

### Why `before_tool_call`

OC's plugin SDK exposes a `before_tool_call` hook (see
`<repo-root>/src/plugins/hook-types.ts:70,102,676`) that:

1. Fires before every tool call in every agent loop.
2. Receives `{ toolName, params, runId, toolCallId }`.
3. Can return `{ params: <modified> }` to merge modified params into the
   call, OR `{ block: true, blockReason }` to block the call, OR
   `requireApproval` for sensitive ops.
4. Is per-registration `timeoutMs` controllable (line 751 of hook-types.ts),
   with a runner default of 5000ms.

This is exactly the interception primitive we need. It does NOT suffer from
the v0.2.0 bugs because:
- It runs in the `registerHook` path, not `registerInferenceStrategy` —
  so the inference-load scope filter doesn't apply.
- It runs at tool-call time (not startup), so the `registerSkipped` short-
  circuit at startup doesn't suppress our registration.

### Gating (3-tier, all must pass)

A tool call is auto-routed iff:

1. **Plugin-level:** `pluginConfig.auto_intercept.enabled === true`
   (default `false` — preserves v0.3.0 behavior).
2. **Agent-level:** the calling agent is opted in via either
   `agentDefaults.<agentId>.enabled` (v0.3.0 surface, reused) OR
   `auto_intercept.agent_ids` (new). The two are OR-combined so existing
   opt-ins carry forward.
3. **Tool-name gate:** the tool being called matches one of
   `auto_intercept.intercept_patterns`. Supports `*` (wildcard) and glob
   (e.g. `exec_*` matches `exec_command`). Default is `["*"]` once
   `auto_intercept` is enabled.

### What the hook does on a match

1. Build an AWARE `problem` from `(toolName, params)` by reading the
   first non-empty string field from `problem | prompt | message | query
   | task`, falling back to `JSON.stringify(params)` truncated to 8000
   chars. The output is prefixed with `[intercepted <toolName>]` for
   trace clarity.
2. Call `/coordinate` with a hard inner timeout of `inner_timeout_ms`
   (default 4000ms). Outer hook timeout is 4500ms (under OC's runner
   default of 5000ms).
3. On success, merge the refined `refined_trace` back into the original
   params by writing to the same string field we read from (so `params.problem`
   becomes the refined text, etc.). If no string field exists, write to a
   synthetic `_aware_refined` field.
4. Return `{ params: <merged> }`.

### Recursion guards (defense in depth)

Two layered guards prevent infinite loops:

- **(a) Direct loop breaker:** Skip when `event.toolName === "aware-coordinate"`.
  This is O(1) and makes the intent obvious in code review.
- **(b) Per-run dedupe:** `Map<runId, Set<toolCallId>>` bounded to 256
  entries. If the same call has already been routed, skip. Catches
  indirect re-entry (e.g. AWARE's coordinator calls a tool that the
  agent also has, which then re-enters the hook).

### Fail-open contract (critical)

The hook **never throws** and **never returns `{ block: true }`**.

OC's `pi-tools.before-tool-call.ts:393-397` maps ANY thrown error from
a `before_tool_call` handler to `blocked: true` with the
`BEFORE_TOOL_CALL_HOOK_FAILURE_REASON` constant. This means a throw would
**block all tool calls** for the agent instead of letting them through.

Every error path returns `undefined` (pass-through, no modification). The
inner fetch budget (4000ms) fires before the outer hook timeout (4500ms)
which fires before OC's runner default (5000ms). On any error — coordinator
down, timeout, malformed response, fetch failure — we log a warning and
return `undefined`. The original tool call runs unmodified.

### Configuration

```yaml
plugins:
  entries:
    aware:
      config:
        endpoint_url: http://127.0.0.1:18081/coordinate
        # v0.4 NEW (default: { enabled: false } — opt-in)
        auto_intercept:
          enabled: true
          intercept_patterns: ["exec", "exec_*"]   # narrow at first
          agent_ids: ["coder", "reviewer"]
          inner_timeout_ms: 4000
        # v0.3 existing — still respected, OR-combined with auto_intercept.agent_ids
        agentDefaults:
          coder:
            enabled: true
```

### Migration

- **v0.3.0 → v0.4.0** is additive. Existing v0.3 callers (agents that
  invoke `aware-coordinate(problem, opts)` explicitly) keep working
  unchanged. The recursion guard (a) skips the hook when the tool name
  is `aware-coordinate`, so explicit calls are never double-routed.
- **Default `auto_intercept.enabled: false`** means users opt in by
  flipping one flag. No surprise behavior change.
- Recommended deployment: ship v0.4.0 with default OFF; once one agent
  has been validated with `intercept_patterns: ["<one-tool>"]`, broaden
  to `["*"]` if desired.

## Verification

Live, 2026-06-23:

- **Unit tests:** `node --test src/tests/hook.test.js` — 24/24 pass.
  Covers gate logic (3 tiers), recursion guards (a + b), string-field
  extraction precedence, param merge branches, and fail-open paths
  (coordinator down, fetch throws, recursion-triggered).
- **Regression tests:** `node --test src/tests/*.test.js` — 104/104
  pass. v0.3.0 tool surface unchanged.
- **Hook registration:** Gateway log shows
  `[plugins] hook runner initialized with 2 registered hooks` after
  v0.4 install (was 1 before — memory-stone's hooks + AWARE's new hook).
- **v0.3 compat:** explicit `aware-coordinate` invocations return HTTP
  200 across all 15 agents.
- **Mocked smoke test:** Hook end-to-end with mocked coordinator fetch:
  `original problem text` → `REFINED-AWARE-ANSWER: this is the
  coordinator output`. New params object, original unchanged.
- **Fail-open smoke test:** Hook with bad endpoint URL (`127.0.0.1:9999`)
  returns `undefined`, log shows `[warn] [aware] coordinator not-ok for
  exec (kind=unreachable); pass-through (fail-open)`.
- **Live coordinator smoke test:** Hook against real `/coordinate` returns
  `undefined` because the live coordinator's downstream model is currently
  timing out (504 Gateway Timeout from upstream) — proving the fail-open
  contract works end-to-end against a real broken coordinator.

## Trade-offs

| Pro | Con |
|---|---|
| All agents auto-route through AWARE without remembering to call it | Adds latency to every intercepted tool call (4000ms inner budget worst-case; ~25-50ms typical) |
| Honors existing opt-in via `agentDefaults.<id>.enabled` | New `auto_intercept.agent_ids` is a parallel opt-in surface — could confuse users who expect one place to control opt-in |
| Fail-open by construction — hook error never blocks tool calls | Hook logs warning on every fail-open event; could spam logs if coordinator is repeatedly down |
| `intercept_patterns` lets users start narrow and widen gradually | Glob matching is intentionally simple (`*` only) — no regex, no exclusion lists |
| Recursion guards are defense in depth | Per-run dedupe map grows up to 256 entries; cleared aggressively but not auto-shrunk |
| Schema defaults to `{ enabled: false }` — zero behavior change for non-opt-ins | `auto_intercept` field added to schema — schema drift risk if AWARE evolves |

## References

- `~/src/aware-plugin/src/hook.js` (new in v0.4.0, ~250 lines)
- `~/src/aware-plugin/src/tests/hook.test.js` (new in v0.4.0, 24 tests)
- `~/src/aware-plugin/openclaw.plugin.json` (configSchema extended)
- `~/src/aware-plugin/src/index.js` (registerHook wired into awareRegister)
- `/tmp/aware-fix-OPERATOR-NOTES.md` (separate fix for OC's runtime.ts
  sticky-active guards — without that fix, the AWARE hook could fire
  but `/tools/invoke` would still 404 because the active registry gets
  reset on each loadOpenClawPlugins call)

## Related ADRs

- ADR-031 PRM fix decision (calibration methodology)
- ADR-034 OC integration architecture (v0.1.0 InferenceStrategy design)
- ADR-035 AWARE plugin SDK audit (v0.1.0 → v0.2.0 transition)
- ADR-037 PRM noise floor (PRM empirical results)
- ADR-038 PRM T=0 fix (training signal quality)
- ADR-039 OC integration install procedure (v0.3.0 deployment)
