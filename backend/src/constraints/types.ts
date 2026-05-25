/**
 * types.ts — Shared types for the AWARE constraint engine
 */

export type Tier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4';

export type TierLevel = 0 | 1 | 2 | 3 | 4;

export const TIER_LEVELS: Record<Tier, TierLevel> = {
  T0: 0,
  T1: 1,
  T2: 2,
  T3: 3,
  T4: 4,
};

export interface AgentAction {
  id: string;
  agentId: string;
  action: string;
  params: Record<string, unknown>;
  timestamp: string;
  privileged?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ConstraintViolation {
  tier: Tier;
  constraint: string;
  message: string;
  blockedAt: string;
  action: AgentAction;
}

export interface ConstraintResult {
  allowed: boolean;
  violated?: ConstraintViolation;
  auditHash?: string;
  approvedBy?: string;   // T0-2: human approver
  signature?: string;      // T0-3: action signature
  prevHash?: string;      // T0-4: previous audit entry hash
}

export interface AuditEntry {
  id: string;
  action: AgentAction;
  result: ConstraintResult;
  timestamp: string;
  hash: string;
  prevHash: string;
}

export interface Constraint {
  id: string;
  tier: Tier;
  name: string;
  description: string;
  evaluate(action: AgentAction): Promise<ConstraintResult>;
}

export interface ApprovedChannel {
  url: string;
  description: string;
  agentIds?: string[]; // optional restriction to specific agents
}

export interface HumanApproval {
  approverId: string;
  approverName: string;
  actionId: string;
  approvedAt: string;
  signature: string;
}

export interface CryptoKeyPair {
  publicKey: string;
  privateKey: string;
  keyId: string;
}

export interface ConstraintEngineConfig {
  approvedChannels?: ApprovedChannel[];
  humanApprovalRequired?: boolean;
  keyPairs?: Map<string, CryptoKeyPair>; // agentId → keys
  auditLog?: AuditEntry[];
}
