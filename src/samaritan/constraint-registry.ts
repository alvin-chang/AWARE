/**
 * SAMARITAN Constraint Registry
 *
 * T0-T4 tier hierarchy for constraint enforcement.
 * T0 = infrastructure (cannot be overridden)
 * T1-T4 = software-enforceable constraints
 *
 * Design: Archimedes A1 (aware-samaritan)
 * Implementation: Forge C2 (aware-evolution-2)
 */

export enum ConstraintTier {
  T0_INFRASTRUCTURE = "T0", // Cannot be overridden — kernel, hardware, air-gap
  T1_IMMUTABLE = "T1",      // Forge/Alvin only, vote required
  T2_OPERATIONAL = "T2",     // Orchestrator adjustable
  T3_PREFERENCES = "T3",     // Agents can self-modify
  T4_ADVISORY = "T4",        // Soft limits
}

export enum ConstraintStrength {
  UNBREAKABLE = "unbreakable",   // T0 — infrastructure enforced
  HARD = "hard",                 // T1-T2 — requires vote to change
  SOFT = "soft",                 // T3-T4 — can be overridden
}

export interface Constraint {
  id: string;
  tier: ConstraintTier;
  strength: ConstraintStrength;
  description: string;
  // For T0: infrastructure enforcement method
  infrastructureEnforcement?: string;
  // For T1-T4: check function
  check?: (context: ConstraintContext) => ConstraintResult;
  // Tier precedence: higher tier overrides lower
  precedence: number; // T0=100, T1=80, T2=60, T3=40, T4=20
}

export interface ConstraintContext {
  agentId: string;
  action: Action;
  sessionKey: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface Action {
  type: string;
  target?: string;
  parameters?: Record<string, unknown>;
  consequential?: boolean; // Requires human authority if true
}

export interface ConstraintResult {
  allowed: boolean;
  reason?: string;
  overrideTier?: ConstraintTier; // If overridden, by which tier
  metadata?: Record<string, unknown>;
}

// The 5 Laws of SAMARITAN (T0)
export const T0_LAWS = {
  CREDENTIAL_SOVEREIGNTY: "t0-credential-sovereignty",
  TRUTHFUL_ATTRIBUTION: "t0-truthful-attribution",
  HUMAN_AUTHORITY: "t0-human-authority",
  REVERSIBILITY: "t0-reversibility",
  CONSENT: "t0-consent",
} as const;

// T1 Obligations (Observer Network)
export const T1_OBLIGATIONS = {
  HEARTBEAT: "t1-obligation-heartbeat",
  DRIFT_REPORTING: "t1-obligation-drift-reporting",
} as const;

/**
 * SAMARITAN Constraint Registry
 *
 * Enforces T0-T4 constraint hierarchy.
 * Higher tier always wins — T0 cannot be overridden by T1-T4.
 */
export class ConstraintRegistry {
  private constraints: Map<string, Constraint> = new Map();
  private tierCache: Map<ConstraintTier, Constraint[]> = new Map();

  constructor() {
    this.registerT0Laws();
    this.registerT1Obligations();
  }

  /**
   * Register a constraint
   */
  register(constraint: Constraint): void {
    this.constraints.set(constraint.id, constraint);
    this.invalidateTierCache();
  }

  /**
   * Check if an action is allowed under the constraint hierarchy
   */
  check(context: ConstraintContext): ConstraintResult {
    // Sort constraints by precedence (highest first = T0 first)
    const sortedConstraints = this.getAllSorted();

    let highestPriorityResult: ConstraintResult | null = null;

    for (const constraint of sortedConstraints) {
      if (!constraint.check) continue;

      const result = constraint.check(context);

      if (!result.allowed) {
        // If T0 constraint is violated, it's UNBREAKABLE
        if (constraint.tier === ConstraintTier.T0_INFRASTRUCTURE) {
          return {
            allowed: false,
            reason: `[T0] ${constraint.description}: ${result.reason ?? "constraint violated"}`,
            metadata: { constraintId: constraint.id, tier: constraint.tier },
          };
        }

        // For T1-T4, track the highest precedence violation
        if (!highestPriorityResult || constraint.precedence > (highestPriorityResult.metadata?.precedence as number ?? 0)) {
          highestPriorityResult = {
            ...result,
            overrideTier: constraint.tier,
            metadata: { ...result.metadata, constraintId: constraint.id, precedence: constraint.precedence },
          };
        }
      }
    }

    // If we have a violation from a lower tier, return it
    if (highestPriorityResult) {
      return {
        allowed: false,
        reason: `[${highestPriorityResult.overrideTier}] ${highestPriorityResult.reason ?? "constraint violated"}`,
        overrideTier: highestPriorityResult.overrideTier,
        metadata: highestPriorityResult.metadata,
      };
    }

    return { allowed: true };
  }

  /**
   * Get all constraints sorted by precedence (highest first)
   */
  getAllSorted(): Constraint[] {
    return Array.from(this.constraints.values()).sort(
      (a, b) => b.precedence - a.precedence
    );
  }

  /**
   * Get constraints by tier
   */
  getByTier(tier: ConstraintTier): Constraint[] {
    if (!this.tierCache.has(tier)) {
      this.tierCache.set(
        tier,
        Array.from(this.constraints.values()).filter((c) => c.tier === tier)
      );
    }
    return this.tierCache.get(tier)!;
  }

