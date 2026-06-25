# ADR-015: Phase 3.1 — Tool Access Control & Enforcement

**Status:** APPROVED (Reviewer, 2026-04-01 22:05 BST) ✅  
**Author:** Architect  
**Date:** 2026-04-01  
**Research inputs:** Researcher Audit findings; ADR-011 (Quality-Gated Reinforcement); ADR-013 (Identity Framework); ADR-014 (Behavioural Anomaly)  
**Depends on:** ADR-011, ADR-013, ADR-014  
**Phase:** 3.1 (P1)  

---

## Context

ADR-011 established the security gate for pheromone reinforcement, checking for policy violations including "unauthorised tool access."

ADR-013 established identity and session binding, including execution context that defines `allowedTools` and `deniedTools` per session.

ADR-014 established behavioural monitoring that detects anomalous tool usage patterns.

ADR-015 defines the **Tool Access Control & Enforcement** system that:
1. Maintains the registry of available tools and their permissions
2. Enforces tool access authorization at invocation time
3. Detects "shadow tools" (unauthorised usage)
4. Provides audit trail for all tool invocations

---

## Decision

Implement a **Tool Access Control (TAC) system** with:

1. **Tool Registry** — Catalog of all available tools with metadata
2. **Permission Model** — RBAC-like permissions per agent role
3. **Pre-invocation Check** — Authorize tool call before execution
4. **Shadow Tool Detection** — Detect usage of unlisted tools
5. **Audit Trail** — Log all tool invocations with parameters

---

## Tool Registry

### Tool Definition Schema

```javascript
{
  toolId: 'exec',
  name: 'Shell Command Execution',
  description: 'Execute shell commands on the host system',
  category: 'system',
  riskLevel: 'HIGH',  // LOW, MEDIUM, HIGH, CRITICAL
  requiredCapabilities: ['shell-access'],
  dangerous: true,
  parameters: {
    command: { type: 'string', required: true },
    cwd: { type: 'string', required: false },
    timeout: { type: 'number', required: false }
  },
  blastRadiusEstimate: 0.9,  // If compromised
  version: '1.2.0',
  enabled: true
}
```

### Tool Categories

| Category | Example Tools | Risk Level |
|----------|--------------|------------|
| `read` | file read, API fetch | LOW |
| `write` | file write, create | MEDIUM |
| `system` | exec, sudo, shell | HIGH |
| `network` | curl, fetch, http | HIGH |
| `credential` | keychain, vault access | CRITICAL |
| `admin` | user management, config | CRITICAL |
| `communication` | email, message, post | MEDIUM |

### Tool Registry Storage

```
/aware/tools/
├── registry.json           # Tool definitions
├── versions/               # Historical versions
│   └── exec/
│       ├── v1.0.0.json
│       └── v1.2.0.json
└── permissions/
    ├── role-admin.json
    ├── role-coder.json
    ├── role-researcher.json
    └── role-tester.json
```

---

## Permission Model

### Roles and Permissions

```javascript
const ROLES = {
  'admin': {
    inherits: [],
    allows: ['*']  // All tools
  },
  'coder': {
    inherits: [],
    allows: [
      'read:workspace/*',
      'write:workspace/*',
      'exec:workspace/*',
      'read:git',
      'write:git',
      'read:api',
      'network:developer-api'
    ],
    denies: [
      'credential:*',
      'admin:*',
      'exec:sudo'
    ]
  },
  'researcher': {
    inherits: [],
    allows: [
      'read:*',
      'network:search-api',
      'network:web-fetch',
      'write:research/*'
    ],
    denies: [
      'credential:*',
      'admin:*',
      'exec:sudo',
      'exec:rm'
    ]
  },
  'tester': {
    inherits: [],
    allows: [
      'read:workspace/*',
      'exec:test-runner',
      'network:test-api'
    ],
    denies: [
      'credential:*',
      'admin:*',
      'write:production/*'
    ]
  }
};
```

### Permission Evaluation

