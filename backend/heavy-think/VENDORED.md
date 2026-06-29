# Heavy-Think — Vendored Copy

**Source**: hosted fork of Hermes's heavy-think (Nous Research)
**Vendored on**: 2026-06-29
**Reason**: AWARE v2.8.0 vendor-copy. Heavy-think + T=0 PRM fix.
**License**: Apache-2.0 (preserved in LICENSE)

## What this is

A pre-installed copy of the **K-parallel + summarize reasoning primitive**
(`heavy-think`), including the T=0 PRM judge fix that eliminated sampling-
noise floor issues in PRM-based answer selection (per ADR-038).

Provides:
- K-by-task-type parallel reasoning attempts
- PRM-based scoring with T=0 temperature for deterministic ranking
- Refine-then-verify pipeline with `verify.js`
- Preference-pair writing for downstream DPO training

## Public surface

This vendored copy is sanitized of operator-private configuration
references. Provider env-var names that identify the runtime model
vendor and host-path references to private runtime config locations
have been replaced with generic placeholders. Deployers using this
public copy set the corresponding values in their own environment.

### Runtime variables (set in deployer env)

| Reading | Generic placeholder | Set to |
|---|---|---|
| `process.env.LLM_API_KEY` | `<OLD_PROVIDER_KEY>` was the prior name | `LLM_API_KEY` value |
| `${OPENCLAW_CONFIG}/openclaw.json` | `<OLD_HOST_CONFIG>/openclaw.json` was the prior location | Path to your openclaw.json |
| `${OPENCLAW_AUDIT_LOG}/security.jsonl` | `<OLD_AUDIT_LOG>/security.jsonl` was the prior location | Path to your audit log |

If you migrated from the prior naming, set your deployer environment
to map `<OLD_PROVIDER_KEY>` → your existing key value, etc. Or just set
`LLM_API_KEY` directly — the GH build reads it.

## Source SHA

The vendor was copied from upstream at a specific commit. Source SHA is
recorded in the commit message that introduced this directory (see git
log for `backend/heavy-think/`).

## License

Apache-2.0 (see LICENSE). Compatible with AWARE's licensing.

## Verifications

Original verification: 130/130 heavy-think tests green on the
sanitized vendor, including:
- contract.test.js (3 tests)
- heavy-think.test.js (10 tests)
- mr-high-002-system-prompt-isolation.test.js (8 tests)
- rlm.test.js (20 tests)
- rlm/*.test.js (75 tests)
- unit/minimax-client.test.js (7 tests)
- unit/minimax-client-temperature.test.js (7 tests)

## Source attribution

- Heavy-think is part of the Hermes agent framework by Nous Research.
- Apache-2.0 license preserved per upstream.

## Notes

- The vendored source is upstream-exact in behavior; only the
  configuration-string names + private host paths were renamed.
- SHA-rewrite safety verified per Archimedes verdict (c): the
  `preference-pair.js hashContent` builds SHA-256 over content,
  not git revisions; trainer reads pair paths opaquely.
- Operator-internal tooling (sanitization script, internal
  re-sync procedure) is NOT included in this public copy.
  See git history for the operator-internal versions.
