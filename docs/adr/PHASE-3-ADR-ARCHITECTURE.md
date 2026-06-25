# Phase 3 ADR Architecture Plan

**Author:** Architect  
**Date:** 2026-04-01  
**Status:** PLANNING  

---

## Phase 3 Scope: Security Control Plane

From Researcher's research (phase-2-routing-research.md):

> AWARE's routing intelligence must evolve into an **agentic AI security control plane**.  
> Phase 3: Full identity, behavioural, kill-switch, compliance

**Phase 3.1:** Identity + Behavioural components  
**Phase 3.2:** Hot-reload policies ✅ **DELIVERED (ADR-012)**

---

## Phase 3 ADR Inventory

| ADR | Phase | Topic | Priority | Status |
|-----|-------|-------|----------|--------|
| ADR-013 | 3.1 | Agent Identity & Authentication Framework | P0 | TODO |
| ADR-014 | 3.1 | Behavioural Anomaly Detection & Baseline | P0 | TODO |
| ADR-015 | 3.1 | Tool Access Control & Enforcement | P1 | TODO |
| ADR-016 | 3.2 | Compliance Mapping & Reporting | P1 | TODO |
| ADR-017 | 3.2 | Kill Switch Propagation & Emergency Shutdown | P1 | TODO |

---

## ADR-013: Agent Identity & Authentication Framework

**Phase:** 3.1  
**Priority:** P0  
**Status:** TODO

### Scope
- NHI (Non-Human Identity) lifecycle management
- Agent registration, credential rotation, revocation
- JWT extension with agent-specific claims (trustDomain, clearance, capabilities)
- Session binding: agent ↔ execution context
- Identity attestation for cross-agent communication

### Key Decisions
- How is agent identity proven? (JWT + HMAC + TLS client cert?)
- What claims go in the agent JWT?
- How is credential rotation handled without downtime?
- How is revocation propagated?

### Dependencies
- Phase 1.1 (Agent Identity Layer) — existing foundation
- Researcher research needed for attestation standards

### Implementation (Coder)
- `src/agents/identity-provider.js` extensions
- `src/agents/credential-rotator.js`
- `src/agents/attestation-service.js`

---

## ADR-014: Behavioural Anomaly Detection & Baseline

**Phase:** 3.1  
**Priority:** P0  
**Status:** TODO

### Scope
- Behavioural baseline mapping per agent (tool usage patterns, API call frequency, data access patterns)
- Anomaly scoring (deviation from baseline)
- Alerting thresholds and escalation
- Integration with trust_score (ADR-010)

### Key Decisions
- What metrics constitute "behaviour"? (tool calls, API calls, data access, timing)
- How is baseline established? (statistical, ML, rule-based)
- What anomaly score triggers what action?
- How does this feed into pheromone updates?

### Dependencies
- Phase 1.3 (Behavioural Baseline) — existing foundation
- Researcher research needed for anomaly detection methodologies

### Implementation (Coder)
- `src/monitoring/behavioural-monitor.js`
- `src/monitoring/baseline-mapper.js`
- `src/monitoring/anomaly-scorer.js`
- `src/monitoring/alert-dispatcher.js`

---

## ADR-015: Tool Access Control & Enforcement

**Phase:** 3.1  
**Priority:** P1  
**Status:** TODO

### Scope
- Tool whitelist/blacklist per agent role
- Tool invocation authorization (pre-call check)
- Shadow tool detection (unauthorized tool usage)
- Tool usage audit trail

### Key Decisions
- How are tool permissions defined? (RBAC? attribute-based?)
- Pre-call vs post-call enforcement?
- How are violations handled? (block? alert? quarantine?)
- Tool lineage tracking (which agent used which tool with what parameters)

### Dependencies
- ADR-011 (Quality-Gated Reinforcement) — policy violation penalties
- Researcher research for tool control patterns

### Implementation (Coder)
- `src/tools/tool-registry.js`
- `src/tools/permission-enforcer.js`
- `src/tools/shadow-detector.js`
- `src/tools/usage-auditor.js`

---

## ADR-016: Compliance Mapping & Reporting

**Phase:** 3.2  
**Priority:** P1  
**Status:** TODO

### Scope
- CSA AI Control Matrix alignment
- NIST AI RMF mapping
- ISO 27001 security controls
- DORA regulatory requirements
- Compliance reporting dashboard

### Key Decisions
- Which compliance frameworks apply?
- How are controls mapped to AWARE components?
- Automated vs manual evidence collection?
- Reporting format and frequency

