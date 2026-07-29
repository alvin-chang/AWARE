# ADR-055 — AWARE Coverage of ISO/IEC 42001:2023

**Status:** Proposed (2026-07-28)
**Author:** Archimedes (architect)
**Reviewers:** Coder, Critic, Sentinel (auditor)
**Supersedes:** nothing — this is a new compliance integration
**Related:** ADR-040 (fail-open hook contract); ADR-043 (AST10 mapper); ADR-047 (ATLAS mapper); ADR-051 (MCP Top 10 mapper); ADR-052 (AIDEFEND mapper); decision logger at `src/audit/decision-logger.js`; tool observation proxy at `src/policies/tool-observation-proxy.js`; compliance mapper at `src/compliance/framework-mapper.js`.
**Source:** https://www.isms.online/iso-42001/annex-a-controls/ (fetched 2026-07-28; primary third-party mirror; ISO/IEC 42001:2023 standard text is paywalled and Cloudflare-walled on `iso.org` — see §"Source pinning" for the documented gap).

## Context

**ISO/IEC 42001:2023 — Information technology — Artificial intelligence — Management system** is the first AI-specific management-system standard. It inherits the Annex SL high-level structure (clauses 1–10) used by every recent ISO management-system standard (9001, 14001, 27001, 45001) and adds an Annex A of AI-specific normative controls. AWARE ships eight supported compliance frameworks (CSA AICM v1, NIST AI RMF 1.0, ISO 27001:2022, DORA, OWASP LLM Top 10, OWASP AST10, MITRE ATLAS, OWASP MCP Top 10 — nine as of ADR-052's AIDEFEND addition). ISO 42001 is the **first AI-management-system standard** in that set; the existing frameworks classify either risks (LLM Top 10, AST10, MCP Top 10), adversary techniques (ATLAS), defensive controls (AIDEFEND), or governance/operational controls (AICM, NIST AI RMF, ISO 27001, DORA). None of them answer the operator-facing question *"what AI-management-system controls does AWARE exercise, and what is the gap to ISO 42001 Annex A?"* This ADR answers that.

Research is complete (parent `t_58c42b16` by Scout, 2026-07-28; report at `~/projects/iso42001-aware/RESEARCH-REPORT.md`, 37.7 KB, 303 lines). §"Corrections" below captures the divergence between the original task body's stale components and the live AWARE tree; §"Source pinning" and §"License posture" capture the upstream-availability gap that drives the catalog license posture.

### Source pinning

The ISO/IEC 42001:2023 standard text is **paywalled and Cloudflare-walled**:

| Source | URL | Fetched | Status |
|---|---|---|---|
| ISO/IEC 42001:2023 (official catalogue page, Cloudflare-walled) | https://www.iso.org/standard/81230.html | 2026-07-28 | **Blocker** — Cloudflare bot-detection; only the metadata page is accessible (title, ICS code 35.020, technical committee ISO/IEC JTC 1/SC 42, life-cycle stage 60.60 / Published, publication date 2023-12-18). The full Annex A control text is paywalled. |
| ISO/IEC 42001:2023 (Wayback Machine snapshot) | https://web.archive.org/web/2024/https://www.iso.org/standard/81230.html | 2026-07-28 | **Metadata only** — Wayback preserves the catalogue metadata page (title, abstract, TC, ICS, life-cycle stages 2020-08-26 → 2023-12-18, SDG icons), NOT the standard body. ISO's robots policy on the live site blocks full-text archiving. |
| **ISMS.online — *ISO 42001 Annex A Controls Explained*** | https://www.isms.online/iso-42001/annex-a-controls/ | 2026-07-28 | **Primary** — public navigation list of all 38 Annex A control IDs and titles. Live page, ~330 KB, returns a clean per-control list with no JS-render dependency. Title and canonical URL both ISO-42001-specific. |

**Verdict on source availability:** The official ISO/IEC 42001:2023 Annex A control text cannot be re-hosted. The public list of control IDs + titles is available via ISMS.online (verified live, 2026-07-28). For the AWARE catalog we need **only the control IDs and short titles** — descriptions must be written by us (per §"License posture" below). Pin discipline (D1) requires the catalog header to record the ISMS.online URL + fetch date; an ISO corrigendum or amendment is a future catalog-version bump.

**Documented 38-vs-42 gap.** ISO/IEC 42001:2023 Annex A officially has **42 controls** per multiple secondary references; ISMS.online's public nav list enumerates **38** with a stable URL. The 4 missing IDs (most likely sub-controls that ISMS consolidates under parent titles — e.g. A.6.1.1 / A.6.2.1 merged into A.6.1 / A.6.2 headings) could not be retrieved from any public source. **Resolution:** v1 ships 38 (the ISMS.online subset); a future researcher card reconciles against the official Annex A when an operator has access. The ADR documents the 4-control gap rather than papering over it.

### License posture

**ISO standards are NOT Creative Commons.** The ISO catalogue terms are explicit: ISO standards are sold under license; copying, redistributing, or modifying the standard text requires ISO's written permission. The preview pages (`iso.org/standard/81230.html`) are also subject to ISO's website terms which prohibit scraping. ISO *does* allow short quotations with attribution, but a full 38-control catalog reproducing ISO's normative "shall" statements would exceed fair use.

**The catalog file must therefore contain only:**

1. **Control IDs** (e.g., `A.6.2.8`) — factual identifiers, not copyrightable.
2. **Short titles** (e.g., "AI-System Recording of Event Logs") — appear verbatim in ISMS.online's public summary; short enough to qualify as fair use from a publicly licensed source. The catalog header references ISMS.online as the source for titles (mirroring how the AICM-v1 catalog references its OpenCRE source).
3. **Our own short descriptions** (≤200 chars, paraphrased) — required by the task acceptance criteria AND by license posture. None of the descriptions in the catalog reproduce ISO normative text.

**Attribution in the catalog file header (recommended for the coder, mirrors §D2 below):**

```js
// SPDX-License-Identifier: Apache-2.0
// Control IDs and titles sourced from ISMS.online's public summary of
// ISO/IEC 42001:2023 Annex A (https://www.isms.online/iso-42001/annex-a-controls/,
// fetched 2026-07-28). Short descriptions are paraphrased and not derived from
// ISO's normative text. ISO/IEC 42001:2023 is the property of ISO and is NOT
// Creative Commons — the catalog does not reproduce ISO standard text.
```

**No verbatim ISO text anywhere in the repo** (per acceptance criterion). The catalog file, this ADR, and any subsequent compliance-report output use only control IDs + titles + our own descriptions.

**Comparison to existing AWARE catalogs (license posture precedent):**

| Catalog | Source license | How AWARE handles it |
|---|---|---|
| `aicm-v1-catalog.js` | CSA AICM v1 (public, with CSA's terms) | Header cites the OpenCRE mirror; descriptions paraphrased; control IDs + short names verbatim. |
| `atlas-catalog.js` | MITRE ATLAS (CC BY-NC-SA 4.0) | Subset only (~30 of 170+); full upstream citation in header. |
| `ast10-catalog.js` | OWASP AST10 (CC BY-SA 4.0) | Full catalog shipped; attribution in file header. |
| `mcp-top10-catalog.js` | OWASP MCP Top 10 (CC BY-SA 4.0) | Full catalog shipped; attribution in file header. |
| `aidefend-catalog.js` (ADR-052) | AIDEFEND (CC BY 4.0) | Full 357-entry catalog; attribution block in header. |
| **`iso42001-catalog.js` (proposed)** | **ISO/IEC 42001 (NOT Creative Commons, paid standard)** | **Control IDs + short titles from public third-party mirror (ISMS.online); descriptions all paraphrased; no ISO text reproduced. Catalog header records the third-party source URL + fetch date for audit.** |

ISO 42001 is the **only AWARE catalog whose upstream source is NOT Creative Commons**. The license posture is more restrictive than AIDEFEND, ATLAS, AST10, MCP Top 10, and the catalog must enforce it at the source-of-truth boundary (D2 attribution block).

### Corrections to the originating task body

The research task body (`t_58c42b16`) named two specifics that don't match reality at fetch time:

| Claim | Upstream reality | Resolution |
|---|---|---|
| `src/circuit-breaker/` and `src/coordinator/ewc-client.js` as AWARE components | Neither directory/file exists in the current `src/` tree (verified via `search_files`) | Crosswalk is based on the 12 components enumerated in `framework-mapper.js`'s `AWARE_COMPONENT_MAPPINGS`; the four A.8.4 incident-communication mappings use `kill-switch` + `anomaly-detection`, not `circuit-breaker`. |
| 42-control ISO standard accessible to researcher | Paywalled + Cloudflare-walled; only 38 control IDs retrieved via ISMS.online | Ship v1 with 38; future reconciliation card when official text is available. |

The 38-vs-42 delta is the most consequential: the catalog subset scope is computed from this number. With 38 IDs, v1 covers the ISMS.online subset; the remaining 4 are documented as a known gap.

### Scope statement

> **AWARE asserts coverage of the AI-specific subset of ISO/IEC 42001:2023 — namely Annex A controls A.2.2 through A.10.4 (the 38 controls enumerated in the research report). AWARE does NOT assert coverage of the management-system body (clause 4–10), which is an organisational responsibility outside AWARE's scope. AWARE does NOT claim ISO/IEC 42001:2023 certification; the framework-mapper entry is a *control-coverage* assertion, not a *certification* claim.**

This scope is verbatim from §6.3 of the research report and is the load-bearing sentence for the ADR. Two non-trivial boundaries it sets:

- **Clauses 4–10 are NOT in AWARE's coverage claim.** The management-system body (context, leadership, planning, support, operation, performance evaluation, improvement) is an organisational responsibility — process artefacts, management review, internal audit, competence records. AWARE's existing `ISO_27001` block in `framework-mapper.js` (lines 68–77) only enumerates Annex A categories, not the clause 4–10 body, and the same posture applies here.
- **No certification claim.** The catalog and any compliance-report output must not say "AWARE is ISO 42001 certified" or "AWARE implements an ISO 42001 management system." It says "AWARE exercises the following controls against the following Annex A entries." The phrase *control-coverage* is the only acceptable operator-facing wording.

## Decision

**Add ISO/IEC 42001:2023 Annex A as a tenth supported framework in `src/compliance/framework-mapper.js`, ship a dedicated `src/compliance/iso42001-catalog.js` (versioned snapshot of the 38-control ISMS.online subset) — mirroring the AST10 + ATLAS + MCP Top 10 + AIDEFEND mapper shape from ADR-043 / ADR-047 / ADR-051 / ADR-052.** No changes to `src/policies/` modules in this ADR — they consume compliance annotations via `decision-logger.js`, not by growing their own ad-hoc ISO 42001 table.

Per-entry `awareness: 'mapped' | 'partial' | 'gap'` marking on the 38-control catalog (D3 below), following the AIDEFEND pattern (ADR-052 §D3) but with the *three-class* taxonomy (mapped / partial / gap) instead of AIDEFEND's two-class (mapped / informational) — because ISO 42001 has a meaningful *partial* tier that AIDEFEND's catalogue lacks.

### Architectural decisions

#### D1 — Data source: ISMS.online third-party mirror at build time, pinned to fetch date + URL

The task body offered no explicit data-source options. The structural options, evaluated:

| | (a) ISMS.online + pin (recommended) | (b) ISO direct purchase | (c) Cached ISO preview |
|---|---|---|---|
| Offline / reproducible | ✅ snapshot in-tree | ✅ snapshot in-tree | ⚠️ metadata only |
| License attribution travels with content | ✅ ISMS.online attribution in header | ✅ ISO attribution in header | ❌ no normative text |
| Survives upstream restructure / takedown | ✅ snapshot pinned | ✅ snapshot pinned | ⚠️ ISO page may rotate |
| Schema validation at build time | ✅ snapshot script | ✅ | ❌ |
| Operational footprint | None | ISO purchase (paid; org-level decision) | None |
| Drift visibility | Build log | Manual re-pin | None |

Architecture picks **(a) ISMS.online + pin**. (b) is a future option if the operator ever purchases ISO 42001 access — at which point a reconciliation researcher card updates the catalog. (c) is rejected because the ISO preview page contains only the catalogue metadata, not Annex A control text.

**Snapshot script:** `scripts/snapshot-iso42001-catalog.js`, modelled on `scripts/snapshot-aidefend-catalog.js` (ADR-052 acceptance criterion).

- Fetch `https://www.isms.online/iso-42001/annex-a-controls/` at the current state. Resolve the actual page modification timestamp via the HTTP `Last-Modified` header (or page-version query parameter) so the snapshot records the source date, not a moving URL.
- Validate that the page returns the expected 38 control IDs (A.2.2 through A.10.4) and that the response is non-empty HTML (no JS-render dependency).
- Emit `src/compliance/iso42001-catalog.js` as a frozen JS module with the attribution comment block (D2) and SPDX header.
- Refuse to overwrite if the ISMS.online URL returns the same `Last-Modified` date as the last snapshot (idempotency; bumps require explicit `--force`).

**Pin discipline:**

- The catalog header pins the ISMS.online fetch URL + fetch date. No floating re-fetches at runtime.
- An ISO corrigendum or amendment that adds/renumbers controls is a NEW AWARE release and a NEW catalogue file (e.g., `iso42001-catalog-2026.xx.xx.js`). Mid-cycle upstream changes are a coordinated update, not an in-place fix.
- The mapper imports from `./iso42001-catalog` — no direct upstream URL. This is the same separation ADR-047 / ADR-052 enforce for ATLAS / AIDEFEND.

#### D2 — Catalog file header: SPDX Apache-2.0 + ISMS.online attribution block

The catalog file is AWARE-authored code; its SPDX-License-Identifier stays `Apache-2.0`. The third-party content (control IDs + short titles from ISMS.online) travels with attribution in the file header, NOT as the SPDX license (the SPDX tooling that AWARE's build pipeline uses to license-check code files would mis-classify the catalog if the SPDX itself read "CC" or "ISO licensed").

**Header block (recommended for the coder, mirror §"License posture" above):**

```js
// SPDX-License-Identifier: Apache-2.0
// ISO/IEC 42001:2023 — AWARE Compliance Catalog
//
// Control IDs and titles sourced from ISMS.online's public summary of
// ISO/IEC 42001:2023 Annex A:
//   https://www.isms.online/iso-42001/annex-a-controls/
//   (fetched 2026-07-28; 38-control subset of the 42-control official Annex A)
//
// Short descriptions are paraphrased and not derived from ISO's normative
// text. ISO/IEC 42001:2023 is the property of ISO and is NOT Creative
// Commons — the catalog does not reproduce ISO standard text.
//
// Pin discipline: any ISO corrigendum or amendment that adds/renumbers
// controls is a NEW AWARE release; do NOT edit this file in place.
// Mid-cycle upstream changes are a coordinated update via the snapshot
// script (scripts/snapshot-iso42001-catalog.js).
//
// AWARE does NOT claim ISO/IEC 42001:2023 certification. The framework-mapper
// entry is a control-coverage assertion, not a certification claim.
```

The license posture is more restrictive than AIDEFEND, ATLAS, AST10, MCP Top 10 (those upstream sources ARE CC; this one is not). The header is the single load-bearing artifact that keeps the catalog compliant — losing it is a license violation, not a style drift.

#### D3 — Catalogue scope: 38 controls in v1, mark per-entry `awareness: 'mapped' | 'partial' | 'gap'`

Per the research report §6.1:

- **13 `mapped`** — direct AWARE evidence (A.3.2, A.4.2, A.4.4, A.6.1.3, A.6.2.3, A.6.2.4, A.6.2.6, A.6.2.8, A.8.3, A.8.4, A.9.2, A.9.4, A.10.3).
- **19 `partial`** — AWARE contributes but is not the primary evidence source (A.2.2, A.2.3, A.2.4, A.3.3, A.4.3, A.4.5, A.6.1.2, A.6.2.2, A.6.2.5, A.6.2.7, A.7.2, A.7.3, A.7.4, A.7.5, A.8.2, A.8.5, A.9.3, A.10.2, A.10.4).
- **6 `gap`** — the org-level concerns (A.4.6) and the A.5 impact-assessment cluster (A.5.2, A.5.3, A.5.4, A.5.5) and the A.7 data-quality subset (A.7.6).

**Why three classes, not AIDEFEND's two.** AIDEFEND's `mapped | informational` taxonomy treats anything AWARE doesn't directly enforce as *informational*. ISO 42001 has a meaningful middle tier: AWARE **partially** satisfies the control (some evidence, one hop away) vs **no** AWARE surface at all. The compliance report renders all three classes — `mapped` (green) / `partial` (amber) / `gap` (red) — so an operator can see "AWARE gives direct evidence for 13 controls, partial for 19, and does not cover 6." Folding *partial* into *gap* would understate the real coverage; folding *gap* into *partial* would hide the headline A.5 follow-up.

**Per-entry shape (mirroring ADR-052 §D3):**

```js
'A.6.2.8': {
  name: 'AI-System Recording of Event Logs',
  // Description paraphrased; not derived from ISO normative text.
  description: 'Event logs for AI-system behaviour, decisions, and operator actions (audit trail).',
  awareness: 'mapped',            // 'mapped' | 'partial' | 'gap'
  awareComponents: ['decision-logger'],  // primary AWARE evidence source
  crosswalkConfidence: 'H',       // H | M | L — verbatim from research §4
  ismsRef: 'https://www.isms.online/iso-42001/annex-a-controls/#a-6-2-8',
}
```

#### D4 — `framework-mapper.js` block shape (mirror OWASP_AST10 at lines 131-152)

The `framework-mapper.js` block follows the same shape as the existing `OWASP_AST10` block (lines 131–152 of `src/compliance/framework-mapper.js`). Schema:

```js
// In src/compliance/framework-mapper.js, alongside the existing
// OWASP_MCP_TOP_10 block (lines 165-173). Per ADR-055.
//
// ISO/IEC 42001:2023 — AI Management System. Annex A control set is the
// 38-control ISMS.online subset (the public third-party mirror; the
// official 42-control set is paywalled + Cloudflare-walled on iso.org).
// Catalog pinned to fetch 2026-07-28; ISO corrigendum = new AWARE release
// (D1).
//
// License posture: ISO standards are NOT Creative Commons; the catalog
// uses control IDs + short titles from the public ISMS.online mirror
// and paraphrased descriptions. No ISO normative text reproduced
// anywhere in the repo. SPDX stays Apache-2.0 for the code; attribution
// to ISMS.online lives in the catalog file header (D2).
//
// Scope statement: AWARE asserts Annex A control coverage only. Does
// NOT assert clause 4-10 (management-system body) coverage. Does NOT
// claim ISO/IEC 42001:2023 certification.
ISO_42001: {
  id: 'ISO_42001',
  name: 'ISO/IEC 42001:2023 — AI Management System',
  version: 'v1.0-2026-07-28',
  source: 'https://www.isms.online/iso-42001/annex-a-controls/',
  // Per ADR-055 D1: pin URL + fetch date; ISO corrigendum = new release.
  pinDate: '2026-07-28',
  // Per ADR-055 D2: SPDX stays Apache-2.0; attribution in catalog header.
  license: 'Apache-2.0 (code) / no upstream CC (control IDs + titles from ISMS.online)',
  attribution: 'Control IDs and titles sourced from ISMS.online public summary of ISO/IEC 42001:2023 Annex A (fetched 2026-07-28). Descriptions paraphrased; no ISO normative text reproduced.',
  catalogRef: './iso42001-catalog',
  controls: ISO_42001_CONTROLS,        // 38 entries from iso42001-catalog.js
  controlIds: ISO_42001_CONTROL_IDS,   // flat 38-entry list
  // Per ADR-055 D3: per-entry awareness: 'mapped' | 'partial' | 'gap'.
  // 13 mapped / 19 partial / 6 gap of 38 (research §6.1).
  scopeNote: 'Annex A control coverage only; does NOT assert clause 4-10 management-system body coverage; does NOT claim certification.'
}
```

#### D5 — `AWARE_COMPONENT_MAPPINGS` rows (additive per existing component)

Each existing component gets an `ISO_42001: [...]` array (per ADR-047 + ADR-051 + ADR-052 §2.2 / §D7 pattern). Draft values (refined by the implementation card, distilled from research §4):

| Component | ISO 42001 IDs |
|---|---|
| `decision-logger` | `A.6.2.3`, `A.6.2.8` (CANONICAL), `A.7.5` |
| `agent-registry` | `A.3.2`, `A.4.2`, `A.4.3`, `A.4.5`, `A.6.2.2`, `A.6.2.5`, `A.9.4`, `A.10.2` |
| `tool-catalog` | `A.4.4` |
| `tool-access-control` | `A.6.1.3`, `A.7.3`, `A.9.2` |
| `sandbox-policies` | `A.6.1.3` |
| `identity-provider` | `A.3.2`, `A.10.3` |
| `security-heuristic` | `A.6.2.4`, `A.6.2.2` |
| `anomaly-detection` | `A.3.3`, `A.6.2.4`, `A.6.2.6`, `A.8.4` |
| `behavioral-baseline` | `A.6.2.4`, `A.9.4` |
| `tool-observation-proxy` | `A.3.3`, `A.4.3`, `A.6.2.6` |
| `kill-switch` | `A.6.2.6`, `A.8.4` |
| `compliance-mapping` | `A.2.2`, `A.2.3`, `A.2.4`, `A.6.1.2`, `A.6.2.7`, `A.8.2`, `A.8.3`, `A.8.5`, `A.9.3`, `A.10.4` |
| `pheromone-specialists` | (none — heuristic-only; same exclusion as AST10 + MCP Top 10 + AIDEFEND) |
| `credential-classifier` | `A.7.4` |

The implementation card refines these against the actual catalog entries — the architect values are directional, not exhaustive. `decision-logger`'s `A.6.2.8` mapping is the canonical load-bearing one (research §4 headline finding).

### Integration points

Same three integration points as AST10 (ADR-043), ATLAS (ADR-047), MCP Top 10 (ADR-051), and AIDEFEND (ADR-052):

1. **Tool-observation proxy** (`src/policies/tool-observation-proxy.js`, `observeAndForward`): every tool call gets a pre-decision observation; the ISO 42001 catalog is consulted (read-only) to annotate which Annex A controls the AWARE machinery is exercising. The chain carries all annotations on the same `parentDecisionId`. ISO 42001 does NOT need a separate mapper module like AIDEFEND does — the catalog is a static reference set, not a per-event annotator.
2. **Memory-write path** (when an agent writes `MEMORY.md`, `AGENTS.md`, `SOUL.md`): tagged with the `decision-logger` chain which carries `A.6.2.8` as the audit evidence. ISO 42001 doesn't add a new memory-write annotation; it shares AST10 + ATLAS annotations.
3. **Skill-load events** (when the agent registry loads a new skill): tagged with `A.4.4` (tooling resources) via `tool-catalog` + `A.6.2.3` (documentation of design & development) via `decision-logger`. Same AST10 + AIDEFEND events, enriched with ISO 42001 IDs.

ISO 42001 is **annotation-only at the framework-mapper level** — there is no per-event ISO 42001 mapper module. The compliance report renders the static crosswalk (D5) alongside the live AST10 / ATLAS / MCP Top 10 / AIDEFEND per-event annotations. This is the right blast radius: ISO 42001 is a *framework reference*, not a *per-event classifier*.

### Crosswalk summary

The 13 strong mappings (H confidence, AWARE directly emits the evidence) are the load-bearing evidence. **A.6.2.8 (event logs) → `decision-logger` is the canonical one** — every `tool_dispatch`, `tool_observation`, `kill_switch_invoke`, `audit_replay_complete` source event in the decision-logger chain is the A.6.2.8 evidence.

| Confidence | Count | Controls |
|---|---|---|
| **H (mapped)** | 13 | A.3.2, A.4.2, A.4.4, A.6.1.3, A.6.2.3, A.6.2.4, A.6.2.6, A.6.2.8, A.8.3, A.8.4, A.9.2, A.9.4, A.10.3 |
| **M (partial)** | 19 | A.2.2, A.2.3, A.2.4, A.3.3, A.4.3, A.4.5, A.6.1.2, A.6.2.2, A.6.2.5, A.6.2.7, A.7.2, A.7.3, A.7.4, A.7.5, A.8.2, A.8.5, A.9.3, A.10.2, A.10.4 |
| **L (gap)** | 6 | A.4.6, A.5.2, A.5.3, A.5.4, A.5.5, A.7.6 |

**Headline gap: A.5 impact-assessment cluster** (4 controls: A.5.2, A.5.3, A.5.4, A.5.5). AWARE has no impact-assessment workflow today. The closest existing surfaces are `security-heuristic` and `pheromone-specialists` for risk scoring, but neither produces a documented impact-assessment record. **This is the highest-priority follow-up** — a separate architect card to design an impact-assessment module that satisfies A.5.2–A.5.5 (decision: build inside the existing audit chain per ADR-040 fail-open contract, or as a separate workflow).

### Public release gating

The catalog touches the public-published audit interface. ADR recommends ship on `main` first; cherry-pick to `public/v2.8.x` per `docs/security/branch-discipline.md` once the ISMS.online source stabilises and we have signal that the 38-vs-42 reconciliation question is closed. This matches ADR-047 / ADR-051 / ADR-052's public release gating disposition.

## Consequences

### Positive

- AWARE's compliance posture gains the **first AI-management-system standard** in the set. An auditor can ask *"which ISO 42001 Annex A controls does AWARE exercise, and what's the gap to the full 38?"* and the framework-mapper entry answers with annotated awareness classes, not hand-curated summaries.
- The **A.6.2.8 → decision-logger canonical mapping** is the load-bearing ISO 42001 evidence: the hash-chained audit log is exactly what ISO 42001 Annex A.6.2.8 ("AI-System Recording of Event Logs") requires. AWARE's existing audit machinery satisfies this control by construction — no new code is needed for the strongest mapping.
- The **per-entry `awareness: 'mapped' | 'partial' | 'gap'` marking** renders a three-class compliance view that the existing two-class AIDEFEND taxonomy can't. Operators can distinguish "AWARE has direct evidence" from "AWARE contributes but is not primary" from "no AWARE surface at all."
- The **catalog header attribution block** keeps the SPDX tooling clean (Apache-2.0 stays) while the third-party attribution travels as a comment, mirroring the AIDEFEND pattern that ADR-052 verified.

### Negative / costs

- **No per-event ISO 42001 mapper.** Unlike AIDEFEND, ISO 42001 doesn't ship a per-event classifier. The compliance report renders the static crosswalk (D5) on demand rather than annotating each event. This is the right blast radius for a management-system framework, but a new operator reading the report may wonder why ISO 42001 annotations are absent from the per-event view (they're present in the framework-mapper, not the event chain).
- **38-vs-42 reconciliation is open.** The v1 catalog ships 38 controls with a documented gap. A future ISO purchase or operator-access reconciliation card will close the gap; until then, the compliance report must render the 4 missing IDs as *not in catalog* rather than *gap*. The catalog header documents the gap (D2 attribution block).
- **Headline gap: A.5 impact-assessment cluster.** No impact-assessment workflow exists in AWARE today. The catalog marks these 4 controls `gap`; the follow-up design work is a separate architect card (impact-assessment module design). This is the most visible compliance weakness in the v1 catalog and operators will see it first.
- **License posture is human-driven.** The catalog header must carry the exact attribution string from §"License posture". A CI check (`scripts/verify-iso42001-attribution.sh`) parses the header and fails the build if the attribution block drifts. The check is a follow-up — out of scope for this ADR.
- **Description paraphrase is human-driven.** Each of the 38 catalog entries has a ≤200-char description written by us. A reviewer must verify each description does not lift ISO normative text. The snapshot script (D1) cannot do this automatically; a manual review at snapshot time is required. Future automation (e.g., a vector-similarity check against the ISO preview metadata) is a future ADR.

### Failure modes (mandatory section)

- **The catalogue can't be loaded.** Surface as `ISO_42001_CATALOG_UNAVAILABLE` in `/health`; refuse to start the hook. **Why:** the framework-mapper entry is meaningless without a pinned catalogue; fail closed beats fail silent (same posture as AST10 + ATLAS + MCP Top 10 + AIDEFEND).
- **The decision-logger is unavailable.** The catalog is annotation-only at the framework-mapper level, so a `logDecision` failure does not block the originating tool call (ADR-040 fail-open contract). The framework-mapper entry continues to render from the static catalog. **Why:** ISO 42001 is not a per-event classifier; the audit chain failure is not an ISO 42001 failure.
- **A.6.2.8 evidence miss.** If the decision-logger chain has a gap (e.g., `audit_replay_complete` reports `gapCount > 0`), the A.6.2.8 evidence is incomplete. Surface as `ISO_42001_A6628_GAP_DETECTED` in the compliance report; do NOT auto-correct the audit chain (append-only and tamper-evident). **Why:** the chain's integrity IS the A.6.2.8 evidence; corruption would invalidate the strongest single ISO 42001 mapping.
- **ISO corrigendum renumbers or restructures a control ID.** `iso42001-catalog.js` is pinned to fetch `2026-07-28`; an upstream rename → new AWARE release → new catalogue file (e.g., `iso42001-catalog-2026.xx.xx.js`). **Why:** the catalog and the framework-mapper crosswalk are co-versioned; mid-cycle upstream changes are a coordinated update, not an in-place fix.
- **ISMS.online takedown or restructure.** If the upstream mirror goes dark, the catalog continues to load from the in-tree snapshot. The `pinDate` in D2 records when the snapshot was taken; the snapshot script refuses to overwrite if the upstream is unreachable. **Why:** same posture as D1 — offline / reproducible is the structural choice.
- **Description drift toward ISO normative text.** If a reviewer or future coder pastes ISO standard text into a description, the catalog license posture is violated. Mitigation: the ≤200-char cap + the snapshot-script paraphrase check (manual today, automated follow-up) + the catalog-header attribution block that names ISMS.online (not ISO) as the source.

## Acceptance criteria

- [ ] `src/compliance/iso42001-catalog.js` ships a frozen catalogue with the 38-control ISMS.online subset, marked per-entry `awareness: 'mapped' | 'partial' | 'gap'` per §D3. The attribution comment block cites ISMS.online as the third-party source (URL + fetch date 2026-07-28); `// SPDX-License-Identifier: Apache-2.0` is the SPDX header. No ISO normative text reproduced anywhere in the file.
- [ ] `src/compliance/framework-mapper.js` gains an `ISO_42001` block per §D4 (mirroring the OWASP_AST10 block shape at lines 131–152), and each existing `AWARE_COMPONENT_MAPPINGS` row gains an `ISO_42001: [...]` array per §D5.
- [ ] No per-event ISO 42001 mapper module (annotation-only at the framework-mapper level per §"Integration points"). The static crosswalk renders in the compliance report alongside the live AST10 / ATLAS / MCP Top 10 / AIDEFEND per-event annotations.
- [ ] `scripts/snapshot-iso42001-catalog.js` fetches the ISMS.online page, resolves the fetch date via the HTTP `Last-Modified` header (or page-version query parameter), validates that 38 control IDs are present, and emits the catalog file with the attribution block per §D1.
- [ ] `scripts/verify-iso42001-attribution.sh` (or equivalent CI check) parses the catalog file header and fails the build if the attribution block drifts.
- [ ] Tests assert: catalog file shape (38 control count, no duplicates, all controls have name + description + awareness + awareComponents); smoke test for `getFrameworkControls('ISO_42001')` returning the expected subset; per-control `awareness` class matches the research report §6.1 breakdown (13 mapped / 19 partial / 6 gap).
- [ ] No ISO/IEC 42001:2023 standard text reproduced anywhere in the repo (catalog file, ADR, compliance reports, or downstream code). Only control IDs + short titles + paraphrased descriptions.

## Out of scope (per project-memory rule)

- Don't write the catalog file (`iso42001-catalog.js`) — that's a coder follow-up card.
- Don't add the framework-mapper.js `ISO_42001` block — coder follow-up.
- Don't write impact-assessment module design (A.5 cluster) — separate follow-up card.
- Don't push to public GitHub.

## Successor work (cards to file after this ADR lands)

These are the natural follow-up cards, ranked by importance (verbatim from research §6.4):

1. **Coder:** Create `src/compliance/iso42001-catalog.js` (mirror `aicm-v1-catalog.js` shape per §D3) and add the `ISO_42001` block to `src/compliance/framework-mapper.js` per §D4. Each `AWARE_COMPONENT_MAPPINGS` row gets an `ISO_42001: [...]` array per §D5.
2. **Architect (separate card):** Crosswalk ISO 42001 ↔ MITRE ATLAS / AST10 / AICM v1 / OWASP LLM Top 10 / MCP Top 10. Documents the AI-specific controls AWARE already covers under other frameworks. The existing-framework coverage lets the compliance report say "this ISO 42001 control is *also* covered under these other frameworks" — a structural answer to a recurring operator question.
3. **Architect (separate card):** Design and prototype an **impact-assessment module** that satisfies A.5.2–A.5.5. This is the headline AWARE gap. The design should decide whether to build inside the existing audit chain (per ADR-040 fail-open contract) or as a separate workflow.
4. **Researcher (separate card):** When an operator has access to the official ISO/IEC 42001:2023 text, do a 38-vs-42 reconciliation and add the 4 missing controls.
5. **Tester:** Add tests per the pattern in `aicm-v1-catalog.js` test suite (control count, no duplicates, all controls have name + description + awareness + awareComponents, smoke test for `getFrameworkControls('ISO_42001')`, per-control `awareness` class breakdown).

---

**End of ADR-055. Hand off to coder (catalog + framework-mapper entry) and follow-up cards.**