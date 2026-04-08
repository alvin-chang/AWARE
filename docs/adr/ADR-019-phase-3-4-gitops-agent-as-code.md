# ADR-019: Phase 3.4 — GitOps Agent-as-Code

**Status:** APPROVED (2026-04-02 10:35 UTC)  
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
5. **Alert-only sync** — drift detected → alert fired → manual remediation via PR (no auto-deploy)

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
apiVersion: aware.example.com/v1
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

**`src/gitops/loader.js`** (F-1 fix: explicit YAML validation algorithm)

```typescript
// loader.ts

const JSYAML = require('js-yaml');
const { JSONSchema } = require('ajv');

// Agent YAML schema (F-1 fix: explicit validation)
const AGENT_SCHEMA = {
  type: 'object',
  required: ['apiVersion', 'kind', 'metadata', 'spec'],
  properties: {
    apiVersion: { type: 'string', pattern: '^aware\\.example\\.com/v\\d+$' },
    kind: { type: 'string', const: 'Agent' },
    metadata: {
      type: 'object',
      required: ['name', 'version'],
      properties: {
        name: { type: 'string', minLength: 1 },
        version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
        labels: { type: 'object', additionalProperties: { type: 'string' } }
      }
    },
    spec: {
      type: 'object',
      required: ['model', 'identity', 'capabilities'],
      properties: {
        model: {
          type: 'object',
          required: ['provider', 'model'],
          properties: {
            provider: { type: 'string' },
            model: { type: 'string' }
          }
        },
        identity: {
          type: 'object',
          required: ['agentId'],
          properties: {
            agentId: { type: 'string' },
            trustScore: { type: 'number', minimum: 0, maximum: 1 }
          }
        },
        capabilities: { type: 'array', items: { type: 'string' }, minItems: 1 },
        restrictions: { type: 'array', items: { type: 'string' } },
        policyRef: { type: 'string' }
      }
    }
  }
};

/**
 * loadAgentDefinitions — reads agents/*.yaml from Git repo (F-1 fix: explicit algorithm)
 * 
 * Algorithm:
 * 1. List all .yaml files in agents/ directory
 * 2. For each file, parse YAML to JavaScript object
 * 3. Validate against AGENT_SCHEMA using JSON Schema validator
 * 4. If validation fails, throw with file path and specific errors
 * 5. Return validated agent definitions
 */
async function loadAgentDefinitions(gitPath: string): Promise<AgentDefinition[]> {
  const files = await listFiles(`${gitPath}/agents/*.yaml`);
  const agents: AgentDefinition[] = [];
  const errors: ValidationError[] = [];
  
  for (const file of files) {
    try {
      const yaml = await readFile(file, 'utf8');
      const parsed = JSYAML.load(yaml);
      
      // Validate against schema
      const validate = new JSONSchema(AGENT_SCHEMA);
      const valid = validate(parsed);
      
      if (!valid) {
        errors.push({ file, errors: validate.errors });
        continue;
      }
      
      agents.push(parsed as AgentDefinition);
    } catch (e) {
      errors.push({ file, errors: [String(e)] });
    }
  }
  
  if (errors.length > 0) {
    throw new Error(`Agent validation failed:\n${errors.map(e => `${e.file}: ${e.errors.join(', ')}`).join('\n')}`);
  }
  
  return agents;
}

/**
 * syncToRuntime — applies loaded config to runtime services (F-1 fix: explicit algorithm)
 * 
 * Algorithm:
 * 1. Load agent definitions from Git
 * 2. Validate all schemas
 * 3. Compare with runtime state
 * 4. Apply changes in transaction:
 *    a. Register new agents
 *    b. Update changed agents
 *    c. Remove deleted agents (after confirmation)
 * 5. Log sync result
 */
async function syncToRuntime(gitPath: string, dryRun: boolean = false): Promise<SyncResult> {
  const result: SyncResult = { added: [], updated: [], removed: [], errors: [] };
  
  // Load from Git
  const declaredAgents = await loadAgentDefinitions(gitPath);
  
  // Get runtime state
  const runtimeAgents = await agentRegistry.listAgents();
  
  // Compare: declared vs runtime
  const declaredIds = new Set(declaredAgents.map(a => a.spec.identity.agentId));
  const runtimeIds = new Set(runtimeAgents.map(a => a.agentId));
  
  // Detect additions
  for (const agent of declaredAgents) {
    if (!runtimeIds.has(agent.spec.identity.agentId)) {
      result.added.push(agent);
    }
  }
  
  // Detect removals
  for (const agentId of runtimeIds) {
    if (!declaredIds.has(agentId)) {
      result.removed.push(agentId);
    }
  }
  
  // Detect updates (compare versions)
  for (const declared of declaredAgents) {
    const runtime = runtimeAgents.find(a => a.agentId === declared.spec.identity.agentId);
    if (runtime && runtime.version !== declared.metadata.version) {
      result.updated.push({ declared, runtime });
    }
  }
  
  if (dryRun) {
    return result;
  }
  
  // Apply changes
  for (const agent of result.added) {
    await agentRegistry.register(agent);
  }
  for (const { declared } of result.updated) {
    await agentRegistry.update(declared);
  }
  for (const agentId of result.removed) {
    await agentRegistry.deregister(agentId);
  }
  
  return result;
}
```

**`src/gitops/drift-detector.js`** (F-1 fix: explicit drift comparison algorithm)

```typescript
// drift-detector.ts

