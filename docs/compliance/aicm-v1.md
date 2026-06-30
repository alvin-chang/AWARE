# CSA AI Controls Matrix (AICM) v1 — Coverage

**Last updated:** 2026-06-30
**Source spec:** Cloud Security Alliance, _AI Controls Matrix v1_ (released 2025-07-09, updated 2025-10-30)
**Spec URL:** https://cloudsecurityalliance.org/artifacts/ai-controls-matrix
**AICM version supported:** v1 (243 controls across 18 domains per CSA's published count)
**AWARE coverage:** 184 verified control IDs across all 18 domains

## Why this document exists

AWARE's `src/compliance/framework-mapper.js` previously shipped with placeholder
AICM control IDs (`AI.ID-01`, `AI.OPS-04`, `AI.MT-01`, `AI.OT-02`) that **do
not exist in the CSA AICM spec**. They were invented during early prototyping
to give the framework mapper a non-empty shape before real AICM data was
available.

This document records the migration from those placeholders to real AICM v1
control IDs, explains the data sources used, and documents the 76% coverage
gap (184/243) with a plan to close it.

## Coverage summary

| Metric | Value |
|---|---|
| AICM v1 domains | 18 (per CSA) |
| AICM v1 total controls | 243 (per CSA) |
| AWARE AICM v1 controls | 184 |
| Coverage | 76% (184/243) |
| Domains fully represented | 18/18 (every domain has at least 2 controls mapped) |
| AWARE components mapped to AICM | 10 (agent-registry, sandbox-policies, behavioral-baseline, kill-switch, pheromone-specialists, security-heuristic, identity-provider, anomaly-detection, tool-access-control, compliance-mapping) |

## The 18 AICM v1 domains

| Code | Domain | AWARE controls mapped |
|---|---|---|
| `A&A` | Audit & Accountability | 6 |
| `AIS` | Application & Interface Security | 11 |
| `BCR` | Business Continuity Mgmt & Operational Resilience | 10 |
| `CCC` | Change Control & Configuration Mgmt | 7 |
| `CEK` | Cryptography, Encryption & Key Mgmt | 14 |
| `DCS` | Datacenter Security | 13 |
| `DSP` | Data Security & Privacy | 19 |
| `GRC` | Governance, Risk Mgmt & Compliance | 8 |
| `HRS` | Human Resources Security | 10 |
| `I&S` | Interoperability & Sharing | 9 |
| `IAM` | Identity & Access Mgmt | 10 |
| `IPY` | Interoperability & Portability | 2 |
| `LOG` | Logging & Monitoring | 10 |
| `MDS` | Model Security (AI-specific, new in AICM v1) | 9 |
| `SEF` | Security Incident E-Response & Mgmt | 8 |
| `STA` | Supply Chain Mgmt, Transparency & Accountability | 14 |
| `TVM` | Threat & Vulnerability Mgmt | 13 |
| `UEM` | Universal Endpoint Mgmt | 11 |

**Total: 184 controls across 18 domains.**

`MDS` (Model Security) is the AI-specific domain new to AICM v1 — it covers
model documentation, validation, monitoring, and adversarial testing for ML/LLM
systems. AWARE's `behavioral-baseline`, `anomaly-detection`, and
`pheromone-specialists` components map into `MDS-*` controls directly.

## AWARE component → AICM v1 control mapping

The authoritative mapping lives in
[`src/compliance/framework-mapper.js`](../../src/compliance/framework-mapper.js).
Summary:

| AWARE component | AICM v1 controls |
|---|---|
| `agent-registry` | `IAM-01`, `GRC-02` |
| `sandbox-policies` | `AIS-08`, `DSP-17`, `UEM-13` |
| `behavioral-baseline` | `LOG-03`, `MDS-05` |
| `kill-switch` | `SEF-03`, `LOG-13` |
| `pheromone-specialists` | `TVM-08`, `MDS-08` |
| `security-heuristic` | `TVM-01`, `GRC-09` |
| `identity-provider` | `IAM-04`, `IAM-09`, `CEK-21` |
| `anomaly-detection` | `LOG-05`, `MDS-09`, `SEF-06` |
| `tool-access-control` | `IAM-08`, `DSP-05`, `AIS-07` |
| `compliance-mapping` | `GRC-04`, `A&A-05` |

The mapping rationale for each component is documented inline in
`framework-mapper.js` (Phase labels and intent comments).

## Data sources

AICM v1 control data in AWARE comes from a **public CSV mirror** of the CSA
artifact:

| Source | URL | Use |
|---|---|---|
| OpenCRE TRACT repo | https://github.com/rocklambros/TRACT/blob/main/opencre_export/CSA_AI_Controls_Matrix.csv | 184/243 controls — the OpenCRE-exported subset that has been mapped to other frameworks (NIST 800-53, ISO 27001, etc.) |
| CSA artifact page | https://cloudsecurityalliance.org/artifacts/ai-controls-matrix | Marketing copy + the full 243/18 numbers; the actual spreadsheet download is gated behind a registration form |
| Open Security Architecture | https://www.opensecurityarchitecture.org/frameworks/csa-aicm/controls/ | Read-only mirror of CSA AICM v1.0.3 control IDs cross-mapped to NIST SP 800-53 |

**Why we use the OpenCRE subset, not the full CSA spreadsheet:**

The CSA AICM spreadsheet (243 controls) is downloadable only after submitting a
free registration form on the CSA website. The OpenCRE TRACT repo hosts a
publicly accessible CSV mirror (`CSA_AI_Controls_Matrix.csv`) of the 184
controls that have been mapped to other frameworks in OpenCRE. The remaining
~59 controls are those without cross-framework mappings yet — they're real
AICM controls, just not in the public mirror.

This is acceptable for v1 of AWARE's AICM support because:

1. Every one of the 18 AICM domains is represented (the 184 subset covers
   all domains, just with fewer controls per domain than the full 243).
2. The control IDs we use are **real CSA AICM v1 IDs** — none are invented.
3. When CSA publishes a non-gated mirror of the full spreadsheet (or when
   OpenCRE updates their export), the regeneration script
   ([`scripts/regenerate-aicm-catalog.js`](../../scripts/regenerate-aicm-catalog.js))
   can re-run to pull the missing ~59 controls without code changes.

## How the catalog is generated and maintained

The catalog at `src/compliance/aicm-v1-catalog.js` is a **generated file** —
it is regenerated from the source CSV via
[`scripts/regenerate-aicm-catalog.js`](../../scripts/regenerate-aicm-catalog.js).

```
# Regenerate from the public CSV mirror
node scripts/regenerate-aicm-catalog.js

# Regenerate from a local CSV (useful when OpenCRE updates their export)
node scripts/regenerate-aicm-catalog.js /path/to/CSA_AI_Controls_Matrix.csv
```

The script:
1. Fetches the CSV from the OpenCRE TRACT repo (or reads from a local path).
2. Parses the CRE | Topic, ControlName, ControlID, Description, Hyperlink columns.
3. Groups controls by domain code.
4. Writes `src/compliance/aicm-v1-catalog.js` as a CommonJS module exporting
   `AICM_V1_DOMAINS` (domain → {controlId → {name, description}}) and
   `AICM_V1_CONTROL_IDS` (flat array).

**Do not edit `aicm-v1-catalog.js` by hand** — re-run the regeneration script.
The header comment in that file flags it as generated.

## Migration from placeholder control IDs

The previous AWARE compliance module used 4 placeholder category codes that
**do not exist** in the AICM spec:

| Placeholder | Real AICM v1 replacement(s) |
|---|---|
| `AI.ID-NN` (5 instances) | `IAM-01`, `IAM-04`, `IAM-09` |
| `AI.OPS-NN` (5 instances) | `LOG-03`, `LOG-13`, `SEF-03`, `IAM-08`, `AIS-07` |
| `AI.MT-NN` (3 instances) | `LOG-05`, `MDS-09` |
| `AI.OT-NN` (3 instances) | `TVM-08`, `MDS-08`, `TVM-01`, `GRC-09` |

The mapping was done by reasoning about what each AWARE component does and
finding the closest real AICM v1 controls. Each mapping is annotated in
`src/compliance/framework-mapper.js` (Phase labels and intent comments).

If you find a mapping you disagree with, please update it — the framework
mapper is the source of truth, not this document.

## Closing the 76% → 100% coverage gap

The 59 missing AICM v1 controls (243 − 184) are real controls that exist in
the full CSA spreadsheet but are not yet in the OpenCRE export. To close the
gap:

1. **Watch for an OpenCRE update** to the TRACT repo that includes the
   remaining controls. When that lands, re-run the regeneration script and
   update the AWARE component mappings to cover the new controls.
2. **CSA may publish a non-gated mirror** of the full 243-control
   spreadsheet (e.g. on `cloudsecurityalliance.org/dl/`). If so, update
   `DEFAULT_CSV_URL` in `scripts/regenerate-aicm-catalog.js` to point at
   the new mirror.
3. **If neither happens**, the fallback is to manually transcribe the
   remaining controls from a copy of the CSA spreadsheet into a local CSV
   and run the regeneration script with the local path.

This is tracked as a follow-up — see "Open items" in the project CHANGELOG.

## Verification

To verify the AICM v1 implementation locally:

```bash
# Run the compliance mapper tests (34 tests, all should pass)
npx jest tests/compliance/compliance-mapping.test.js

# Verify the catalog loads and has the expected control count
node -e "const c = require('./src/compliance/aicm-v1-catalog'); \
  console.log('Domains:', Object.keys(c.AICM_V1_DOMAINS).length, \
  'Controls:', c.AICM_V1_CONTROL_IDS.length);"
# Expected: Domains: 18 Controls: 184

# Verify a specific control ID exists in the real AICM v1 universe
node -e "const c = require('./src/compliance/aicm-v1-catalog'); \
  console.log('IAM-04:', JSON.stringify(c.AICM_V1_DOMAINS.IAM['IAM-04']));"
# Expected: { name: 'Least Privilege', description: '...' }
```

## References

- CSA AI Controls Matrix v1: https://cloudsecurityalliance.org/artifacts/ai-controls-matrix
- CSA AICM announcement blog post (2025-07-10): https://cloudsecurityalliance.org/blog/2025/07/10/introducing-the-csa-ai-controls-matrix-a-comprehensive-framework-for-t
- OpenCRE TRACT (AICM CSV mirror): https://github.com/rocklambros/TRACT
- Open Security Architecture AICM v1.0.3: https://www.opensecurityarchitecture.org/frameworks/csa-aicm/controls/
- AICM v1 mapping to NIST AI RMF 1.0, ISO 42001:2023, BSI AIC4 (all in the CSA artifact bundle)