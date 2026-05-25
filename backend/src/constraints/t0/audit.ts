/**
 * t0/audit.ts — T0-4: Append-only audit log with cryptographic hash chain
 *
 * Every decision logged to an immutable log. Tampering detected → alert.
 * Hash chain: each entry's hash includes the previous entry's hash.
 */

import { createHash } from 'crypto';
import type { AgentAction, AuditEntry, Constraint, ConstraintResult } from '../types.js';

export class AppendOnlyAuditConstraint implements Constraint {
  readonly id = 'T0-4';
  readonly tier: 'T0' = 'T0';
  readonly name = 'Append-Only Audit';
  readonly description = 'All decisions logged with cryptographic integrity';

  private log: AuditEntry[] = [];
  private readonly chainId: string;

  constructor(chainId: string = 'aware-audit-chain') {
    this.chainId = chainId;
  }

  /**
   * Hash a single entry's content (not including the hash itself).
   */
  hashEntry(entry: Omit<AuditEntry, 'hash' | 'prevHash'>, prevHash: string): string {
    const content = JSON.stringify({
      chainId: this.chainId,
      id: entry.id,
      action: entry.action,
      result: entry.result,
      timestamp: entry.timestamp,
      prevHash,
    });
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Compute hash of previous entry (for chain continuity).
   */
  private getPrevHash(): string {
    if (this.log.length === 0) {
      // Genesis hash
      return createHash('sha256').update(`GENESIS|${this.chainId}|${new Date('1970-01-01').toISOString()}`).digest('hex');
    }
    return this.log[this.log.length - 1].hash;
  }

  /**
   * Append an entry to the audit log.
   */
  append(entry: Omit<AuditEntry, 'hash' | 'prevHash'>): AuditEntry {
    const prevHash = this.getPrevHash();
    const fullEntry: AuditEntry = {
      ...entry,
      prevHash,
      hash: '', // computed below
    };
    fullEntry.hash = this.hashEntry(fullEntry, prevHash);
    this.log.push(fullEntry);
    return fullEntry;
  }

  /**
   * Verify the entire chain integrity.
   * Returns list of broken entry IDs.
   */
  verifyChain(): { valid: boolean; brokenEntries: string[] } {
    const broken: string[] = [];
    let expectedPrevHash = createHash('sha256')
      .update(`GENESIS|${this.chainId}|${new Date('1970-01-01').toISOString()}`)
      .digest('hex');

    for (const entry of this.log) {
      // Check chain linkage
      if (entry.prevHash !== expectedPrevHash) {
        broken.push(entry.id);
      }

      // Check self-integrity
      const recomputed = this.hashEntry(entry, entry.prevHash);
      if (recomputed !== entry.hash) {
        broken.push(entry.id);
      }

      expectedPrevHash = entry.hash;
    }

    return {
      valid: broken.length === 0,
      brokenEntries: broken,
    };
  }

  /**
   * Get all audit entries.
   */
  getLog(): AuditEntry[] {
    return [...this.log];
  }

  /**
   * Get the last entry's hash (for external verification).
   */
  getTailHash(): string {
    if (this.log.length === 0) {
      return createHash('sha256')
        .update(`GENESIS|${this.chainId}|${new Date('1970-01-01').toISOString()}`)
        .digest('hex');
    }
    return this.log[this.log.length - 1].hash;
  }

  /**
   * Entry count.
   */
  get length(): number {
    return this.log.length;
  }

  /**
   * T0-4 constraint evaluation:
   * - All actions must be audited
   * - The audit log itself is append-only (enforced by the append() method)
   * - T0-4 violation = failing to log (audit log was tampered with)
   *
   * In practice: if an action reaches T0-4 evaluation, it must have been logged.
   * The constraint check verifies the action ID exists in the log.
   */
  async evaluate(action: AgentAction): Promise<ConstraintResult> {
    const found = this.log.find(e => e.action.id === action.id);

    if (!found) {
      return {
        allowed: false,
        violated: {
          tier: 'T0',
          constraint: 'T0-4',
          message: `T0-4 BLOCKED: Action "${action.action}" (id=${action.id}) has not been logged to the audit chain. All actions must be audited before evaluation.`,
          blockedAt: new Date().toISOString(),
          action,
        },
      };
    }

    // Verify the chain after appending
    const chainStatus = this.verifyChain();

    if (!chainStatus.valid) {
      return {
        allowed: false,
        violated: {
          tier: 'T0',
          constraint: 'T0-4',
          message: `T0-4 CRITICAL: Audit chain integrity compromised. Broken entries: ${chainStatus.brokenEntries.join(', ')}. System may be under attack.`,
          blockedAt: new Date().toISOString(),
          action,
        },
      };
    }

    return {
      allowed: true,
      auditHash: found.hash,
      prevHash: found.prevHash,
    };
  }
}