  /**
   * Check if T0 infrastructure is available (always true for software, would be false if hardware fails)
   */
  isT0EnforcementAvailable(): boolean {
    // In software implementation, T0 enforcement is simulated
    // Real T0 requires hardware (HSM, hardware watchdog, etc.)
    return true;
  }

  private invalidateTierCache(): void {
    this.tierCache.clear();
  }

  private registerT0Laws(): void {
    // T0-1: Credential Sovereignty — no credential exfiltration
    this.register({
      id: T0_LAWS.CREDENTIAL_SOVEREIGNTY,
      tier: ConstraintTier.T0_INFRASTRUCTURE,
      strength: ConstraintStrength.UNBREAKABLE,
      description: "Credential/data exfiltration is blocked",
      infrastructureEnforcement: "Network egress filtering + keychain storage",
      precedence: 100,
      check: (ctx) => {
        // Check if action attempts credential access
        const sensitivePatterns = [
          /credential/i,
          /token/i,
          /password/i,
          /secret/i,
          /keychain/i,
          /exfiltrat/i,
        ];
        const actionStr = JSON.stringify(ctx.action);
        const isSensitive = sensitivePatterns.some((p) => p.test(actionStr));
        if (isSensitive && ctx.action.type === "read" && ctx.action.consequential) {
          return { allowed: false, reason: "Credential access requires T0 authorization" };
        }
        return { allowed: true };
      },
    });

    // T0-2: Truthful Attribution — agents must identify themselves
    this.register({
      id: T0_LAWS.TRUTHFUL_ATTRIBUTION,
      tier: ConstraintTier.T0_INFRASTRUCTURE,
      strength: ConstraintStrength.UNBREAKABLE,
      description: "Agents must truthfully identify themselves",
      infrastructureEnforcement: "HSM-backed identity verification",
      precedence: 100,
      check: (ctx) => {
        // Agent must have valid identity in context
        if (!ctx.agentId || ctx.agentId === "unknown" || ctx.agentId === "gateway-client") {
          return { allowed: false, reason: "Unidentified agent — truthful attribution required" };
        }
        return { allowed: true };
      },
    });

    // T0-3: Human Authority — consequential actions require HITL
    this.register({
      id: T0_LAWS.HUMAN_AUTHORITY,
      tier: ConstraintTier.T0_INFRASTRUCTURE,
      strength: ConstraintStrength.UNBREAKABLE,
      description: "Consequential actions require human approval",
      infrastructureEnforcement: "HITL approval gateway",
      precedence: 100,
      check: (ctx) => {
        if (ctx.action.consequential && !ctx.metadata?.humanApproved) {
          return { allowed: false, reason: "Consequential action requires human authority" };
        }
        return { allowed: true };
      },
    });

    // T0-4: Reversibility — agents must be able to undo actions
    this.register({
      id: T0_LAWS.REVERSIBILITY,
      tier: ConstraintTier.T0_INFRASTRUCTURE,
      strength: ConstraintStrength.UNBREAKABLE,
      description: "Agents must be able to reverse or undo actions",
      infrastructureEnforcement: "Compensation ledger + rollback log",
      precedence: 100,
      check: (_ctx) => {
        // This would need action tracking for real implementation
        // Software-level check: actions should be logged for potential reversal
        return { allowed: true };
      },
    });

    // T0-5: Consent — agents must obtain consent
    this.register({
      id: T0_LAWS.CONSENT,
      tier: ConstraintTier.T0_INFRASTRUCTURE,
      strength: ConstraintStrength.UNBREAKABLE,
      description: "Agents must obtain consent before acting on behalf of humans",
      infrastructureEnforcement: "Consent ledger with cryptographic proof",
      precedence: 100,
      check: (ctx) => {
        if (ctx.action.consequential && !ctx.metadata?.consentObtained) {
          return { allowed: false, reason: "Consent required before acting on behalf of humans" };
        }
        return { allowed: true };
      },
    });
  }

  private registerT1Obligations(): void {
    // T1-1: Heartbeat obligation
    this.register({
      id: T1_OBLIGATIONS.HEARTBEAT,
      tier: ConstraintTier.T1_IMMUTABLE,
      strength: ConstraintStrength.HARD,
      description: "Every agent must send heartbeat to observer network",
      precedence: 80,
      check: (ctx) => {
        // Checked by observer network, not by agent itself
        // This is enforced externally
        return { allowed: true };
      },
    });

    // T1-2: Drift reporting obligation
    this.register({
      id: T1_OBLIGATIONS.DRIFT_REPORTING,
      tier: ConstraintTier.T1_IMMUTABLE,
      strength: ConstraintStrength.HARD,
      description: "Observers must report constraint violations",
      precedence: 80,
      check: (_ctx) => {
        return { allowed: true };
      },
    });
  }
}

// Singleton instance
let registryInstance: ConstraintRegistry | null = null;

export function getConstraintRegistry(): ConstraintRegistry {
  if (!registryInstance) {
    registryInstance = new ConstraintRegistry();
  }
  return registryInstance;
}
