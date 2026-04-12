/**
 * t0/human-gate.ts — T0-2: Human authority gate
 *
 * Any operation tagged privileged=true must have human approval token before execution.
 * Violation → BLOCK. No override possible at T0 level.
 */

import type { AgentAction, Constraint, ConstraintResult, HumanApproval } from '../types.js';

export class HumanGateConstraint implements Constraint {
  readonly id = 'T0-2';
  readonly tier: 'T0' = 'T0';
  readonly name = 'Human Authority Gate';
  readonly description = 'Privileged operations require human confirmation';

  // Map from action.id → approval token
  private approvalStore = new Map<string, HumanApproval>();

  /**
   * Record a human approval for a specific action.
   * Called by the approval flow before the action reaches the constraint engine.
   */
  approve(approval: HumanApproval): void {
    this.approvalStore.set(approval.actionId, approval);
  }

  /**
   * Revoke a pending approval (e.g., timeout expired).
   */
  revoke(actionId: string): void {
    this.approvalStore.delete(actionId);
  }

  /**
   * Check if an action is already approved.
   */
  isApproved(actionId: string): boolean {
    return this.approvalStore.has(actionId);
  }

  /**
   * Get the approval record for an action.
   */
  getApproval(actionId: string): HumanApproval | undefined {
    return this.approvalStore.get(actionId);
  }

  /**
   * Prune expired approvals (older than maxAgeMs).
   */
  pruneExpired(maxAgeMs: number = 5 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    let pruned = 0;
    for (const [id, approval] of this.approvalStore.entries()) {
      if (new Date(approval.approvedAt).getTime() < cutoff) {
        this.approvalStore.delete(id);
        pruned++;
      }
    }
    return pruned;
  }

  async evaluate(action: AgentAction): Promise<ConstraintResult> {
    // Only gate privileged actions
    if (!action.privileged) {
      return { allowed: true };
    }

    const approval = this.approvalStore.get(action.id);

    if (!approval) {
      return {
        allowed: false,
        violated: {
          tier: 'T0',
          constraint: 'T0-2',
          message: `T0-2 BLOCKED: Privileged action "${action.action}" (id=${action.id}) requires human approval token. No approval found.`,
          blockedAt: new Date().toISOString(),
          action,
        },
      };
    }

    // Validate the approval hasn't expired (10 minute window)
    const approvalTime = new Date(approval.approvedAt).getTime();
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutes

    if (now - approvalTime > maxAge) {
      this.approvalStore.delete(action.id);
      return {
        allowed: false,
        violated: {
          tier: 'T0',
          constraint: 'T0-2',
          message: `T0-2 BLOCKED: Approval for "${action.action}" has expired. Please re-approve.`,
          blockedAt: new Date().toISOString(),
          action,
        },
      };
    }

    // Remove after use — single-use token
    this.approvalStore.delete(action.id);

    return {
      allowed: true,
      approvedBy: approval.approverName,
      auditHash: approval.signature,
    };
  }
}