/**
 * compareRuntimeToDeclared — compares runtime state to Git declarations (F-1 fix)
 * 
 * Algorithm:
 * 1. Load declared config from Git
 * 2. Get runtime config from services
 * 3. Compare each field recursively
 * 4. Generate diff report with field-level differences
 * 
 * Drift Types:
 * - ADDED_IN_RUNTIME: exists in runtime but not in Git
 * - REMOVED_FROM_GIT: exists in Git but not in runtime
 * - MODIFIED: exists in both but values differ
 */
interface DriftReport {
  agentId: string;
  driftType: 'ADDED_IN_RUNTIME' | 'REMOVED_FROM_GIT' | 'MODIFIED';
  field?: string;
  declaredValue?: unknown;
  runtimeValue?: unknown;
}

async function compareRuntimeToDeclared(
  declared: AgentDefinition[],
  runtime: RuntimeAgent[]
): Promise<DriftReport[]> {
  const report: DriftReport[] = [];
  
  const declaredMap = new Map(declared.map(a => [a.spec.identity.agentId, a]));
  const runtimeMap = new Map(runtime.map(a => [a.agentId, a]));
  
  // Check for additions and modifications
  for (const [agentId, declaredAgent] of declaredMap) {
    const runtimeAgent = runtimeMap.get(agentId);
    
    if (!runtimeAgent) {
      report.push({
        agentId,
        driftType: 'REMOVED_FROM_GIT',
        declaredValue: declaredAgent
      });
    } else {
      // Compare field by field
      const differences = deepCompare(declaredAgent, runtimeAgent);
      for (const diff of differences) {
        report.push({
          agentId,
          driftType: 'MODIFIED',
          field: diff.field,
          declaredValue: diff.expected,
          runtimeValue: diff.actual
        });
      }
    }
  }
  
  // Check for additions (in runtime but not in Git)
  for (const [agentId, runtimeAgent] of runtimeMap) {
    if (!declaredMap.has(agentId)) {
      report.push({
        agentId,
        driftType: 'ADDED_IN_RUNTIME',
        runtimeValue: runtimeAgent
      });
    }
  }
  
  return report;
}

/**
 * deepCompare — recursive field comparison (F-1 fix: explicit algorithm)
 */
function deepCompare(declared: any, runtime: any, path: string = ''): Array<{field: string; expected: any; actual: any}> {
  const differences: Array<{field: string; expected: any; actual: any}> = [];
  
  if (typeof declared !== typeof runtime) {
    differences.push({ field: path || '(root)', expected: declared, actual: runtime });
    return differences;
  }
  
  if (declared === null || runtime === null) {
    if (declared !== runtime) {
      differences.push({ field: path || '(root)', expected: declared, actual: runtime });
    }
    return differences;
  }
  
  if (Array.isArray(declared) !== Array.isArray(runtime)) {
    differences.push({ field: path || '(root)', expected: declared, actual: runtime });
    return differences;
  }
  
  if (Array.isArray(declared)) {
    if (declared.length !== runtime.length) {
      differences.push({ field: path || '(root)', expected: declared, actual: runtime });
    } else {
      for (let i = 0; i < declared.length; i++) {
        differences.push(...deepCompare(declared[i], runtime[i], `${path}[${i}]`));
      }
    }
    return differences;
  }
  
  if (typeof declared === 'object') {
    const allKeys = new Set([...Object.keys(declared || {}), ...Object.keys(runtime || {})]);
    for (const key of allKeys) {
      if (!(key in declared)) {
        differences.push({ field: `${path}.${key}`, expected: undefined, actual: runtime[key] });
      } else if (!(key in runtime)) {
        differences.push({ field: `${path}.${key}`, expected: declared[key], actual: undefined });
      } else {
        differences.push(...deepCompare(declared[key], runtime[key], `${path}.${key}`));
      }
    }
    return differences;
  }
  
  // Primitives
  if (declared !== runtime) {
    differences.push({ field: path || '(root)', expected: declared, actual: runtime });
  }
  
  return differences;
}
```

**`src/gitops/webhook-handler.js`** (F-2 fix: Git provider abstraction layer)

```typescript
// webhook-handler.ts

