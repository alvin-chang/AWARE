/**
 * t0/index.ts — T0 constraint bundle
 *
 * Composes all 4 T0 constraints into a single registry.
 * T0 violations are always hard blocks — no override.
 */

import { NoExfiltrationConstraint } from './exfiltration.js';
import { HumanGateConstraint } from './human-gate.js';
import { CryptoIdConstraint } from './crypto-id.js';
import { AppendOnlyAuditConstraint } from './audit.js';
import type { ApprovedChannel, AgentAction, Constraint, ConstraintResult, HumanApproval } from '../types.js';

export { NoExfiltrationConstraint } from './exfiltration.js';
export { HumanGateConstraint } from './human-gate.js';
export { CryptoIdConstraint } from './crypto-id.js';
export { AppendOnlyAuditConstraint } from './audit.js';

export interface T0Config {
  approvedChannels: ApprovedChannel[];
}

export class T0ConstraintRegistry {
  readonly exfiltration = new NoExfiltrationConstraint();
  readonly humanGate = new HumanGateConstraint();
  readonly cryptoId = new CryptoIdConstraint();
  readonly audit = new AppendOnlyAuditConstraint();

  private readonly constraints: Constraint[];

  constructor(config?: T0Config) {
    if (config?.approvedChannels) {
      config.approvedChannels.forEach(ch => this.exfiltration.addChannel(ch));
    }
    this.constraints = [
      this.exfiltration,
      this.humanGate,
      this.cryptoId,
      this.audit,
    ];
  }

  getConstraints(): Constraint[] {
    return [...this.constraints];
  }

  /**
   * Evaluate all T0 constraints against an action.
   * Stops at first violation (fail-fast).
   */
  async evaluate(action: AgentAction): Promise<ConstraintResult> {
    for (const constraint of this.constraints) {
      const result = await constraint.evaluate(action);
      if (!result.allowed) {
        // Log to audit even on block
        this.audit.append({
          id: `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          action,
          result,
          timestamp: new Date().toISOString(),
        });
        return result;
      }

      // Log successful evaluations to audit
      this.audit.append({
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        action,
        result,
        timestamp: new Date().toISOString(),
      });
    }

    return { allowed: true };
  }

  // ── Convenience helpers ─────────────────────────────────────────────────────

  approve(approval: HumanApproval): void {
    this.humanGate.approve(approval);
  }

  revokeApproval(actionId: string): void {
    this.humanGate.revoke(actionId);
  }

  generateKeyPair(agentId: string) {
    return this.cryptoId.generateKeyPair(agentId);
  }

  registerKeyPair(agentId: string, publicKey: string, privateKey: string) {
    this.cryptoId.registerKeyPair(agentId, { publicKey, privateKey, keyId: `${agentId}-key` });
  }

  addApprovedChannel(channel: ApprovedChannel): void {
    this.exfiltration.addChannel(channel);
  }

  pruneExpiredApprovals(maxAgeMs?: number): number {
    return this.humanGate.pruneExpired(maxAgeMs);
  }
}