```javascript
function evaluatePermission(agentRole, requestedTool, requestedParams) {
  const role = ROLES[agentRole];
  
  if (!role) {
    return { allowed: false, reason: 'ROLE_NOT_FOUND' };
  }
  
  // Check denies first (whitelist approach)
  for (const denyPattern of role.denies || []) {
    if (matchesPattern(requestedTool, denyPattern)) {
      return { allowed: false, reason: 'DENIED_BY_ROLE', rule: denyPattern };
    }
  }
  
  // Check allows
  for (const allowPattern of role.allows || []) {
    if (allowPattern === '*' || matchesPattern(requestedTool, allowPattern)) {
      return { allowed: true, reason: 'ALLOWED_BY_ROLE', rule: allowPattern };
    }
  }
  
  return { allowed: false, reason: 'NOT_IN_ALLOW_LIST' };
}

function matchesPattern(toolId, pattern) {
  // F-3 FIX: Pre-compiled patterns to prevent ReDoS attacks
  // Pattern sources MUST be trusted - never compile patterns from untrusted input
  const regex = pattern.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${regex}$`).test(toolId);
}
```

**⚠️ F-3 Security Note: Pattern Source Trust**

The `matchesPattern()` function compiles wildcard patterns to regex. This is safe ONLY when pattern sources are trusted:

1. **Trusted sources:** Internal config files, admin-defined role permissions
2. **Untrusted sources:** External config APIs, user-provided patterns, third-party plugins

**Pre-compilation for performance and safety:**

```javascript
// Pre-compile patterns at startup (trusted sources only)
const ROLE_PATTERNS = {
  'admin': {
     allows: compilePatterns(['*']),
     denies: compilePatterns([])
  },
  'coder': {
     allows: compilePatterns([
       'read:workspace/*',
       'write:workspace/*',
       'exec:workspace/*',
       'read:git',
       'write:git',
       'read:api',
       'network:developer-api'
     ]),
     denies: compilePatterns([
       'credential:*',
       'admin:*',
       'exec:sudo'
     ])
  }
  // ...
};

