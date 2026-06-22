# ADR-035 — `~/src/aware-plugin/` v0.1.0: SDK Contract Audit + Rewrite Plan

**Status:** Proposed (drafted 2026-06-22 15:40 BST by Orchestrator Alfie)
**Date:** 2026-06-22
**Author:** Orchestrator (Alfie) on behalf of operator (Alvin)
**Relates to:** ADR-034 (OC-side integration architecture), ADR-022 (HeavySkill v2 plugin), `~/src/aware-plugin/` v0.1.0 (commit `b8ee74d`)

---

## Why this ADR exists

In the prior turn I built and committed `~/src/aware-plugin/` v0.1.0 (commit `b8ee74d`) implementing ADR-034. The plugin:

- Built a tool surface (`aware-coordinate`)
- Built a hook surface (`wrapHeavyskillInferenceStream`)
- Wrote 54 passing unit tests
- Ran end-to-end against the live AWARE stack (tool surface and hook surface both worked)

**This ADR records a critical finding from post-commit audit:** the plugin's integration layer does **not** match the actual <runtime> plugin SDK contract. It invents an API surface that doesn't exist. The plugin v0.1.0 is **not OC-compatible** and needs architectural rework.

---

## Finding 1: The invented `sdk.tools.register` and `sdk.hooks.registerInferenceStreamWrapper` API

**What I claimed in v0.1.0:**

```javascript
// provider.js
sdk.tools.register('aware-coordinate', { name, description, handler });
sdk.hooks.registerInferenceStreamWrapper('aware', wrapHeavyskillInferenceStream);
```

**What the actual OC plugin SDK exposes** (verified by reading `<HOME>/src/<runtime>/src/plugins/types.ts:1996-2086`):

| Method | Purpose |
|---|---|
| `api.registerTool(tool, opts?)` | Register an agent tool (AnyAgentTool or factory) |
| `api.registerHook(events, handler, opts?)` | Register a hook handler (for `before_agent`, `after_tool_call`, etc.) |
| `api.registerInferenceStrategy(strategy)` | Register an InferenceStrategy — the HeavySkill pattern |
| `api.registerProvider({...})` | Register a provider plugin |
| `api.registerChannel({...})` | Register a channel plugin |
| `api.registerService({...})` | Register a long-running service |

**The actual `sdk.tools.register` and `sdk.hooks.registerInferenceStreamWrapper` methods I used don't exist.** The plugin would not load against the real OC SDK.

---

## Finding 2: The actual hook surface is `registerInferenceStrategy`, not a stream wrapper

`<HOME>/src/<runtime>/src/plugins/types.ts:2067-2074` documents the canonical inference-strategy pattern:

> "Register an inference strategy that replaces a single LLM call with K parallel deliberation calls (e.g. HeavySkill). The strategy returns ONE AssistantMessage to the agent loop; K-1 non-chosen attempts' tool calls are discarded. Returning null from the strategy's `run` falls through to a single call."

**HeavySkill is the canonical example** (see `<repo-root>/src/strategy.ts` and `<repo-root>/dist/index.js`).

My hook surface in v0.1.0 was a stream wrapper that buffered chunks. That's not the contract. The contract is a strategy with `id`, `label`, `match(ctx)`, and `run(ctx) → InferenceStrategyResult | null`.

---

## Finding 3: Plugin entry shape is `definePluginEntry({...})`, not a custom `registerWith`

**What I claimed:**

```javascript
// index.js
export default function createAwarePlugin(initContext) {
  const provider = createAwareProvider({...});
  return {
    name, version, provider,
    async register(sdk) { provider.registerWith(sdk); },
    async shutdown() {...}
  };
}
```

**What the actual contract is** (HeavySkill v4 pattern, `<HOME>/src/<runtime>-worktree/extensions/heavyskill/index.js:898-925`):

```javascript
import { definePluginEntry } from "<runtime>/plugin-sdk/plugin-entry";

const awarePlugin = definePluginEntry({
  id: "aware",
  name: "AWARE 2.0 Coordinator Bridge",
  register(api) {
    api.registerTool({...});
    api.registerInferenceStrategy({...});
  }
});

export default awarePlugin;
```

The factory `definePluginEntry` is from the SDK. The plugin entry function takes an `api` parameter directly. There's no intermediate `registerWith` method.

---

## What v0.1.0 got right (and should be preserved)

1. **The schema module** (`src/schema.js`, 200 lines) — constants, request building, validation, response normalization. Pure functions, no I/O. **Reusable in the rewrite.**

2. **The client module** (`src/client.js`, 160 lines) — HTTP client wrapping fetch with timeout, error classification, response normalization. **Reusable in the rewrite, possibly with minor adjustments.**

3. **The end-to-end smoke test** — verified that the HTTP contract with `/coordinate` works. The request body shape, the response envelope, the agent_id propagation — all real and verified.

4. **The 54 unit tests** — many are still valid (schema tests, client tests for the HTTP layer). Some provider tests will need to be rewritten to match the new `InferenceStrategy` shape.

---

## Rewrite plan (ADR-035 v0.2.0)

### Phase A: Move file structure to match HeavySkill conventions