### Dependencies
- All prior ADRs (compliance cuts across everything)
- Researcher research for compliance frameworks

### Implementation (Coder)
- `src/compliance/framework-mapper.js`
- `src/compliance/evidence-collector.js`
- `src/compliance/report-generator.js`

---

## ADR-017: Kill Switch Propagation & Emergency Shutdown

**Phase:** 3.2  
**Priority:** P1  
**Status:** TODO

### Scope
- How kill switches propagate across agents (Phase 1.4 delivered the Kill Switch, this handles propagation)
- Emergency shutdown consensus (how do agents agree to shut down?)
- Graceful vs forced shutdown
- Post-emergency recovery and re-onboarding

### Key Decisions
- Kill signal propagation: push vs pull?
- Consensus needed for shutdown? (majority? unanimous?)
- Recovery procedure after emergency shutdown?
- Audit trail for emergency actions

### Dependencies
- Phase 1.4 (Kill Switch) — existing foundation
- Researcher research for propagation patterns

### Implementation (Coder)
- `src/emergency/kill-switch-propagator.js`
- `src/emergency/shutdown-consensus.js`
- `src/emergency/recovery-manager.js`

---

## Researcher Research Assignments

To support Phase 3 ADRs, Researcher needs research on:

### P0 (Blocking ADR-013, ADR-014)

1. **Identity Attestation Standards**
   - What standards exist for machine identity attestation? (SPIFFE/SPIRE? Kubernetes service accounts?  NIST NFI?)
   - How do enterprise systems handle agent identity verification?

2. **Behavioural Anomaly Detection Methodologies**
   - What approaches work for agent behavioural monitoring? (statistical, ML, hybrid?)
   - Industry benchmarks for anomaly detection in AI agent systems?

### P1 (Supporting ADR-015, ADR-016, ADR-017)

3. **Tool Access Control Patterns**
   - How do comparable systems (Galileo, other agent frameworks) enforce tool permissions?
   - Best practices for tool whitelisting in multi-agent systems?

4. **Compliance Framework Mapping**
   - CSA AI Control Matrix: which controls map to agent routing?
   - NIST AI RMF: how does AWARE's architecture map?
   - DORA specific requirements for AI systems?

5. **Kill Switch Propagation**
   - How do distributed systems handle emergency shutdown?
   - Are there patterns for graceful degradation vs forced termination?

---

## Coder Implementation Plan

### After ADR-013 (Identity Framework)
- Extend identity-provider for attestation
- Implement credential rotation
- Add session binding

### After ADR-014 (Behavioural Anomaly)
- Build behavioural monitor
- Implement baseline mapper
- Connect anomaly scores to trust_score (ADR-010)

### After ADR-015 (Tool Enforcement)
- Build tool registry
- Implement permission enforcer
- Add shadow tool detection

### Parallel Tracks
- **ADR-016 (Compliance)** can start after ADRs 013-015 are drafted
- **ADR-017 (Kill Switch Propagation)** can start after Phase 1.4 is fully tested

---

## Recommended Execution Order

```
Week 1:
  ├── Researcher: Research Identity Attestation + Behavioural Anomaly
  ├── Architect: Draft ADR-013 (Identity) + ADR-014 (Behavioural)
  └── Coder: Continue Phase 1.4 testing support

Week 2:
  ├── Researcher: Research Tool Control + Compliance
  ├── Architect: Draft ADR-015 (Tool) + ADR-016 (Compliance)
  └── Coder: Implement ADR-013 + ADR-014 components

Week 3:
  ├── Researcher: Research Kill Switch Propagation
  ├── Architect: Draft ADR-017 (Kill Switch Propagation)
  └── Coder: Implement ADR-015 + ADR-016 components

Week 4:
  ├── Critor: Review all Phase 3 ADRs
  ├── Tester: Integration testing Phase 3 components
  └── Coder: Implement ADR-017 + full integration
```

---

## Open Questions

1. **Scope clarification:** Is ADR-017 (Kill Switch Propagation) truly Phase 3, or is it Phase 1.4 extension? (Phase 1.4 delivered Kill Switch architecture, but propagation mechanism may be separate)

2. **ML vs Rules:** Should behavioural anomaly detection use ML models or rule-based systems? (ML more accurate but harder to audit; Rules more explainable but less flexible)

3. **Compliance scope:** Which specific compliance frameworks apply to AWARE's deployment context? (UK CSA member suggests UK regulatory alignment)

4. **Implementation priority:** Should we implement all 5 Phase 3 ADRs, or prioritize based on risk?
