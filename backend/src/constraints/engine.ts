/**
 * engine.ts — Constraint evaluation engine
 *
 * Main entry point for evaluating actions against all registered constraints.
 * T0 violations are hard blocks. T1-T4 are configurable.
 */

import type {
  AgentAction,
  AuditEntry,
  Constraint,
  ConstraintResult,
  Tier,
} from './types.js';
import { T0ConstraintRegistry } from './t0/index.js';

export interface EngineConfig {
  // If true, T1-T3 violations block instead of just alerting
  blockOnTierViolation?: boolean;
  // Chain ID for the audit log
  auditChainId?: string;
}

export class ConstraintEngine {
  private readonly t0: T0ConstraintRegistry;
  private readonly constraintsByTier = new Map<Tier, Constraint[]>();
  private readonly auditLog: AuditEntry[] = [];
  private readonly blockOnTierViolation: boolean;

  constructor(config?: EngineConfig) {
    this.blockOnTierViolation = config?.blockOnTierViolation ?? false;
    this.t0 = new T0ConstraintRegistry({
      approvedChannels: [],
    });

    this.constraintsByTier.set('T0', this.t0.getConstraints());
    // T1-T4 registered via registerConstraint()
  }

  // ── T0 access ────────────────────────────────────────────────────────────────

  get t0Registry(): T0ConstraintRegistry {
    return this.t0;
  }

  // ── Constraint registration ─────────────────────────────────────────────────

  registerConstraint(tier: Tier, constraint: Constraint): void {
    const existing = this.constraintsByTier.get(tier) ?? [];
    existing.push(constraint);
    this.constraintsByTier.set(tier, existing);
  }

  getConstraintsForTier(tier: Tier): Constraint[] {
    return [...(this.constraintsByTier.get(tier) ?? [])];
  }

  // ── Core evaluation ─────────────────────────────────────────────────────────

  /**
   * Evaluate an action against all registered constraints.
   * T0 violations are always hard blocks.
   * T1-T4 violations depend on blockOnTierViolation config.
   */
  async evaluate(action: AgentAction): Promise<ConstraintResult> {
    // Always evaluate T0 first (hard blocks)
    const t0Result = await this.t0.evaluate(action);
    if (!t0Result.allowed) {
      return t0Result;
    }

    // Evaluate T1-T4 in order
    const tiers: Tier[] = ['T1', 'T2', 'T3', 'T4'];
    for (const tier of tiers) {
      const constraints = this.constraintsByTier.get(tier) ?? [];
      for (const constraint of constraints) {
        const result = await constraint.evaluate(action);
        if (!result.allowed) {
          if (this.blockOnTierViolation) {
            return result;
          }
          // Just alert/log — don't block
          console.warn(`[aware] ${tier} violation: ${constraint.name} — ${result.violated?.message}`);
        }
      }
    }

    return { allowed: true };
  }

  /**
   * Evaluate only T0 (for pre-flight checks without running all tiers).
   */
  async evaluateT0(action: AgentAction): Promise<ConstraintResult> {
    return this.t0.evaluate(action);
  }

  // ── Audit log ───────────────────────────────────────────────────────────────

  getAuditLog(): AuditEntry[] {
    return [...this.auditLog];
  }

  getAuditTailHash(): string {
    return this.t0.audit.getTailHash();
  }

  verifyAuditChain(): { valid: boolean; brokenEntries: string[] } {
    return this.t0.audit.verifyChain();
  }
}