```
~/src/aware-plugin/
├── <runtime>.plugin.json     (updated — uses <runtime> SDK as peer dep)
├── package.json             (updated — adds <runtime> as devDep)
├── src/
│   ├── index.ts             (NEW — definePluginEntry + register(api))
│   ├── strategy.ts          (NEW — implements InferenceStrategy for AWARE)
│   ├── tool.ts              (NEW — implements AnyAgentTool for aware-coordinate)
│   ├── client.ts            (kept — HTTP layer, may minor adjustments)
│   ├── schema.ts            (kept — pure functions)
│   ├── activation.ts        (NEW — agentDefaults activation logic, analog of HeavySkill)
│   ├── defaults.ts          (NEW — provider constants like HEAVYSKILL_PROVIDER_ID)
│   └── tests/               (kept — most tests still valid)
```

### Phase B: Implement the new `InferenceStrategy`

The strategy needs to:

1. **Per-call gate** via `match(ctx)`: check the agentId matches an enabled agent in `agentDefaults`.
2. **Per-call run** via `run(ctx)`:
   - Call `client.coordinate({problem, K, task_type, ...})` with the K from agentDefaults
   - Get the refined_trace back
   - Synthesize an `AssistantMessage` from the refined_trace
   - Wrap it in `assistantMessageToStream()` (from `<runtime>/plugin-sdk/inference-strategy-runtime`)
   - Return `InferenceStrategyResult` with `meta.strategyId = 'aware'`, `meta.chosenReason`, etc.
3. **Fallthrough** by returning `null` if AWARE errors or the agent is not enabled.

### Phase C: Implement the `registerTool` for `aware-coordinate`

The tool handler signature is `execute(args, ctx) → Promise<result>`. My existing `provider.coordinate(args, callCtx)` signature is close — I just need to wrap it in the `AnyAgentTool` shape that includes `name`, `description`, `parameters` (JSON schema), and `execute`.

### Phase D: Verify against the actual SDK

The plugin should be installable as `pnpm install ~/src/aware-plugin` from `<HOME>/src/<runtime>` and the gateway should load it cleanly. I can verify by reading the type definitions from the SDK directly (already done in this audit) and by adding integration tests using a stub `api` object that matches the real `<runtime>PluginApi` shape.

### Phase E: Update tests + commit

Update the test suite to:
- Test the new `definePluginEntry({id, name, register})` shape
- Test the new `InferenceStrategy` shape (id, label, match, run)
- Test the new `registerTool` shape (name, description, parameters, execute)
- Keep the schema + client unit tests (they're still valid)

Commit as `aware-plugin v0.2.0` with a clear changelog entry.

---

## Why I didn't catch this before committing v0.1.0

I should have read the actual `<runtime>PluginApi` type definitions and the HeavySkill extension source **before** drafting the integration layer. Instead I:

1. Assumed `sdk.tools.register` and `sdk.hooks.registerInferenceStreamWrapper` existed based on inference (not verification)
2. Did an end-to-end smoke test against the live AWARE stack, but the smoke test only tested the HTTP layer — it never tried to load the plugin into a real gateway
3. Wrote 54 tests against my own made-up API, so the tests passed but the integration was untested

**Lesson:** for an integration layer, the end-to-end smoke test should include loading the plugin into the actual host system, not just testing the HTTP layer in isolation. v0.1.0 tested the wrong thing.

---

## Decision: rewrite or scrap

**Recommendation: rewrite v0.1.0 as v0.2.0 using the actual SDK contract.**

Reasoning:
- The schema, client, and ~80% of tests are still valid
- The HTTP contract with AWARE is verified working
- The mistake is in the integration layer, which is exactly the part that should be smallest
- v0.1.0 as committed is misleading (claims OC compatibility that doesn't exist)

**Alternative considered: scrap v0.1.0, start fresh.** Rejected because the schema, client, and end-to-end smoke test results are real and worth keeping. The rewrite is incremental.

---

## What I will NOT do in this audit response

- **Will not silently rewrite v0.1.0.** This ADR records the finding; the rewrite is a follow-up action with explicit operator visibility.
- **Will not flip AWARE_TRAINER_ENABLED=1.** The trainer enablement is still gated on ADR-029 + Repair 3 (PRM inversion) — this plugin audit doesn't change that.
- **Will not pretend v0.1.0 works.** The plugin needs the rewrite before it can be installed in the live gateway.

---

## Open questions

- **Should v0.1.0 be reverted, or kept as a development artifact?** v0.1.0 has real value (schema, client, smoke test results) but the integration layer is wrong. Decision: keep v0.1.0, add a `<internal-doc>` noting the rewrite plan, and proceed with v0.2.0.
- **What is the correct manifest format for the new SDK contract?** The current `<runtime>.plugin.json` uses fields like `hookAliases` and `entry` that may not match the actual SDK's manifest expectations. Need to verify against the actual manifest schema.
- **Does the inference strategy need to support K-parallel calls itself, or just one call to AWARE?** AWARE does the K-parallel internally. The strategy is just a thin wrapper. This simplifies the strategy implementation significantly.

---

## Related ADRs

- ADR-034 — original OC-side integration architecture (still valid; implementation is being corrected)
- ADR-022 — HeavySkill v2 plugin design (the canonical example to follow)
- ADR-029 — trainer-enable runbook (unaffected by this audit; trainer enablement is separate from plugin install)

---

*Drafted by Orchestrator (Alfie) on behalf of operator (Alvin) "Continue" directive 2026-06-22 15:40 BST. Status: Proposed. The plugin v0.1.0 is acknowledged as not-OC-compatible. Rewrite plan is documented. Implementation awaits operator direction (continue with rewrite, or pause for Archimedes review of the v0.1.0 design first).*

*This is the second time in this session that an audit found a hallucinated detail (first was the `prm+content` verification method, now this). I should be more careful about verifying integration contracts before committing. Lesson logged.*