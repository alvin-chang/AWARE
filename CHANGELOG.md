# Changelog

All notable changes to AWARE Evolution are documented here.

## [Unreleased]

## [2.10.0] — 2026-07-21 — OWASP AST10 support (ADR-048)

**Release type:** minor. Closes the remaining 3 AST10 gaps (AST01, AST06, AST08) per ADR-048.

**Coverage:** 10/10 OWASP AST10 risk classes have dedicated rules in `src/compliance/ast10-mapper.js`.
- **H-confidence (3):** AST01 (malicious skills), AST03 (over-privilege write), AST06 (weak isolation)
- **M-confidence (7):** AST02, AST04, AST05, AST07, AST08, AST09, AST10

### Added
- New `src/compliance/ast10-catalog.js` — canonical OWASP AST10 risk catalogue (10 risk classes)
- New `src/compliance/skill-scanner.js` — vendor-neutral skill scanner adapter (NVIDIA SkillSpector default, Cisco compatible)
- New `src/policies/sandbox-decision-emitter.js` — AST06 source-event producer
- `src/compliance/ast10-mapper.js` extended with 3 new rules (Rule 8, 9, 10) closing the remaining AST10 gaps
- `src/policies/tool-observation-proxy.js` extended with AST06 + AST08 source-event producers
- `docs/adr/ADR-048-aware-ast10-coverage.md` — canonical follow-up ADR

### Rules shipped (10/10 AST10 risks)
- **Rule 1** `scannerRequired` → AST01 (H)
- **Rule 2** `publisherProvenance` → AST02 (M)
- **Rule 3** `overPrivilegeWrite` → AST03 (H)
- **Rule 4** `networkManifestIntegrity` → AST04 (M)
- **Rule 5** `untrustedInstructionOrigin` → AST05 (M)
- **Rule 6** `sandboxBoundaryEnforcement` → AST06 (H)
- **Rule 7** `updateWithoutPin` → AST07 (M)
- **Rule 8** `sandbox-boundary-violation` → AST06 (H, closes AST06 gap)
- **Rule 9** `skill-scan-finding` → AST08 (M, closes AST08 gap)
- **Rule 10** `malicious-or-unproven-skill` → AST01 (H, closes AST01 gap)

### Testing
- 25/25 standards tests pass (`test/standards/owasp-ast10/ast01.test.js` … `ast10.test.js` + 2 fanout tests + helpers)
- 44/44 unit tests pass (`test/unit/compliance/skill-scanner.test.js` + `test/unit/policies/tool-observation-proxy-ast06-ast08.test.js`)

### Privacy fix
- Sanitized stale host-path comment in `ast10-mapper.js:526` to clear gitleaks (an operator-specific home path was replaced with a generic `<profile-dir>` placeholder)

### Pre-commit + pre-push hooks
- Layer 1 (pre-commit): ✅ passed (privacy filter + gitleaks clean)
- Layer 2 (pre-push): ✅ passed (public-boundary check on 20 changed scripts, all clean)

## [2.9.0] — 2026-06-30 — CSA AICM v1 support

**Release type:** minor. Promotes the AICM v1 work from a feature addition to a release milestone.

**Version-bump policy reversal:** An earlier in-session note in this CHANGELOG (under the now-removed "[Unreleased] — AICM v1 support" entry) said there would be no `package.json` version bump because AICM coverage was "a feature addition, not a release milestone." That note was wrong — 184 real AICM v1 control IDs across all 18 domains is a release milestone. Policy reversed; `package.json` is bumped to `2.9.0` and the work is tagged `v2.9.0` (post-v2.8.0; consistent with the github tag pattern).

**Note on github tag pattern:** AWARE's github-side tag pattern is `v2.X.x` (see `v2.7.0`, `v2.7.3`, `v2.8.0` in `git tag --list`). `package.json` was at `1.0.0-phase4-complete` before this release, so there is a one-time inconsistency: `package.json` says `2.9.0` but the codebase line of releases is `v2.7.0 → v2.7.3 → v2.8.0 → v2.9.0`. Future releases should keep `package.json` and github tags aligned on the `2.x` line.

### 2026-06-30 — CSA AICM v1 support (real control IDs)

**Status:** Phase 1 of compliance mapping upgrade. Real AICM v1 control IDs replace the previous placeholders.

