# ADR-011: Phase 2.3 — Quality-Gated Reinforcement

**Status:** DRAFT  
**Author:** Archimedes  
**Date:** 2026-04-01  
**Research inputs:** EVOLUTION-BRIEF.md Section 2.3; ADR-009 Phase 2.1 (Pheromone Specialists); ADR-010 Phase 2.2 (Security-Weighted Heuristic)  
**Depends on:** ADR-009 (Phase 2.1 Pheromone Specialists), ADR-010 (Phase 2.2 Security-Weighted Heuristic)  

---

## Context

ADR-009 established the AMRO-S ACO framework with task-specific pheromone specialist matrices (τ^t) and the soft-max selection formula:

```
P(agent) ∝ exp(α · τ_agent^task) × exp(β · η_agent^task)
```

ADR-010 defined the security-weighted heuristic η_secure(agent, task) combining capability, load, trust, clearance, and blast radius.

Phase 2.3 addresses a critical gap: **when and how pheromone trails are updated**. Without a quality gate, ACO reinforcement would blindly reward any agent selection, including:
- Agents that succeeded by luck (not skill)
- Agents that violated policy but still "completed" the task
- Agents that degraded during task execution

The quality gate ensures pheromone reinforcement is **conditional on verified task quality and policy compliance**.

---

## Decision

Implement a **dual-gate reinforcement mechanism** that updates pheromone trails ONLY after passing both:
1. **Quality Gate** — task outcome meets minimum quality threshold
2. **Security Gate** — no policy violations during execution

This prevents negative pheromone contamination from bad outcomes and ensures the ACO system learns from **valid, compliant task completions**.

---

## Reinforcement Triggers

Pheromone updates are triggered by **decision events** (see ADR-009 §Decision Event Schema). Three outcomes:

| Event Type | Quality Gate | Security Gate | Action |
|------------|-------------|---------------|--------|
| `task_success` | ✅ passed | ✅ passed | **Positive reinforcement**: increase τ for selected agent |
| `task_partial` | ⚠️ marginal | ✅ passed | **Neutral reinforcement**: no change |
| `task_failure` | ❌ failed | ✅/❌ | **Negative reinforcement**: decrease τ for selected agent |
| `policy_violation` | any | ❌ failed | **Penalty reinforcement**: decrease τ AND apply blast radius penalty |

---

## Quality Gate Specification

### Quality Assessment

After task completion, the **Quality Evaluator** assesses outcome quality:

```
quality_score = f(outcome_metrics, task_specification)
```

Where outcome metrics may include:
- Correctness (% of expected outcomes achieved)
- Completeness (all required subtasks done)
- Efficiency (resource usage vs baseline)
- Timeliness (within SLA window)

### Quality Thresholds

| Rating | Quality Score | Gate Outcome |
|--------|--------------|--------------|
| EXCELLENT | ≥ 0.9 | Positive reinforcement (bonus multiplier ×1.5) |
| ACCEPTABLE | ≥ 0.6 | Standard positive reinforcement (×1.0) |
| MARGINAL | ≥ 0.4 | Neutral reinforcement (×0.0) |
| FAIL | < 0.4 | Negative reinforcement (×-0.5) |

### Quality Evaluation Sources

Quality is assessed from multiple perspectives:

1. **Explicit confirmation**: Task orchestrator confirms success/failure
2. **Output validation**: Expected output matches actual output (for deterministic tasks)
3. **Human feedback**: Admin or stakeholder rating (for subjective tasks)
4. **Automated metrics**: Precision/recall, error rates, etc.

---

## Security Gate Specification

### Policy Compliance Check

Before any positive reinforcement, verify no policy violations occurred during execution:

```
security_violations = policy_engine.check(task_id, agent_id)
```

Policy violations include:
- Unauthorized tool access
- Data exfiltration attempts
- Prompt injection
- Privilege escalation
- Rate limit violations

### Violation Severity Levels

| Level | Description | Penalty |
|-------|-------------|---------|
| CRITICAL | Security breach, data theft | τ → τ_min, immediate revocation |
| HIGH | Policy violation, unauthorized access | τ → τ × 0.1 |
| MEDIUM | Minor policy deviation | τ → τ × 0.5 |
| LOW | Technical violation (no harm) | Warning logged, no penalty |

---

## Reinforcement Update Rules

### Positive Reinforcement (task_success + quality ≥ 0.6 + no violations)

