# ADR-019: Phase 3.4 — GitOps Agent-as-Code

**Status:** DRAFT (needs Critic review)  
**Author:** Archimedes  
**Date:** 2026-04-02  
**Research inputs:** EVOLUTION-BRIEF.md Section 3.4; Galileo Agent Control (hot-reload policies); CSA AI Control Matrix (Change Management); NIST AI RMF MANAGE 3.1; ISO 27001 A.12.1; DORA Art. 8  
**Depends on:** ADR-013 (Agent Identity), ADR-012 (Hot-Reload Policy)  

---

## Context

AWARE agents are currently defined at runtime via API calls to the Agent Registry. This creates several problems:

1. **No version control** — agent definitions can be modified without audit trail
2. **No review process** — new agents can be onboarded without peer review
3. **Drift** — runtime state can diverge from intended configuration
4. **No rollback** — cannot revert to previous agent configuration

**Industry standard:** GitOps — declarative configuration stored in Git, enforced at runtime, with PR-based change management.

---

## Decision

Implement **GitOps Agent-as-Code** where all agent definitions, policies, and routing configurations are:
1. **Declared in Git** — YAML/JSON files in `agents/`, `policies/`, `routing/` directories
2. **Version controlled** — every change tracked with commit history
3. **PR-reviewed** — new agents require approved pull request before activation
4. **Enforced at runtime** — AWARE loads declared state and alerts on drift
5. **Automatically synced** — webhook triggers reload on Git push to main branch

---

## Git Repository Structure

```
aware-gitops/
├── agents/
│   ├── researcher.yaml
│   ├── coder.yaml
│   ├── reviewer.yaml
│   └── orchestrator.yaml
├── policies/
│   ├── researcher-policy.yaml
│   ├── coder-policy.yaml
│   └── default-policy.yaml
├── routing/
│   ├── pheromone-config.yaml
│   └── heuristic-weights.yaml
└── README.md
```

### Agent Definition Schema

```yaml
# agents/researcher.yaml
apiVersion: aware.openclaw.ai/v1
kind: Agent
metadata:
  name: researcher
  version: 1.2.0
  labels:
    team: research
    clearance: confidential
spec:
  model:
    provider: minimax
    model: MiniMax-M2.7
  identity:
    agentId: agent-researcher-001
    trustScore: 0.85
  capabilities:
    - web_search
    - document_analysis
    - code_review
  restrictions:
    - no_write_access
    - no_external_api_except_approved
  policyRef: policies/researcher-policy.yaml
```

---

## Implementation

### New Modules

**`src/gitops/loader.js`**
- `loadAgentDefinitions()` — reads `agents/*.yaml` from Git repo
- `loadPolicies()` — reads `policies/*.yaml`
- `loadRoutingConfig()` — reads `routing/*.yaml`
- `validateSchemas()` — validates against JSON schemas
- `syncToRuntime()` — applies loaded config to runtime services

**`src/gitops/drift-detector.js`**
- `compareRuntimeToDeclared()` — compares runtime state to Git declarations
- `reportDrift()` — generates drift report with differences
- `alertOnDrift()` — triggers alert if drift detected
- `autoRemediate()` — optional: auto-sync runtime to declared state

**`src/gitops/webhook-handler.js`**
- `handlePush(event)` — processes Git push webhook
- `triggerReload()` — triggers config reload on main branch push
- `validateSignature()` — verifies webhook signature (security)

**`src/api/routes/gitops.js`**
- `GET /api/gitops/status` — current Git commit, sync status
- `GET /api/gitops/drift` — drift report
- `POST /api/gitops/sync` — manual sync trigger
- `GET /api/gitops/history` — recent Git commits affecting config

### PR Workflow

```
1. Developer creates branch: feature/add-new-agent
2. Adds agents/new-agent.yaml
3. Opens PR → triggers CI validation
4. Critic (or human) reviews agent definition
5. PR merged to main → webhook triggers AWARE reload
6. New agent activated automatically
```

### CI Validation (GitHub Actions / Gitea CI)

```yaml
# .gitea/workflows/validate-agents.yaml
on:
  pull_request:
    paths:
      - 'agents/**'
      - 'policies/**'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Validate agent schemas
        run: npm run validate:agents
      - name: Check policy conflicts
        run: npm run validate:policies
      - name: Security scan
        run: npm run security:scan
```

---

## Drift Detection

Drift occurs when runtime state diverges from Git-declared state:

| Drift Type | Detection | Remediation |
|------------|-----------|-------------|
| Agent added at runtime (not via Git) | Agent exists in registry but not in `agents/` | Alert + auto-remove or flag for review |
| Agent removed from Git but still running | Agent in `agents/` but not in registry | Auto-onboard or alert |
| Policy modified at runtime | Policy hash differs from Git | Alert + revert to Git version |
| Config parameter changed | Runtime config ≠ Git config | Alert + optional auto-sync |

---

## Compliance Mapping

| Framework | Control | Implementation |
|-----------|---------|----------------|
| CSA AI CM | Change Management | Git-based version control + PR review |
| NIST AI RMF | MANAGE 3.1 | Configuration management |
| ISO 27001 | A.12.1 | Operational procedures |
| DORA | Art. 8 | ICT change management |

---

## Consequences

**Positive:**
- Full audit trail for agent onboarding/modification
- Peer review enforced via PR workflow
- Rollback capability (git revert)
- Drift detection prevents configuration sprawl
- Compliance-ready change management

**Negative:**
- Requires Git infrastructure (Gitea/GitHub)
- Webhook complexity (signature validation, retry logic)
- Learning curve for team (GitOps workflow)

**Risks:**
- Git repo unavailable → cannot load new configs → mitigate with local cache
- Malicious PR merged → bad config deployed → mitigate with required reviews
- Drift auto-remediation breaks production → mitigate with alert-first, manual approval

---

## Open Questions

1. **Git provider:** Gitea only, or support GitHub/GitLab? (Recommend: Gitea-first, abstract provider)
2. **Auto-sync vs alert-only:** Should drift auto-remediate or just alert? (Recommend: alert-first, configurable)
3. **Rollback strategy:** Git revert or snapshot-based? (Recommend: git revert for simplicity)

---

## Approval

**Critic review:** PENDING

**Implementation:** NOT STARTED

**Testing:** NOT STARTED