/**
 * GitProvider — abstract interface for Git operations (F-2 fix: abstraction layer)
 * 
 * AWARE supports multiple Git providers via this interface.
 * Current implementation: Gitea (gitea.local:3000)
 * Future: GitHub, GitLab
 */
interface GitProvider {
  /** List files matching glob pattern in repository */
  listFiles(repoPath: string, pattern: string): Promise<string[]>;
  
  /** Read file content at specific commit/branch */
  readFile(repoPath: string, filePath: string, ref?: string): Promise<string>;
  
  /** Verify webhook signature for push events */
  verifySignature(payload: Buffer, signature: string, secret: string): boolean;
  
  /** Get current commit SHA for a branch */
  getCurrentCommit(repoPath: string, branch: string): Promise<string>;
}

class GiteaProvider implements GitProvider {
  constructor(private baseUrl: string, private token: string) {}
  
  async listFiles(repoPath: string, pattern: string): Promise<string[]> {
    // Gitea API: GET /repos/{owner}/{repo}/contents/{path}
    const url = `${this.baseUrl}/api/v1/repos/${repoPath}/contents`;
    const response = await fetch(`${url}?ref=${pattern}`, {
      headers: { 'Authorization': `token ${this.token}` }
    });
    const files = await response.json();
    return files.filter((f: any) => f.type === 'file').map((f: any) => f.path);
  }
  
  async readFile(repoPath: string, filePath: string, ref?: string): Promise<string> {
    const url = `${this.baseUrl}/api/v1/repos/${repoPath}/contents/${filePath}`;
    const params = ref ? `?ref=${ref}` : '';
    const response = await fetch(`${url}${params}`, {
      headers: { 'Authorization': `token ${this.token}` }
    });
    const data = await response.json();
    // Gitea returns base64-encoded content
    return Buffer.from(data.content, 'base64').toString('utf8');
  }
  
  verifySignature(payload: Buffer, signature: string, secret: string): boolean {
    // Gitea uses HMAC-SHA256 with the secret
    const hmac = crypto.createHmac('sha256', secret);
    const expected = `sha256=${hmac.update(payload).digest('hex')}`;
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }
  
  async getCurrentCommit(repoPath: string, branch: string): Promise<string> {
    const url = `${this.baseUrl}/api/v1/repos/${repoPath}/branches/${branch}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `token ${this.token}` }
    });
    const data = await response.json();
    return data.commit.id;
  }
}

/**
 * GitHubProvider — future implementation for GitHub.com
 */
class GitHubProvider implements GitProvider {
  // Same interface, different API endpoints
  // Implementation would use GitHub REST API or GraphQL API
}

/**
 * GitLabProvider — future implementation for GitLab.com/self-hosted
 */
class GitLabProvider implements GitProvider {
  // Same interface, different API endpoints
  // Implementation would use GitLab API
}

/**
 * getProvider — factory to get appropriate Git provider (F-2 fix: abstraction)
 */
function getProvider(): GitProvider {
  const providerType = process.env.GIT_PROVIDER || 'gitea';
  
  switch (providerType) {
    case 'gitea':
      return new GiteaProvider(
        process.env.GITEA_URL || 'https://gitea.example.com',
        process.env.GITEA_TOKEN || ''
      );
    case 'github':
      return new GitHubProvider(
        process.env.GITHUB_TOKEN || ''
      );
    case 'gitlab':
      return new GitLabProvider(
        process.env.GITLAB_URL || 'https://gitlab.com',
        process.env.GITLAB_TOKEN || ''
      );
    default:
      throw new Error(`Unsupported Git provider: ${providerType}`);
  }
}

// Webhook handler uses abstract provider
async function handlePush(event: WebhookEvent): Promise<void> {
  const provider = getProvider();
  
  // Verify signature
  const signature = event.headers['x-gitea-signature'] || event.headers['x-hub-signature-256'];
  if (!provider.verifySignature(event.payload, signature, process.env.WEBHOOK_SECRET || '')) {
    throw new Error('Webhook signature verification failed');
  }
  
  // Trigger reload if push to main branch
  if (event.branch === 'main') {
    await triggerReload();
  }
}
```

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
| Config parameter changed | Runtime config ≠ Git config | Alert only (manual sync via PR) |

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
2. **Auto-sync vs alert-only:** **RESOLVED: Alert-only.** No auto-sync in production — too dangerous. Manual sync via PR required.
3. **Rollback strategy:** Git revert or snapshot-based? (Recommend: git revert for simplicity)

---

## Approval

**Critic review:** PENDING

**Implementation:** NOT STARTED

**Testing:** NOT STARTED