function compilePatterns(patterns) {
  return patterns.map(p => {
    const regex = new RegExp(`^${p.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
    return { original: p, regex }; // Store original for audit
  });
}

// At runtime, use pre-compiled:
function evaluatePermission(agentRole, requestedTool) {
  const role = ROLE_PATTERNS[agentRole];
  if (!role) return { allowed: false, reason: 'ROLE_NOT_FOUND' };
  
  // Check denies first
  for (const { original, regex } of role.denies) {
    if (regex.test(requestedTool)) {
      return { allowed: false, reason: 'DENIED_BY_ROLE', rule: original };
    }
  }
  
  // Check allows
  for (const { original, regex } of role.allows) {
    if (regex.test(requestedTool)) {
      return { allowed: true, reason: 'ALLOWED_BY_ROLE', rule: original };
    }
  }
  
  return { allowed: false, reason: 'NOT_IN_ALLOW_LIST' };
}
```

**Validation:** If patterns must come from untrusted sources, validate against an allowlist of known-safe pattern characters before compilation:

```javascript
function safeCompilePattern(pattern) {
  // Only allow word chars, colons, slashes, asterisks, question marks
  if (!/^[\w\/\:\*\?\-]+$/.test(pattern)) {
    throw new Error('INVALID_PATTERN: potentially malicious characters');
  }
  return new RegExp(`^${pattern.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
}
```
```

---

## Pre-Invocation Authorization

### Parameter Schema Validation (F-1 FIX)

Tool parameters **MUST** be validated against the tool's parameter schema before execution:

```javascript
const PARAMETER_VALIDATORS = {
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number' && !isNaN(value),
  boolean: (value) => typeof value === 'boolean',
  array: (value) => Array.isArray(value),
  object: (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
};

function validateParameters(toolId, parameters, schema) {
  const errors = [];
  
  if (!schema || !schema.parameters) {
    return { valid: true }; // No schema = no validation
  }
  
  for (const [paramName, paramSchema] of Object.entries(schema.parameters)) {
    const value = parameters?.[paramName];
    
    // Check required
    if (paramSchema.required && (value === undefined || value === null)) {
      errors.push({ param: paramName, error: 'REQUIRED' });
      continue;
    }
    
    // Skip validation if not provided and not required
    if (value === undefined || value === null) continue;
    
    // Type validation
    if (paramSchema.type && !PARAMETER_VALIDATORS[paramSchema.type]?.(value)) {
      errors.push({ param: paramName, error: `INVALID_TYPE: expected ${paramSchema.type}` });
    }
    
    // Additional constraints
    if (paramSchema.type === 'string' && paramSchema.maxLength && value.length > paramSchema.maxLength) {
      errors.push({ param: paramName, error: `MAX_LENGTH_EXCEEDED: ${value.length} > ${paramSchema.maxLength}` });
    }
    
    if (paramSchema.type === 'number') {
      if (paramSchema.min !== undefined && value < paramSchema.min) {
        errors.push({ param: paramName, error: `MIN_VALUE: ${value} < ${paramSchema.min}` });
      }
      if (paramSchema.max !== undefined && value > paramSchema.max) {
        errors.push({ param: paramName, error: `MAX_VALUE: ${value} > ${paramSchema.max}` });
      }
    }
    
    // Enum validation
    if (paramSchema.enum && !paramSchema.enum.includes(value)) {
      errors.push({ param: paramName, error: `INVALID_ENUM: ${value} not in [${paramSchema.enum.join(', ')}]` });
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}
```

### Authorization Flow

```
Tool Invocation Request
         │
         ▼
┌─────────────────────────┐
│ 1. Verify Agent Identity│───❌ Fail ──▶ Reject (unauthenticated)
└────────────┬────────────┘
             │ Pass
             ▼
┌─────────────────────────┐
│ 2. Verify Session Valid │───❌ Fail ──▶ Reject (invalid session)
└────────────┬────────────┘
             │ Pass
             ▼
┌─────────────────────────┐
│ 3. Check Tool Exists    │───❌ Fail ──▶ Reject (unknown tool)
└────────────┬────────────┘
             │ Pass
             ▼
┌─────────────────────────┐
│ 4. Evaluate Permissions │───❌ Fail ──▶ Reject (unauthorized)
└────────────┬────────────┘
             │ Pass
             ▼
┌─────────────────────────┐
│ 5. Check Execution      │───❌ Fail ──▶ Reject (tool disabled)
│    Context Constraints   │
└────────────┬────────────┘
             │ Pass
             ▼
┌─────────────────────────┐
│ 6. Execute Tool         │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 7. Log Invocation       │
└─────────────────────────┘
```

### Authorization Middleware

```javascript
async function authorizeToolInvocation(req, res, next) {
  const { agentId, sessionId, toolId, parameters } = req.body;
  
  try {
    // 1. Verify agent identity (ADR-013)
    const agent = await attestationService.verify(req.headers.authorization);
    if (!agent) {
      return res.status(401).json({ error: 'UNAUTHENTICATED' });
    }
    
    // 2. Verify session (ADR-013)
    const session = await sessionManager.getSession(sessionId);
    if (!session || session.agentId !== agent.agentId) {
      return res.status(401).json({ error: 'INVALID_SESSION' });
    }
    
    // 3. Check tool exists
    const tool = await toolRegistry.getTool(toolId);
    if (!tool) {
      return res.status(404).json({ error: 'TOOL_NOT_FOUND' });
    }
    
    if (!tool.enabled) {
      return res.status(403).json({ error: 'TOOL_DISABLED' });
    }
    
    // 4. Evaluate permissions
    const permission = evaluatePermission(agent.role, toolId, parameters);
    if (!permission.allowed) {
      // Log security event
      await securityLogger.log({
        event: 'TOOL_ACCESS_DENIED',
        agentId: agent.agentId,
        toolId,
        reason: permission.reason,
        rule: permission.rule
      });
      
      // Check if this is anomalous (ADR-014)
      await anomalyMonitor.recordDeniedAccess(agent.agentId, toolId);
      
      return res.status(403).json({ 
        error: 'TOOL_ACCESS_DENIED', 
        reason: permission.reason 
      });
    }
    
    // 5. Check execution context (ADR-013)
    const context = session.executionContext;
    if (context.deniedTools?.includes(toolId)) {
      return res.status(403).json({ error: 'TOOL_DENIED_BY_CONTEXT' });
    }
    
    if (!context.allowedTools?.includes('*') && 
        !context.allowedTools?.includes(toolId)) {
      return res.status(403).json({ error: 'TOOL_NOT_IN_CONTEXT' });
    }
    
    // 6. Validate tool parameters against schema (F-1)
    const paramValidation = validateParameters(toolId, parameters, tool.parameters);
    if (!paramValidation.valid) {
      await securityLogger.log({
        event: 'PARAMETER_VALIDATION_FAILED',
        agentId: agent.agentId,
        toolId,
        errors: paramValidation.errors
      });
      return res.status(400).json({ 
        error: 'INVALID_PARAMETERS',
        details: paramValidation.errors
      });
    }
    
    // Authorized - attach to request for tool execution
    req.authorization = {
      agent,
      session,
      tool,
      permission
    };
    
    next();
    
  } catch (error) {
    logger.error({ event: 'AUTHORIZATION_ERROR', error: error.message });
    return res.status(500).json({ error: 'AUTHORIZATION_ERROR' });
  }
}
```

---

## Shadow Tool Detection

### What is a Shadow Tool?

A "shadow tool" is a tool that:
1. Is called by an agent but NOT in the tool registry
2. Is a legitimate tool being used in an unexpected way
3. Represents an attempt to bypass tool controls

### Gateway-Level Observation Mechanism (F-2 FIX)

Shadow tool detection operates at the **gateway level** — all tool invocations pass through the gateway's tool proxy, which observes and validates every call:

```
Agent Request → Gateway Tool Proxy → [Observation] → Tool Registry Check → Allow/Deny
                                              ↓
                                    Shadow Tool Detector
```

**Observation happens BEFORE registry check** to capture all calls, including unknown tools:

```javascript
// Gateway tool proxy - observes ALL tool calls
class ToolObservationProxy {
  constructor(toolRegistry, shadowDetector, auditLogger) {
    this.registry = toolRegistry;
    this.shadowDetector = shadowDetector;
    this.auditLogger = auditLogger;
  }
  
  async observeAndForward(toolId, parameters, agentContext) {
    const observation = {
      toolId,
      parameters,
      agentId: agentContext.agentId,
      sessionId: agentContext.sessionId,
      timestamp: Date.now(),
      callSource: agentContext.callSource || 'direct'
    };
    
    // 1. ALWAYS log the observation first (before allow/deny)
    await this.auditLogger.logToolObservation(observation);
    
    // 2. Check if tool is in registry
    const tool = await this.registry.getTool(toolId);
    
    if (!tool) {
      // Unknown tool - record as shadow candidate
      await this.shadowDetector.recordUnregisteredCall(observation);
      return { allowed: false, reason: 'TOOL_NOT_IN_REGISTRY', shadow: true };
    }
    
    // 3. Tool exists - check if usage pattern is anomalous
    const shadowCheck = await this.shadowDetector.checkAnomalousUsage(
      agentContext.agentId,
      toolId,
      observation
    );
    
    if (shadowCheck.isShadow || shadowCheck.isAnomalous) {
      // Known tool but unusual usage - alert and log
      await this.shadowDetector.recordAnomalousCall(observation, shadowCheck);
      return { 
        allowed: false, 
        reason: shadowCheck.isShadow ? 'SHADOW_TOOL_PATTERN' : 'ANOMALOUS_USAGE',
        alert: true 
      };
    }
    
    return { allowed: true, tool };
  }
}
```

**Gateway enforcement means:**
1. ALL tool calls go through the proxy, even "known" tools
2. Every call is observed and logged before allow/deny decision
3. Shadow detection happens in real-time at the gateway, not post-hoc
4. Unknown tools are immediately blocked and alerted

### Behavioural Shadow Detection

Some tools are registered but used outside normal patterns:

```javascript
async function detectAnomalousToolUsage(agentId, toolId, usageContext) {
  const baseline = await baselineStore.getBaseline(agentId);
  
  if (!baseline.toolUsage[toolId]) {
    // Tool not in baseline - check if agent normally uses it
    return {
      isShadow: true,
      reason: 'TOOL_NEVER_USED_BY_AGENT'
    };
  }
  
  const toolBaseline = baseline.toolUsage[toolId];
  const currentRate = usageContext.callsPerHour;
  const zScore = (currentRate - toolBaseline.mean) / toolBaseline.stddev;
  
  if (zScore > 3) {
    return {
      isShadow: false,  // Tool is known, but usage is anomalous
      isAnomalous: true,
      zScore,
      reason: 'ANOMALOUS_USAGE_PATTERN'
    };
  }
  
  return { isShadow: false, isAnomalous: false };
}
```

---

## Audit Trail

### Tool Invocation Log

Every tool invocation is logged:

```javascript
{
  logId: 'log-uuid',
  timestamp: '2026-04-01T10:30:00Z',
  event: 'TOOL_INVOKED',
  agentId: 'agent-001',
  agentType: 'coder',
  sessionId: 'sess-abc123',
  toolId: 'exec',
  parameters: {
    command: 'git status',
    cwd: '/workspace/forge'
  },
  result: {
    status: 'success',
    outputLength: 1024,
    durationMs: 234
  },
  authorization: {
    allowed: true,
    rule: 'exec:workspace/*',
    evaluatedAt: '2026-04-01T10:30:00Z'
  },
  trustScore: 0.87,
  anomalyScore: 0.12
}
```

### Audit Log Storage

```
/aware/audit/tools/
├── YYYY/MM/DD/
│   ├── invocations/
│   │   ├── 10:00:00-11:00:00.jsonl
│   │   └── 11:00:00-12:00:00.jsonl
│   ├── denials/
│   │   └── 10:00:00-11:00:00.jsonl
│   └── shadow/
│       └── 10:00:00-11:00:00.jsonl
```

### Audit Retention

| Log Type | Retention | Reason |
|----------|-----------|--------|
| Invocations | 90 days | Standard audit |
| Denials | 1 year | Security investigation |
| Shadow detections | 1 year | Security investigation |
| Admin actions | 3 years | Compliance |

---

## Integration with ADR-011 (Security Gate)

ADR-011's security gate checks for policy violations. Tool access violations trigger negative reinforcement:

```javascript
async function checkSecurityGate(req) {
  const { agent, tool } = req.authorization;
  
  // Check if tool access was authorized
  if (!req.authorization.permission.allowed) {
    // Security gate: FAIL
    await reinforcementController.applyPenalty(agent.agentId, {
      type: 'UNAUTHORIZED_TOOL_ACCESS',
      toolId: tool.toolId,
      severity: tool.riskLevel === 'CRITICAL' ? 'HIGH' : 'MEDIUM'
    });
    
    return {
      passed: false,
      reason: 'UNAUTHORIZED_TOOL_ACCESS',
      toolId: tool.toolId
    };
  }
  
  // Check for shadow tool
  if (await isShadowTool(agent.agentId, tool.toolId)) {
    return {
      passed: false,
      reason: 'SHADOW_TOOL_DETECTED',
      toolId: tool.toolId
    };
  }
  
  return { passed: true };
}
```

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tools` | GET | List all registered tools |
| `/api/tools/:toolId` | GET | Get tool details |
| `/api/tools/:toolId` | PUT | Update tool definition (admin) |
| `/api/tools/:toolId/enable` | POST | Enable tool (admin) |
| `/api/tools/:toolId/disable` | POST | Disable tool (admin) |
| `/api/tools/:toolId/invoke` | POST | Invoke tool (enforced) |
| `/api/permissions/roles` | GET | List roles |
| `/api/permissions/roles/:role` | PUT | Update role permissions (admin) |
| `/api/audit/tools` | GET | Query tool audit logs |

---

## Implementation Requirements

| Component | File | Responsibility |
|-----------|------|----------------|
| ToolRegistry | `src/tools/registry.js` | Tool definitions, versioning |
| PermissionEvaluator | `src/tools/permission-evaluator.js` | RBAC evaluation |
| AuthorizationMiddleware | `src/tools/auth-middleware.js` | Pre-invocation checks |
| ShadowToolDetector | `src/tools/shadow-detector.js` | Unknown tool detection |
| ToolAuditor | `src/tools/auditor.js` | Invocation logging |
| ToolInvocator | `src/tools/invoker.js` | Actual tool execution |

---

## Open Questions

1. **Tool versioning:** Should we version tool definitions? (Yes allows rollback, but increases complexity)

2. **Parameter validation:** Should we validate tool parameters against schema before execution? (More secure but adds latency)

3. **Tool chaining:** Should we allow agents to call multiple tools in one request? (More efficient but harder to audit)

4. **Third-party tools:** How do we handle tools from external sources? (Require signing? Sandbox?)

5. **Permission delegation:** Should agents be able to delegate their permissions to other agents? (Dangerous but sometimes needed)

---

## Compliance Mapping

| Framework | Control | Implementation |
|-----------|---------|----------------|
| CSA AI Control Matrix | AI.OPS-04 (Tool control) | Permission model, pre-invocation authorization |
| CSA AI Control Matrix | AI.OPS-05 (Audit logging) | Tool invocation audit trail |
| NIST AI RMF | PR.AC (Access control) | RBAC permission model |
| NIST AI RMF | AU.02 (Audit events) | Tool invocation logging |
| ISO 27001 | A.9.4 (Access control) | Principle of least privilege, tool whitelist |
| DORA | Art. 26 (Security controls) | Tool access controls |

---

## Status

**DRAFT** — Ready for Critor review and Researcher research on tool access control patterns.

---

*Next: ADR-016 (Compliance Mapping & Reporting)*