**Replaces:** placeholder control IDs (`AI.ID-*`, `AI.OPS-*`, `AI.MT-*`, `AI.OT-*`) that did not exist in the AICM spec with real CSA AICM v1 control IDs (`IAM-*`, `MDS-*`, `DSP-*`, `LOG-*`, `SEF-*`, `TVM-*`, `GRC-*`, `AIS-*`, `UEM-*`, `CEK-*`, `A&A-*`).

**Coverage:** 184 verified control IDs across all 18 AICM v1 domains (76% of CSA's published 243-control universe).

**Added:**
- `src/compliance/aicm-v1-catalog.js` — generated AICM v1 control catalog (184 controls × 18 domains)
- `scripts/regenerate-aicm-catalog.js` — regeneration script that pulls from the OpenCRE TRACT CSV mirror
- `docs/compliance/aicm-v1.md` — coverage documentation, sources, gap analysis

**Changed:**
- `src/compliance/framework-mapper.js` — `CSA_AI_CM` framework now backed by the real AICM v1 catalog; all 10 AWARE component mappings updated to use real control IDs
- `src/compliance/evidence-collector.js` — 5 default collectors re-keyed from placeholder IDs to real AICM v1 IDs (`IAM-01`, `IAM-04`, `LOG-03`, `SEF-03`, `IAM-08`)
- `tests/compliance/compliance-mapping.test.js` — 16 placeholder references updated; framework-name assertion corrected to `"CSA AI Controls Matrix"` (plural, matching CSA's official name)
- `README.md` — CSA row in the frameworks table updated to reflect v1 / 18 domains / 184 controls

**Privacy fix (95f1c25):** `scripts/regenerate-aicm-catalog.js` no longer hardcodes `/tmp/aicm-fetch/` (an operator-machine directory name); uses `os.tmpdir()` for OS-portable temp paths. Caught during the post-commit privacy audit.

**Testing:** 34/34 compliance-mapping tests pass; 18/18 tool-access-control tests pass.

**Sources:** AICM v1 spec at https://cloudsecurityalliance.org/artifacts/ai-controls-matrix ; control IDs verified against the OpenCRE TRACT public CSV mirror (https://github.com/rocklambros/TRACT).

**Open items:**
- Close the 76% → 100% coverage gap (184 → 243 controls) when CSA publishes a non-gated full mirror or OpenCRE updates their TRACT export. See `docs/compliance/aicm-v1.md` § "Closing the coverage gap".

## [Unreleased] — AWARE Evolution COMPLETE ✅ (2026-04-02)

**All 4 phases complete:**
- Phase 1: ✅ Complete (1.1–1.4 all delivered)
- Phase 2: ✅ Complete (ADR (internal), ADR (internal), ADR (internal), ADR (internal) — all APPROVED + IMPLEMENTED)
- Phase 3: ✅ Complete (ADR (internal)–019 all APPROVED/IMPLEMENTED)
- Phase 4: ✅ Complete (compliance-matrix.md documented)

### 2026-04-02 — All ADRs Approved ✅

**ADR Status Updates:**
- ADR (internal) (Phase 2.1 Pheromone Specialists): ✅ APPROVED + IMPLEMENTED
- ADR (internal) (Phase 2.2 Security-Weighted Heuristic): ✅ APPROVED + IMPLEMENTED
- ADR (internal) (Phase 2.3 Quality-Gated Reinforcement): ✅ APPROVED + IMPLEMENTED
- ADR (internal) (Phase 2.4 Hot-Reload Policy): ✅ APPROVED + IMPLEMENTED
- ADR (internal) (Phase 3.3 Decision-Chain Traceability): ✅ APPROVED + IMPLEMENTED
- ADR (internal) (Phase 3.4 GitOps Agent-as-Code): ✅ APPROVED (F-3 resolved, alert-only)

**New ADRs Created:**
- ADR (internal) (Phase 3.3 Decision-Chain Traceability): Hash-chained audit logging for tamper-evident decision trails
- ADR (internal) (Phase 3.4 GitOps Agent-as-Code): Git-based agent definitions with PR workflow and drift detection

**Documentation:**
- All ADRs now have clear approval status
- Phase 3.3/3.4 gaps closed with new ADRs
- EVOLUTION-BRIEF.md fully implemented

## [1.2.1] — 2026-04-01 — Phase 3.1 Implementation

### ADR (internal)/016: Phase 3.1C/3.2 — APPROVED + IMPLEMENTED + TESTED ✅

**Status:** APPROVED (Reviewer, 2026-04-01 22:05 BST, commit b0f7104) | IMPLEMENTED (Coder, 2026-04-01 22:35 BST, commit 5a67661) | TESTED (Tester, 2026-04-01 22:36 BST, commit f20c262)

**Testing:** 40/40 PASS ✅

**Implementation fixes (5a67661):**
- shadow-detector.js: Add confirmedShadow flag for shadow state detection
- tool-audit-logger.js: Fix apiKey redaction (added lowercase 'apikey' to sensitiveKeys)
- evidence-collector.js: Fix custom collector data structure (spread result directly)
- posture-calculator.js: Add priority field to recordGap with severityToPriority mapping

**ADR (internal): Tool Access Control & Enforcement**
- RBAC with 5 roles (admin, coder, researcher, tester, scribe)
- Gateway-level shadow tool detection with confirmedShadow flag
- Parameter schema validation (type/enum/range)
- Audit logging with sensitive data redaction

**ADR (internal): Compliance Mapping & Reporting**
- CSA AI CM, NIST AI RMF, ISO 27001, DORA mapping
- Automatic evidence collection with custom collector support
- Gap tracking with severity-based priority
- Compliance posture calculation and report generation

---

### ADR (internal): Phase 3.2 — Kill Switch Propagation & Emergency Shutdown ✅ APPROVED

**Status:** APPROVED (Reviewer, 2026-04-01 22:38 BST, commit 192db34) | IMPLEMENTED (Architect, commit be5b430)

**Findings fixed:**
- F-1 [MEDIUM]: Acknowledgment etcd write verification with retry
- F-2 [MEDIUM]: Override/Cancel Authority Matrix defined for all severity levels

**Key features:**
- Kill Switch Trigger Types (LOCAL/DOMAIN/GLOBAL severity levels)
- Raft-based broadcast propagation mechanism
- GRACEFUL and FORCED shutdown procedures
- Acknowledgment protocol with etcd write verification
- Post-emergency recovery and re-onboarding
- Override/Cancel Authority Matrix (GLOBAL kills require 3 C-level approvers)
- API endpoints for kill switch management
- Compliance mapping (CSA AI CM, NIST AI RMF, ISO 27001, DORA)

---

### ADR (internal): Phase 3.1B — Behavioural Anomaly Detection ✅ IMPLEMENTED

**Status:** APPROVED (Reviewer, 2026-04-01 21:10 BST) | IMPLEMENTED (Coder, 2026-04-01 21:24 BST)
**Commit:** `06c983e` (approved) | `85b04a1` (implemented)
**Testing:** 14/14 tests PASS

**Implementation:**
- computeZScore(): stddev=0 guard (F-2 fix)
- computeAnomalyScore(): corrected penalty formula (F-1 fix)
- classifySeverity(): uses BOTH anomaly AND trust score (F-3 fix)

### ADR (internal): Phase 3.1B — Behavioural Anomaly Detection ✅

**Status:** APPROVED (Reviewer, 2026-04-01 21:10 BST)
**Commit:** `06c983e`

**Findings resolved:**
- F-1: Penalty formula now INCREASES with anomaly (was decreasing/inverted)
- F-2: stddev=0 guard prevents NaN in computeZScore()
- F-3: classifySeverity() uses BOTH anomaly AND trust score

### ADR (internal): Phase 3.1A — Agent Identity & Authentication Framework ✅

**Status:** APPROVED (Reviewer, 2026-04-01 14:00 BST)
**Commit:** `b61fda3`
**Testing:** 27/27 tests passing (identity-v2.test.js)

**Content:**
- NHI lifecycle state machine (PENDING→APPROVED→ACTIVE→INACTIVE/REVOKED)
- Extended JWT claims: trustDomain, sessionId, executionContext, trustScore
- Zero-downtime credential rotation
- Session binding to execution context
- Identity attestation for cross-agent communication
- Distributed revocation cache with blast radius
- Fixes C-01 (hardcoded secret), C-02 (heartbeat auth), C-03 (fail-closed)

---

### ADR (internal): Phase 2.2 — Security-Weighted Heuristic Function ✅

**Status:** APPROVED (Reviewer, 2026-04-01 20:39 BST)
**Commit:** `39bc2be`

**Findings resolved:**
- F-2: validateWeights() function added to prevent NaN/Infinity
- F-5: ALPHA/BETA explicitly defined (1.0 default)
- F-6: heuristicSum=0 guard prevents division by zero

---

## [1.1.4] — 2026-04-01 — Phase 1.4 Complete

### Phase 1.4 — Kill Switch with Raft Consensus ✅

**Status:** Complete (2026-04-01)

**Components:**
- **RevocationEntry** (C-01): Proper revocation type for emergency shutdown
- **Raft Consensus** (C-02): Majority quorum for kill-switch decisions
- **Vote Granting** (C-03): Proper Raft vote granting via node registry
- **Kill Switch Routes** (C-04): Emergency shutdown endpoints mounted in src/api/index.js

**Testing:** 10/10 kill-switch tests passing (Tester verified)
**Commits:** `d4f44d7`, `aa278ab`, `f711c3d`, `2846e2e`

---

## [1.1.3] — 2026-04-01 — Phase 1.3 Complete

### Phase 1.3 — Behavioural Baseline & Anomaly Detection

**Added:**
- **Metrics Collector** — `src/monitoring/metrics-collector.js` — Singleton service aggregating agent metrics
- **Baseline Service** — `src/monitoring/baseline-service.js` — Rolling 7-day window, z-score computation, statistics (mean, stddev, p50-p99)
- **Anomaly Detector** — `src/monitoring/anomaly-detector.js` — Z-score thresholds (CRITICAL >4σ, HIGH >3σ, MEDIUM >2.5σ, LOW >2σ)
- **Fingerprint Service** — `src/monitoring/fingerprint-service.js` — Prompt injection detection (beyond Phase 1.3 spec)
- **Metrics Store** — `src/monitoring/store.js` — JSON persistence with atomic writes, 30-day retention
- **Metrics Router** — `src/api/routes/metrics.js` — 11 REST API endpoints

**Metric Types:**
- `TOOL_CALL_FREQUENCY` — Tool usage tracking per agent
- `RESPONSE_LATENCY` — Response time distribution
- `ERROR_RATE` — Error frequency per agent
- `DECISION_FINGERPRINT` — Prompt injection detection (beyond spec)

**Review:** ✅ Reviewer APPROVED (2026-04-01)
**Testing:** 47/52 passing | 6 pre-existing auth failures (api.test.js)
**Commits:** `d679ec6`, `e0c0fd2`, `a3ceaec`, `f7e7427`, `653ba7a`, `8159cf7`, `1bc02ce`

---

### Phase 1.2 — Per-Agent Sandbox Policies ✅

**Status:** Complete (2026-03-31)

**Added:**
- **Policy Engine core** — Model, Tool Catalog, Policy Store, Policy Engine, Policy Routes
- **Per-Agent Sandboxes** — sandbox policy schema (tools, network, trust level)
- **Tool Contract Registry**
- **Runtime policy reload without restart**

**Security Fixes (Phase 1.2):**
- Heartbeat spoofing prevention — Policy Engine verifies caller owns slot before heartbeat accepted

**Commits:** `92a9443`

---

## [1.1.1] — 2026-03-29 — Phase 1.1 Complete

### Added
- **Agent Registry** — NHI (Non-Human Identity) lifecycle management
  - `POST /registry/agent` — Register new agent with identity
  - `GET /registry/agent/:agentId` — Retrieve agent details
  - `PUT /registry/agent/:agentId/heartbeat` — Heartbeat with ownership verification
  - `DELETE /registry/agent/:agentId` — Deregister agent
  - `GET /registry/agents` — List all registered agents
  - `GET /registry/agent/:agentId/telemetry` — Decision event telemetry
- **Decision Event Telemetry** — Observable routing decision trails
- **SQLite storage backend** — `src/store/etc7-store.ts` interface
- **etcd storage backend** — `src/store/etcd-store.ts` (production)

### Security Fixes (Phase 1.1)
- `trustDomain` — Server-assigned, not client-supplied (commit 44974f6)
- `webhookUrl` — SSRF protection via blocklist validation (commit 44974f6)

### Testing
- 17/17 unit tests pass
- Integration tests require etcd on port 18900

### Dependencies
- etcd (port 18900) for integration tests

---

## [v2.7.3] — 2026-06-27 — coordinator LLM reachability + probe auth

### Fixes
- **`docker-compose.coordinator.yml`** — the coordinator container now receives the
  LLM provider API key in addition to the existing `LLM_API_KEY`. The internal
  rl-pipeline client reads its credential directly from the environment with no
  fallback to `LLM_API_KEY`, so without this pass-through the provider client
  constructor threw at request time and `/coordinate` returned a backend-failure
  error. Verified live: the `/coordinate` round-trip now returns real LLM
  responses.

- **`docker-compose.coordinator.yml`** — revert the coordinator publish port from
  `38181:8080` back to `18081:8080`. Originally introduced as part of an earlier
  runtime-evidence update but never propagated to the schema, README, smoke
  tests, and probe script that all hardcode `18081`. The `0.0.0.0` binding
  rationale is preserved; only the port number changes.

### Probe
The daily AWARE plugin loadability probe was failing 4/6 because `/coordinate`
requires an authorization credential (added in the Phase 1 security release) but
the probe was sending none. The probe now reads the credential from the
operator's `.env` and includes it on the request, with a no-auth fallback for
dev mode. **The probe now passes 6/6.**

### Operator actions required after upgrading to v2.7.3
- Set the LLM provider API key in the operator's compose `.env` to match the
  canonical credential stored in the OpenClaw gateway configuration. The prior
  value was truncated / wrong tier and was rejected by the provider with a
  401 authentication error.
- Apply the matching probe script change in the operator's probe location. See
  the v2.7.3 commit body for the full diff description.

### Deferred to v2.8.x
- **Adapter-layer bridge in `src/coordinator/index.js`** so a single credential
  name is canonical end-to-end. Today the AWARE code reads `LLM_API_KEY` and
  the rl-pipeline source reads a different name; the compose file passes both,
  but the right long-term answer is one name.
- **Move the loadability probe into `scripts/`** so it ships with every clone
  and operators get updates automatically.
- **Single source of truth for the LLM credential** — compose should read from
  the OpenClaw gateway configuration directly so there is one credential
  location, not two. The current copy-paste is fragile: if the key rotates,
  both files must update.
- **rl-pipeline distribution model.** The public `GoodCISO/aware` clone cannot
  fetch the rl-pipeline source (the URL is intentionally not vendored into the
  image; see the SEC-007/008 design notes in `Dockerfile.coordinator`). Either
  vendor the rl-pipeline source into the public repo, or stop shipping
  `docker-compose.coordinator.yml` to external consumers and document
  "operator-only builds."
- **LaunchAgent supervisor** for the `aware-2-coordinator` container. When it
  exits, nothing restarts it.

### Verification
```
=== aware-plugin loadability probe (2026-06-27) ===
  ok  live install dir exists
  ok  worktree install dir exists
  ok  smoke-test.js passes 26/26
  ok  AWARE coordinator /health responds
  ok  AWARE /coordinate round-trip returns ok:true
  ok  gateway log shows 'aware' plugin registered

=== Summary: 6/6 checks passed ===
PROBE PASSED — aware plugin loadable + AWARE coordinator live.
```

---

## [Prior] — Original AWARE (Distributed Systems Platform)

Original AWARE was a distributed systems platform using ant colony-inspired algorithms for cluster coordination and resource optimization. This is now archived at `docs/legacy/README-v1.md`.

---

## Phase Status

| Phase | Name | Status |
|-------|------|--------|
| 1.1 | Agent Identity Layer | ✅ Complete |
| 1.2 | Per-Agent Sandbox Policies | ✅ Complete |
| 1.3 | Behavioural Baseline | ✅ Complete |
| 1.4 | Kill Switch | ✅ Complete |
| 2.1 | Pheromone Specialists | 🔄 In Progress |
| 2.2 | Security-Weighted Heuristic | ✅ APPROVED (ADR (internal)) |
| 3.1 | Agent Identity & Authentication | ✅ APPROVED (ADR (internal)) |
| 3.1B | Behavioural Anomaly Detection | ✅ IMPLEMENTED (ADR (internal)) |
| 3.1C | Tool Access Control | ✅ APPROVED + IMPLEMENTED + TESTED (ADR (internal), 40/40 PASS) |
| 3.2 | Compliance Mapping | ✅ APPROVED + IMPLEMENTED + TESTED (ADR (internal), 40/40 PASS) |
| 3.2 | Kill Switch Propagation | ✅ APPROVED (ADR (internal)) |

---

*Generated by Chronicler (Scribe) — 2026-04-01*
