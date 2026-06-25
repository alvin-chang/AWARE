# ADR-022 — HeavySkill v2 (Paper-Faithful K+S) on <runtime>

**Status:** Approved
**Date:** 2026-06-15
**Author:** the AWARE maintainers
**Supersedes:** Original HeavySkill v1 design (K-PRM-refine-DPO), withdrawn 2026-06-15
**Build phase:** A1 (HeavySkill shipping surface)

---

## Context

The first HeavySkill prototype (`384466b6c2`, "refactor(heavyskill): delegate K-parallel pipeline to heavy-think library") tried to reimplement K-parallel reasoning on top of <runtime> with a Process Reward Model judge, a refinement loop, and a DPO preference-pair writer. That design was wrong on three counts:

1. **It ignored the paper.** arXiv:2605.02396 specifies K-parallel + Summarize (two stages, single model, training-free). The v1 design added three pieces of machinery (PRM, refinement, preference pairs) that the paper does not require.
2. **It crossed the plugin boundary.** v1 read from `api.config.agents.defaults.heavySkill`, which is core-owned. The OC zod schema is `.strict()`-validated; adding a plugin-specific key to the core schema is forbidden by `extensions/AGENTS.md` ("Do not normalize 'plugin-owned' into 'core-owned' by scattering direct reads of `plugins.entries.<id>.config` through unrelated core paths.").
3. **It wrote DPO preference pairs on every call.** This would have generated a lot of noise in `<host-config>/meta-rl-pipeline/` for no benefit — the paper is training-free, so the pairs were going into a void.

## Decision

v2 reimplements HeavySkill **paper-faithfully** with the following choices:

### Algorithm (from arXiv:2605.02396)

```
input: prompt, K
stage_1: fire K independent calls to base model with prompt
         gather {text, cost_usd} per attempt
stage_2: single call to base model with
         "summarize these K attempts into one final answer: \n\n" + stage_1 results
output:  {synthesis: stage_2.text, attempts: stage_1.results, cost: K+1 calls}
```

The same model is used for both stages (no PRM judge, no special model for summarization). No refinement. No preference pair writing.

### Plugin-Local Config Surface

All config lives in `api.pluginConfig` (the parsed `plugins.entries.<id>.config` object). The manifest's `configSchema` declares the shape. Core zod schemas are NOT touched.

```jsonc
// <host-config>/<runtime>.json
"plugins": {
  "entries": {
    "heavyskill": {
      "enabled": true,
      "config": {
        "defaultK": 4,           // Surface 1 default
        "autoEnable": false,     // Surface 4
        "agentDefaults": {       // Surface 2 default
          "enabled": false,
          "K": 4
        }
      }
    }
  }
}
```

### Four Activation Surfaces (priority S1 > S2 > S3 > S4)

1. **S1: model-id prefix** — `modelId.startsWith("heavyskill:") || modelId.startsWith("heavyskill-")` activates HeavySkill, K is parsed from the suffix (e.g. `heavyskill-4:minimax/primary-model` → K=4). Highest priority.
2. **S2: per-agent config** — `api.pluginConfig.agentDefaults.enabled === true` activates for every LLM call the agent makes (unless overridden by S1).
3. **S3: runtime toggle** — `/heavyskill on|off|K=N` CLI command. Per-process state.
4. **S4: auto-enable probe** — `api.registerAutoEnableProbe(() => "reason" if api.pluginConfig.autoEnable === true)`. The probe is consulted at startup; if it returns a string, the plugin auto-enables.

The first matching surface wins. The wrap hook consults all four on every LLM call (the activation resolver is in `heavy-think/src/activation.js`).

### Code Layout

- **`<heavyskill-plugin-source>/`** — standalone npm package, paper-faithful. Owns `runtime-api.js` (consumed by the OC shim). Can be installed as a third-party plugin to any OC-compatible host.
  - `src/heavy-skill.js` — the K+1-call algorithm
  - `src/activation.js` — 4-surface resolver
  - `src/runtime-state.js` — per-process `Map` for S3
  - `src/heavyskill-helpers.js` — `isHeavyskillModelId`, K parsing
  - `src/wrap.ts` — the wrap hook consumed by the OC shim
  - `dist/runtime-api.js` — built artifact (the OC shim imports from here)
  - 53/53 unit tests pass
- **`<runtime-source>/extensions/heavyskill/`** — the OC shim. Reads `api.pluginConfig`, registers provider + CLI + auto-enable probe.
  - `index.ts` — entry point
  - `<runtime>.plugin.json` — manifest with configSchema
  - `dist/` + `dist-runtime/` — compiled artifacts (both must be in sync)
  - 5/5 contract tests pass

The two layers are decoupled: heavy-think can be developed and tested standalone, and the OC shim is a thin adapter.

## Consequences

### Positive

- **Paper-faithful.** Implements exactly what arXiv:2605.02396 describes. No spurious machinery.
- **Plugin-local.** The OC core zod schema is untouched. The plugin's `configSchema` in the manifest is the single source of truth for plugin config shape.
- **Operator-tunable at runtime.** `/heavyskill on|off/K=N` lets the operator toggle HeavySkill on a live gateway without restart or config edit.
- **Composes with existing models.** The model is reused — HeavySkill wraps the call, doesn't replace the model. The same `minimax/primary-model` is used for both stages.
- **Deferrable.** Default is `enabled: false` everywhere. HeavySkill is opt-in per agent, per model, per session, or globally.

### Negative

- **K+1 calls per inference is expensive.** A K=4 call costs 5x a normal call. Operator should be deliberate about turning this on.
- **No quality improvement over the base model.** The paper's empirical gain comes from the *summarize* step, which the same model performs. If the base model can't synthesize, HeavySkill just produces a more verbose version of the same answer.
- **Two-dist-sync burden.** OC's `dist/extensions/<id>/` and `dist-runtime/extensions/<id>/` both need the up-to-date manifest. Drift causes `must NOT have additional properties` errors at boot. Mitigated by writing both copies in the same edit.

## Verification (2026-06-15)

- `curl http://127.0.0.1:18789/health` → `{"ok":true,"status":"live"}` ✅
- Gateway log: `[plugins] heavyskill already registered in this process; skipping re-register` (per config-reload) ✅
- 5/5 OC shim contract tests pass ✅
- 53/53 heavy-think unit tests pass ✅
- 8/8 heavyskill-plugin contract tests pass ✅
- `plugins.entries.heavyskill.config` accepted by OC zod (defaultK, autoEnable, agentDefaults.{enabled,K}) ✅
- 16 agents still listed at `/.well-known/agent.json` (no regression to existing channels) ✅

## Commits

- OC `495e3f5743` — heavyskill v2 paper-faithful, plugin-local config namespace
- OC `206166db9f` (parent) — refactor: extract K-parallel core to `<heavyskill-plugin-source>/`
- heavyskill-plugin `6f233d2` — fix: read plugin config from `plugins.entries.heavyskill.config` namespace
- heavyskill-plugin `b1a5cc6` (parent) — feat: paper-faithful K+S activation, 4 surfaces, single-model
