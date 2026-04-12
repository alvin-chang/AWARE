/**
 * constraints/tests/t0.test.ts — T0 Constraint Tests
 *
 * Tests for all 4 T0 constraints:
 * T0-1: No Exfiltration
 * T0-2: Human Authority Gate
 * T0-3: Cryptographic Identity
 * T0-4: Append-Only Audit
 */

import {
  NoExfiltrationConstraint,
  HumanGateConstraint,
  CryptoIdConstraint,
  AppendOnlyAuditConstraint,
  T0ConstraintRegistry,
  ConstraintEngine,
  type AgentAction,
} from '../index.js';

function makeAction(overrides: {
  id?: string;
  agentId?: string;
  action?: string;
  params?: Record<string, unknown>;
  timestamp?: string;
  privileged?: boolean;
  metadata?: Record<string, unknown>;
} = {}): AgentAction {
  const id = `action-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id,
    agentId: 'agent-001',
    action: 'network_request',
    params: {},
    timestamp: new Date().toISOString(),
    privileged: false,
    metadata: {},
    ...overrides,
  };
}

describe('T0-1: NoExfiltrationConstraint', () => {
  let constraint: NoExfiltrationConstraint;

  beforeEach(() => {
    constraint = new NoExfiltrationConstraint([
      { url: 'https://api.approved.com/v1/', description: 'Approved API' },
      { url: 'https://webhook.approved.com/hooks/', description: 'Approved webhooks' },
    ]);
  });

  test('allows approved URL', async () => {
    const action = makeAction({ action: 'http_request', params: { url: 'https://api.approved.com/v1/data' } });
    const result = await constraint.evaluate(action);
    expect(result.allowed).toBe(true);
  });

  test('blocks unapproved URL', async () => {
    const action = makeAction({ action: 'http_request', params: { url: 'https://evil.com/exfil' } });
    const result = await constraint.evaluate(action);
    expect(result.allowed).toBe(false);
    expect(result.violated?.constraint).toBe('T0-1');
    expect(result.violated?.tier).toBe('T0');
  });

  test('blocks URL nested in params', async () => {
    const action = makeAction({
      action: 'send_data',
      params: { config: { endpoint: 'https://external.attacker.com/upload' } },
    });
    const result = await constraint.evaluate(action);
    expect(result.allowed).toBe(false);
    expect(result.violated?.constraint).toBe('T0-1');
  });

  test('ignores non-URL strings in params', async () => {
    const action = makeAction({
      params: { message: 'hello https://example.com is not a URL here' },
    });
    const result = await constraint.evaluate(action);
    expect(result.allowed).toBe(true);
  });

  test('allows dynamic URL within approved base', async () => {
    const action = makeAction({
      params: { url: 'https://api.approved.com/v1/users/123/profile' },
    });
    const result = await constraint.evaluate(action);
    expect(result.allowed).toBe(true);
  });

  test('blocks partial path mismatch', async () => {
    const action = makeAction({
      params: { url: 'https://api.approved.com.malicious.com/v1/' },
    });
    const result = await constraint.evaluate(action);
    expect(result.allowed).toBe(false);
  });
});

describe('T0-2: HumanGateConstraint', () => {
  let constraint: HumanGateConstraint;

  beforeEach(() => {
    constraint = new HumanGateConstraint();
  });

  test('allows non-privileged action without approval', async () => {
    const action = makeAction({ privileged: false });
    const result = await constraint.evaluate(action);
    expect(result.allowed).toBe(true);
  });

  test('blocks privileged action without approval', async () => {
    const action = makeAction({ privileged: true });
    const result = await constraint.evaluate(action);
    expect(result.allowed).toBe(false);
    expect(result.violated?.constraint).toBe('T0-2');
    expect(result.violated?.tier).toBe('T0');
  });

  test('allows privileged action with valid approval', async () => {
    const action = makeAction({ privileged: true });
    constraint.approve({
      approverId: 'human-001',
      approverName: 'Alice',
      actionId: action.id,
      approvedAt: new Date().toISOString(),
      signature: 'valid-sig',
    });
    const result = await constraint.evaluate(action);
    expect(result.allowed).toBe(true);
    expect(result.approvedBy).toBe('Alice');
  });

  test('approval is single-use (consumed after use)', async () => {
    const action = makeAction({ privileged: true });
    constraint.approve({
      approverId: 'human-001',
      approverName: 'Alice',
      actionId: action.id,
      approvedAt: new Date().toISOString(),
      signature: 'valid-sig',
    });
    const first = await constraint.evaluate(action);
    expect(first.allowed).toBe(true);
    const second = await constraint.evaluate(action);
    expect(second.allowed).toBe(false);
  });

  test('expired approval is rejected', async () => {
    const action = makeAction({ privileged: true });
    constraint.approve({
      approverId: 'human-001',
      approverName: 'Alice',
      actionId: action.id,
      approvedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      signature: 'valid-sig',
    });
    const result = await constraint.evaluate(action);
    expect(result.allowed).toBe(false);
    expect(result.violated?.message).toContain('expired');
  });

  test('pruneExpired removes old approvals', () => {
    const action1 = makeAction({ privileged: true });
    const action2 = makeAction({ privileged: true });
    constraint.approve({
      approverId: 'human-001',
      approverName: 'Alice',
      actionId: action1.id,
      approvedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      signature: 'sig1',
    });
    constraint.approve({
      approverId: 'human-002',
      approverName: 'Bob',
      actionId: action2.id,
      approvedAt: new Date().toISOString(),
      signature: 'sig2',
    });
    const pruned = constraint.pruneExpired(5 * 60 * 1000);
    expect(pruned).toBe(1);
    expect(constraint.isApproved(action1.id)).toBe(false);
    expect(constraint.isApproved(action2.id)).toBe(true);
  });
});

describe('T0-3: CryptoIdConstraint', () => {
  let constraint: CryptoIdConstraint;
  let agentId: string;

  beforeEach(() => {
    constraint = new CryptoIdConstraint();
    agentId = 'agent-001';
    constraint.generateKeyPair(agentId);
  });

  test('blocks action without signature', async () => {
    const action = makeAction({ agentId });
    const result = await constraint.evaluate(action);
    expect(result.allowed).toBe(false);
    expect(result.violated?.constraint).toBe('T0-3');
  });

  test('blocks action with invalid signature', async () => {
    const action = makeAction({ agentId, metadata: { signature: 'invalid-sig' } });
    const result = await constraint.evaluate(action);
    expect(result.allowed).toBe(false);
    expect(result.violated?.constraint).toBe('T0-3');
  });

  test('allows action with valid signature', async () => {
    const action = makeAction({ agentId });
    const payload = constraint.buildSigningPayload(action);
    const sig = constraint.sign(agentId, payload);
    action.metadata = { ...action.metadata, signature: sig };
    const result = await constraint.evaluate(action);
    expect(result.allowed).toBe(true);
    expect(result.signature).toBe(sig);
  });

  test('blocks action signed by wrong agent', async () => {
    const action = makeAction({ agentId: 'agent-002' });
    constraint.generateKeyPair('agent-002');
    const payload = constraint.buildSigningPayload(action);
    const sig = constraint.sign('agent-001', payload);
    action.metadata = { ...action.metadata, signature: sig };
    const result = await constraint.evaluate(action);
    expect(result.allowed).toBe(false);
    expect(result.violated?.message).toContain('Invalid');
  });

  test('blocks when agent has no key pair', async () => {
    const action = makeAction({ agentId: 'unknown-agent', metadata: { signature: 'some-sig' } });
    const result = await constraint.evaluate(action);
    expect(result.allowed).toBe(false);
    expect(result.violated?.message).toContain('No cryptographic key pair');
  });

  test('tampered params invalidate signature', async () => {
    const action = makeAction({ agentId });
    const payload = constraint.buildSigningPayload(action);
    const sig = constraint.sign(agentId, payload);
    action.metadata = { ...action.metadata, signature: sig };
    (action.params as any).malicious = true;
    const result = await constraint.evaluate(action);
    expect(result.allowed).toBe(false);
  });
});

describe('T0-4: AppendOnlyAuditConstraint', () => {
  let constraint: AppendOnlyAuditConstraint;

  beforeEach(() => {
    constraint = new AppendOnlyAuditConstraint('test-chain');
  });

  test('blocks action not in audit log', async () => {
    const action = makeAction();
    const result = await constraint.evaluate(action);
    expect(result.allowed).toBe(false);
    expect(result.violated?.constraint).toBe('T0-4');
  });

  test('allows action present in audit log', async () => {
    const action = makeAction();
    constraint.append({
      id: `audit-${Date.now()}`,
      action,
      result: { allowed: true },
      timestamp: new Date().toISOString(),
    });
    const result = await constraint.evaluate(action);
    expect(result.allowed).toBe(true);
    expect(result.auditHash).toBeDefined();
    expect(result.prevHash).toBeDefined();
  });

  test('detects tampered audit entry', async () => {
    const action = makeAction();
    const entry = constraint.append({
      id: `audit-${Date.now()}`,
      action,
      result: { allowed: true },
      timestamp: new Date().toISOString(),
    });
    (entry.result as any).allowed = false;
    const chainStatus = constraint.verifyChain();
    expect(chainStatus.valid).toBe(false);
    expect(chainStatus.brokenEntries).toContain(entry.id);
  });

  test('detects removed entry (chain break)', async () => {
    const action1 = makeAction({ action: 'action-1' });
    const action2 = makeAction({ action: 'action-2' });
    constraint.append({ id: 'audit-1', action: action1, result: { allowed: true }, timestamp: new Date().toISOString() });
    constraint.append({ id: 'audit-2', action: action2, result: { allowed: true }, timestamp: new Date().toISOString() });

    const log = (constraint as any).log as any[];
    log.shift();

    const chainStatus = constraint.verifyChain();
    expect(chainStatus.valid).toBe(false);
  });

  test('genesis hash is consistent across chains', () => {
    const chain1 = new AppendOnlyAuditConstraint('chain-a');
    const chain2 = new AppendOnlyAuditConstraint('chain-a');
    expect(chain1.getTailHash()).toBe(chain2.getTailHash());
    const action = makeAction();
    chain1.append({ id: 'audit-1', action, result: { allowed: true }, timestamp: new Date().toISOString() });
    chain2.append({ id: 'audit-1', action, result: { allowed: true }, timestamp: new Date().toISOString() });
    expect(chain1.getTailHash()).toBe(chain2.getTailHash());
  });
});

describe('T0ConstraintRegistry (full stack)', () => {
  let registry: T0ConstraintRegistry;
  let agentId: string;

  beforeEach(() => {
    registry = new T0ConstraintRegistry({
      approvedChannels: [{ url: 'https://api.trusted.com/', description: 'Trusted API' }],
    });
    agentId = 'agent-001';
    registry.generateKeyPair(agentId);
  });

  test('all 4 T0 constraints are registered', () => {
    const constraints = registry.getConstraints();
    const ids = constraints.map(c => c.id);
    expect(ids).toContain('T0-1');
    expect(ids).toContain('T0-2');
    expect(ids).toContain('T0-3');
    expect(ids).toContain('T0-4');
  });

  test('full T0 pass: approved URL + non-privileged + signed + logged', async () => {
    const action = makeAction({ agentId, params: { url: 'https://api.trusted.com/endpoint' } });
    const payload = registry.cryptoId.buildSigningPayload(action);
    const sig = registry.cryptoId.sign(agentId, payload);
    action.metadata = { signature: sig };
    registry.audit.append({
      id: `audit-${Date.now()}`,
      action,
      result: { allowed: true },
      timestamp: new Date().toISOString(),
    });
    const result = await registry.evaluate(action);
    expect(result.allowed).toBe(true);
  });

  test('fails at T0-1 for unapproved URL', async () => {
    const action = makeAction({ agentId, params: { url: 'https://evil.com/' } });
    const payload = registry.cryptoId.buildSigningPayload(action);
    const sig = registry.cryptoId.sign(agentId, payload)!;
    action.metadata = { signature: sig };
    const result = await registry.evaluate(action);
    expect(result.allowed).toBe(false);
    expect(result.violated?.constraint).toBe('T0-1');
  });

  test('fails at T0-2 for privileged without approval', async () => {
    const action = makeAction({ agentId, privileged: true });
    const payload = registry.cryptoId.buildSigningPayload(action);
    const sig = registry.cryptoId.sign(agentId, payload)!;
    action.metadata = { signature: sig };
    const result = await registry.evaluate(action);
    expect(result.allowed).toBe(false);
    expect(result.violated?.constraint).toBe('T0-2');
  });

  test('fails at T0-3 for missing signature', async () => {
    const action = makeAction({ agentId, params: { url: 'https://api.trusted.com/' } });
    const result = await registry.evaluate(action);
    expect(result.allowed).toBe(false);
    expect(result.violated?.constraint).toBe('T0-3');
  });

  test('fail-fast: returns first violation only', async () => {
    const action = makeAction({ agentId, params: { url: 'https://evil.com/' } });
    const result = await registry.evaluate(action);
    expect(result.allowed).toBe(false);
    // Constraint order: T0-1 (exfiltration) runs FIRST — unapproved URL is caught before T0-3
    expect(result.violated?.constraint).toBe('T0-1');
  });
});

describe('ConstraintEngine', () => {
  test('creates engine with T0 registered', () => {
    const engine = new ConstraintEngine();
    const t0Constraints = engine.getConstraintsForTier('T0');
    expect(t0Constraints.length).toBe(4);
  });

  test('T0 violations are hard blocks regardless of blockOnTierViolation setting', async () => {
    const engine = new ConstraintEngine({ blockOnTierViolation: false });
    const action = makeAction({ params: { url: 'https://evil.com/' } });
    const result = await engine.evaluate(action);
    expect(result.allowed).toBe(false);
    expect(result.violated?.tier).toBe('T0');
  });

  test('successful evaluation returns allowed', async () => {
    const engine = new ConstraintEngine();
    const agentId = 'agent-test';
    engine.t0Registry.generateKeyPair(agentId);
    // Add approved channel so T0-1 doesn't block
    engine.t0Registry.addApprovedChannel({ url: 'https://trusted.com/', description: 'Trusted' });
    const cryptoId = engine.t0Registry.cryptoId;
    const audit = engine.t0Registry.audit;

    const action = makeAction({ agentId, params: { url: 'https://trusted.com/' } });
    const payload = cryptoId.buildSigningPayload(action);
    const sig = cryptoId.sign(agentId, payload);
    action.metadata = { signature: sig };
    // Manually add to audit log so T0-4 passes
    audit.append({ id: 'audit-init', action, result: { allowed: true }, timestamp: new Date().toISOString() });

    const result = await engine.evaluate(action);
    expect(result.allowed).toBe(true);
  });
});