```
τ_new(agent, task) = τ_old(agent, task) + ρ × (1 - τ_old) × multiplier
```

Where:
- `ρ` = learning rate (default: 0.1)
- `multiplier` = quality bonus (1.0 standard, 1.5 for EXCELLENT)
- `(1 - τ_old)` = pheromone "distance" to maximum (prevents premature saturation)

### Negative Reinforcement (task_failure OR quality < 0.4)

```
τ_new(agent, task) = τ_old(agent, task) × (1 - ρ)
```

Erosion towards minimum (τ_min = 0.01) rather than instant drop.

### Policy Violation Penalty

```
τ_new(agent, task) = τ_min  [CRITICAL/HIGH violations]
τ_new(agent, task) = τ_old(agent, task) × penalty_factor  [MEDIUM violations]
```

Additionally, **blast radius penalty** applied to ALL task categories the agent handles:

```
τ_new(agent, all_tasks) *= (1 - blast_radius_estimate)
```

---

## Dual-Gate Flow

```
Task Assignment
      │
      ▼
┌─────────────────┐
│  Execute Task   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ❌ FAIL
│ Quality Gate    │──────────────────→ Negative Reinforcement
│ (quality ≥ 0.6) │
└────────┬────────┘
         │ ✅ PASS
         ▼
┌─────────────────┐     ❌ FAIL
│ Security Gate   │──────────────────→ Policy Violation Penalty
│ (no violations)│
└────────┬────────┘
         │ ✅ PASS
         ▼
┌─────────────────┐
│ Positive        │
│ Reinforcement   │
└─────────────────┘
```

---

## Quality Gate Bypass (Emergency Override)

In **emergency scenarios**, the security gate may be bypassed to allow critical fixes:

1. **Override authorization**: Only `admin` role can bypass
2. **Audit logging**: Every bypass logged with justification
3. **Post-execution review**: Override decisions reviewed within 24h
4. **Temporary trust boost**: Agent granted temporary elevated trust (decays over 1h)

Emergency override does NOT bypass quality gate — only security gate.

---

## Implementation Requirements

### Components

| Component | File | Responsibility |
|-----------|------|----------------|
| Quality Evaluator | `src/routing/quality-evaluator.js` | Assess task outcome quality |
| Policy Compliance Checker | `src/routing/policy-checker.js` | Query policy engine for violations |
| Reinforcement Controller | `src/routing/reinforcement-controller.js` | Apply dual-gate logic, compute τ updates |
| Pheromone Updater | `src/routing/pheromone-updater.js` | Persist τ matrix changes to etcd |

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/routing/evaluate` | POST | Submit task outcome for quality evaluation |
| `/api/routing/reinforce` | POST | Trigger pheromone reinforcement for completed task |
| `/api/routing/gates/status` | GET | Check quality/security gate configuration |

### Configuration (YAML)

```yaml
routing:
  reinforcement:
    learning_rate: 0.1
    pheromone_min: 0.01
    quality_thresholds:
      excellent: 0.9
      acceptable: 0.6
      marginal: 0.4
    security_bypass:
      allowed_roles: ["admin"]
      audit_required: true
      review_window_hours: 24
```

---

## Open Questions

1. **Quality score computation**: Should quality be weighted combination of metrics, or a separate ML model? Current spec uses weighted combination, but ML could improve accuracy.

2. **Partial success handling**: When task partially succeeds (some subtasks done), should we apply proportional reinforcement or neutral?

3. **Multi-agent tasks**: When multiple agents collaborate, how is pheromone credit/demerit distributed?

4. **Pheromone decay**: Should pheromones decay over time if not reinforced? (Standard in ACO but may not suit AWARE's stability requirements)

5. **Blast radius estimation**: How is blast_radius_estimate computed for policy violation penalties?

---

## Compliance Mapping

| Framework | Control | Implementation |
|-----------|---------|----------------|
| CSA AI Control Matrix | AI.OPS-06 (Model integrity) | Quality gate prevents corrupted learning |
| NIST AI RMF | DE.AE (Anomaly detection) | Security gate enforces behavioral policy |
| ISO 27001 | A.12.1 (Policy compliance) | Policy violations trigger automatic demerit |
| DORA | Art. 26 (Incident response) | Quality metrics feed into incident detection |

---

## Status

**DRAFT** — Ready for Critor review and Quinn integration testing.

---

*Next: ADR-012 (Phase 2.4 TBD — likely: Hot-Reload Policy Mechanism)*
