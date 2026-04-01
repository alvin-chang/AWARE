# AWARE Phase 3 — Identity & Compliance Research
## ADR-014 (Identity Attestation) & ADR-015-017 (Tool Access, Compliance, Kill Switch)

**Researcher:** Scout  
**Date:** 2026-04-01  
**Status:** P0 Research COMPLETE — P1 In Progress

---

## P0-1: Identity Attestation Standards

### Overview

Identity attestation for AI agents is the process of verifying that an agent is who it claims to be, has not been tampered with, and is operating within expected parameters. Three main frameworks are relevant:

| Standard | Description | Relevance to AWARE |
|---------|-------------|-------------------|
| **SPIFFE** | Secure Production Identity Framework for Everyone | **HIGH** — designed for workload identity |
| **NIST CAISI** | NIST AI Agent Standards Initiative | **HIGH** — active 2026 standardisation |
| **NIST NFI** | National Cybersecurity Framework | **MEDIUM** — foundational identity principles |
| **W3C DID** | Decentralized Identifiers | **MEDIUM** — self-sovereign identity |
| **OIDC** | OpenID Connect | **MEDIUM** — human-facing, adapted for agents |

---

### SPIFFE (Secure Production Identity Framework for Everyone)

**Origin:** Originally from Google, Square, and HashiCorp (now CNCF)  
**Core Concept:** SPIFFE IDs are tied to workloads, not people — making them **ideal for AI agents**

**Key Components:**
1. **SPIFFE ID** — A URI that uniquely identifies a workload: `spiffe://example.org/my-agent`
2. **SVID (SPIFFE Verifiable Identity Document)** — A document that carries the SPIFFE ID, typically an X.509 certificate or JWT
3. **SPIRE** — The SPIFFE Runtime Environment: an open-source implementation for automated certificate management

**Why SPIFFE for AI Agents:**
- Designed specifically for non-human entities
- No reliance on human identity (IPs, certificates tied to machines)
- Automated rotation and renewal via attestation
- Already adopted by HashiCorp, Google, Azure, AWS for workload identity

**HashiCorp Blog (Nov 2025):** *"SPIFFE IDs are tied to workloads, not people. This makes them ideal for AI agents, robotic systems, and other non-human entities."*

**For AWARE:**
- SPIFFE could provide agent identity at the infrastructure level
- SPIRE could handle certificate lifecycle (rotation, revocation)
- SVIDs could be embedded in agent JWT tokens as proof of identity
- **Gap:** SPIFFE doesn't address agent *behavioural* attestation — only identity

---

### NIST AI Agent Standards Initiative (CAISI)

**Announced:** February 2026  
**URL:** https://www.nist.gov/caisi/ai-agent-standards-initiative

**Strategic Pillars:**
1. **Industry-led Standards** — NIST hosts technical convenings, gap analyses, voluntary guidelines
2. **Community-led Protocols** — NSF invests in open-source agent protocol ecosystems
3. **Research** — NIST conducts fundamental research on agent authentication and identity infrastructure

**Current Activities:**
- **RFI on AI Agent Security** (deadline: March 9, 2026) — seeking ecosystem input on threats/mitigations
- **NCCOE Project: "Software and AI Agent Identity and Authorization"** — applying identity standards to enterprise agent use cases (comment deadline: April 2, 2026)
- **Listening Sessions** on barriers to AI adoption in healthcare, finance, education

**Relevance to AWARE:**
- Active standardisation work happening NOW (2026)
- AWARE should align with emerging NIST guidelines
- NCCOE project specifically addresses enterprise agent identity — highly aligned

---

### NIST National Cybersecurity Framework (NFI)

**Purpose:** Foundational identity and access management principles  
**Relevance:** Provides baseline identity controls applicable to AI agents

**Key Principles:**
- Identity verification (know your agent)
- Access control (least privilege)
- Audit and accountability

**Limitation:** Generic framework — not AI-agent-specific

---

### W3C DID (Decentralized Identifiers)

**Purpose:** Self-sovereign identity — entities control their own identifiers  
**Relevance:** Could support autonomous agent identity without central authority

**How it works:**
- DIDs are URIs that resolve to DID Documents containing public keys
- No central registry required
- Agent could generate and control its own identity

**For AWARE:**
- Interesting for truly autonomous agents
- **Gap:** No infrastructure support (no DID resolver in typical enterprise)
- **Gap:** No behavioural attestation

---

### OIDC (OpenID Connect)

**Purpose:** Identity layer on top of OAuth 2.0  
**Current Use:** Human-facing authentication

**Agent Adaptation:**
- Agents could use client credentials flow to obtain tokens
- Token contains claims about agent identity and capabilities
- **Limitation:** Designed for human users, not autonomous agents

---

### Recommended Approach for AWARE

**Phase 1 (Immediate): SPIFFE-aligned identity**
1. Use SPIFFE IDs as the canonical agent identifier format: `spiffe://aware.local/agent/{agentId}`
2. Embed SPIFFE ID in JWT tokens as the `sub` claim
3. Use SPIRE-compatible attestation at deployment time
4. Extend with AWARE-specific claims (role, permissions, trust level)

**Phase 2 (Aligned with NIST):**
1. Monitor NCCOE project outputs (concept paper comments close April 2, 2026)
2. Align with emerging NIST CAISI guidelines
3. Consider NCCOE project participation or feedback

**Why SPIFFE first:**
- Already industry-standard for workload identity
- HashiCorp, Google, AWS, Azure all support it
- CNCF graduate — stable and widely adopted
- Natural fit for non-human identity

**Why not just NIST NFI:**
- NFI is a framework, not an implementation standard
- Too generic for AI agent-specific identity needs
- Good as a guiding principles document, not sufficient alone

---

## P0-2: Behavioural Anomaly Detection Methodologies

### Overview

Behavioural anomaly detection for AI agents identifies when an agent's actions deviate from expected patterns. This is critical for:
- Detecting compromised agents
- Identifying goal drift
- Spotting prompt injection attacks
- Catching malfunctioning agents

---

### Detection Methodologies

| Method | Description | Pros | Cons |
|--------|-------------|------|------|
| **Statistical Baselines** | Establish normal distribution of actions, flag deviations | Simple, explainable | Requires historical data, sensitive to distribution shift |
| **ML-Based Profiling** | Train models on normal behaviour patterns | Can detect complex patterns | Requires training data, interpretability challenges |
| **Rule-Based Monitoring** | Define explicit rules (e.g., no file deletions in /prod) | Precise, predictable | Cannot detect novel attacks |
| **Output Validation** | Sanity-check agent outputs against expected format/range | Catches hallucination/drift | Cannot detect subtle goal changes |
| **Chain-of-Thought Auditing** | Log and review reasoning chains | Detects reasoning drift | High volume, requires human review |
| **Tool Call Patterns** | Monitor API call frequency, sequence, parameters | Good for tool misuse | Requires baseline of normal usage |
| **Cross-Agent Verification** | Multiple agents verify each other's outputs | High integrity | Consensus overhead, latency |

---

### Industry Approaches

**Microsoft AI Agent Service:**
- Monitors agent execution traces
- Detects deviation from defined skill boundaries
- Real-time alerting on anomalous tool usage

**Okta Agent Gateway:**
- Policy-based access control
- Agent identity verification at every tool call
- Audit logging of all agent actions

**Microsoft AutoGen / langchain:**
- Built-in conversation flow monitoring
- Token usage anomaly detection (sudden spikes)
- Human-in-the-loop checkpoints for high-risk actions

**Google Vertex AI Agent Builder:**
- Runtime monitoring with Cloud Logging integration
- Custom metrics for agent-specific KPIs
- Anomaly detection on response quality scores

---

### Key Signals for Anomaly Detection

**Input Signals:**
- Unusual instruction patterns (prompt injection attempts)
- Unexpected input lengths or types
- Rare instruction combinations

**Output Signals:**
- Response format deviations
- Confidence level inconsistencies
- Hallucinated information
- Goal misalignment (off-topic responses)

**Behavioural Signals:**
- Tool call frequency anomalies
- API call sequences deviating from norms
- Memory access patterns
- Task completion rate changes
- Session duration anomalies

**System Signals:**
- CPU/memory usage spikes
- Network traffic anomalies
- Authentication failures
- Token consumption rate

---

### Recommended Approach for AWARE

**Layer 1: Baseline Statistical Monitoring**
1. Track agent action frequency distributions
2. Alert on >2σ deviations from mean
3. Monitor tool call sequences for unusual patterns

**Layer 2: Rule-Based Guardrails**
1. Define explicit boundaries (no production writes without approval)
2. Rate-limit dangerous operations
3. Require human approval for high-risk actions

**Layer 3: ML-Based Anomaly Detection (Future)**
1. Train on historical agent behaviour data
2. Detect subtle goal drift patterns
3. Adaptive thresholds based on agent role

**Layer 4: Cross-Agent Verification**
1. Critical decisions verified by peer agents
2. Consensus required for high-stakes actions
3. Distributed audit trail

---

## P1 Research (ADR-015-017) — COMPLETE

### P1-1: Tool Access Control Patterns

**Key Frameworks:**

| Pattern | Description | Best For | Limitations |
|---------|-------------|----------|-------------|
| **RBAC** | Role-Based Access Control | Static permission sets | Can't handle context; role explosion |
| **ABAC** | Attribute-Based Access Control | Dynamic, fine-grained decisions | Complexity in policy management |
| **PBAC** | Policy-Based Access Control | Expressive, rule-based | Requires policy engine |
| **Zero Trust** | Never trust, always verify | High-security environments | Higher latency |

**Industry Patterns for AI Agents:**

1. **Microsoft AutoGen / LangChain:**
   - Tool permission scopes (read-only, write, admin)
   - Capability-based access (not role-based)
   - Human-in-the-loop for high-risk operations

2. **Okta Agent Gateway:**
   - OAuth 2.0 client credentials for agent authentication
   - Scopes define what tools an agent can call
   - Policy enforcement at the gateway level

3. **Google Vertex AI:**
   - Service account-based authentication
   - IAM roles for agent capabilities
   - Audit logging of all tool calls

**AWARE Recommendations:**

1. **Hybrid RBAC + ABAC:**
   - RBAC for base permissions (agent role → base tool set)
   - ABAC for context-sensitive overrides (time, data sensitivity, user context)

2. **Tool Permission Levels:**
   ```
   Level 0: Read-only (no state changes)
   Level 1: Standard ops (local state, no external calls)
   Level 2: Elevated (external API calls, file writes)
   Level 3: Admin (production writes, user data access)
   Level 4: Critical (system config, key management)
   ```

3. **Key Principles:**
   - Least privilege: Start at Level 0, elevate as needed
   - Separate tool identity from human identity
   - Audit all tool access (who, what, when, result)

---

### P1-2: Compliance Framework Mapping

**Applicable Frameworks:**

| Framework | Relevance to AWARE | Key Controls |
|-----------|-------------------|--------------|
| **SOC 2 Type II** | HIGH — enterprise customers demand it | Security, availability, confidentiality |
| **ISO 27001** | HIGH — international standard | Annex A controls for IAM, audit |
| **GDPR** | HIGH if EU customers | Data processing, consent, breach notification |
| **EU AI Act** | HIGH (2026+) | High-risk AI systems, transparency |
| **NIST CSF** | MEDIUM — US federal alignment | Identity, access, audit |
| **ISO 42001** | MEDIUM — AI MS spec | AI governance, lifecycle management |

**SOC 2 Trust Services Criteria Mapping:**

| TSC | AI Agent Control | AWARE Implementation |
|-----|-----------------|---------------------|
| **CC6.1** | Logical access controls | Agent authentication, tool permissions |
| **CC6.6** | Security for confidential info | Agent data handling, encryption |
| **CC7.2** | System monitoring | Agent behaviour anomaly detection |
| **CC7.4** | Incident management | Agent kill switch, revocation |
| **CC8.1** | Change management | Agent version control, rollback |
| **CC9.2** | Vendor risk management | Third-party tool integration controls |

**ISO 27001 Annex A Mapping:**

| Control | AI Agent Requirement |
|---------|-------------------|
| A.9.2 (User access management) | Agent identity lifecycle |
| A.9.4 (System access control) | Tool permissions, least privilege |
| A.12.4 (Logging) | Full audit trail of agent actions |
| A.18.1 (Compliance) | SOC 2, GDPR compliance evidence |

**GDPR Considerations:**
- **Art. 5:** Data minimization — agents should only access data needed
- **Art. 25:** Privacy by design — kill switch, data deletion capabilities
- **Art. 33:** Breach notification — agent compromise must be reported within 72h
- **Art. 35:** DPIA — data protection impact assessment for agent systems

**EU AI Act (2026+):**
- High-risk AI systems require:
  - Risk management system
  - Data governance
  - Technical documentation
  - Transparency obligations
  - Human oversight measures
  - Accuracy, robustness, cybersecurity

**AWARE Compliance Recommendations:**
1. **Immediate:** Implement SOC 2 controls (CC6, CC7, CC8, CC9)
2. **6 months:** ISO 27001 certification prep
3. **12 months:** EU AI Act compliance for high-risk classification

---

### P1-3: Kill Switch Propagation

**From Phase 1.4 Findings (Scout Audit):**

The Phase 1.4 audit identified critical gaps in AWARE's kill switch mechanism:
- C-01: No Raft log entry type for agent revocation
- C-02: Revocation not committed through Raft consensus
- C-03: Leader election has no revocation awareness

**Propagation Patterns:**

| Pattern | Description | Pros | Cons |
|---------|-------------|------|------|
| **Broadcast** | Leader broadcasts to all nodes | Fast, simple | No fault tolerance |
| **Chain** | Leader → follower → follower | Fault tolerant | Latency proportional to chain |
| **Gossip** | Randomized peer-to-peer spread | Highly fault tolerant | eventual consistency |
| **Consensus-based** | Raft/Paxos for agreement | Strong consistency | Slower, requires quorum |

**Industry Approaches:**

1. **SPIFFE/SPIRE Revocation:**
   - X.509 certificate revocation via CRL or OCSP
   - Short-lived SVIDs reduce revocation window
   - SPIRE agent polls for revocation updates

2. **Kubernetes RBAC:**
   - Immediate propagation via API server
   - Watch-based notification to all kubelets
   - No distributed consensus needed (centralized API)

3. **HashiCorp Vault:**
   - Token revocation via lease expiry
   - Batch token revocation for emergencies
   - Eventual consistency via gossip (Consul backend)

**AWARE Recommended Approach:**

Based on Phase 1.4 findings, AWARE needs:

1. **Raft-based Revocation Entry:**
   - New `RevocationEntry` type in Raft log
   - Leader appends revocation, followers apply on commit
   - Majority quorum required for revocation

2. **Propagation Protocol:**
   ```
   1. Leader receives revocation request
   2. Leader appends RevocationEntry to Raft log
   3. Followers replicate entry
   4. Majority commits entry
   5. Leader broadcasts ApplyRevocation to all nodes
   6. Local agent registry updates state to REVOKED
   7. Agent's JWT cache invalidated
   ```

3. **Timeout & Retry:**
   - Heartbeat timeout: 150-300ms (existing)
   - Revocation broadcast timeout: 5 seconds
   - Retry with exponential backoff (max 3 retries)
   - After max retries: local kill + alert

4. **Failure Modes:**
   - **Leader failure during revocation:** New leader continues protocol
   - **Network partition:** Partitioned nodes cannot revoke (safety)
   - **Follower failure:** Leader retries when follower recovers
   - **Revocation during election:** Vote suspension until revocation commits

**Key Finding from Phase 1.4:**
The current kill switch mechanism is insufficient for distributed systems. AWARE needs:
- Dedicated revocation entry type in Raft log
- Heartbeat protocol extension to carry revocation payloads
- Distributed revocation state tracking
- Task reassignment coordination

---

## Key References

1. SPIFFE: https://spiffe.io/
2. HashiCorp Blog (Nov 2025): "SPIFFE: Securing the identity of agentic AI and non-human actors"
3. NIST CAISI: https://www.nist.gov/caisi/ai-agent-standards-initiative
4. NIST NCCOE Identity Project: https://www.nccoe.nist.gov/projects/software-and-ai-agent-identity-and-authorization
5. NIST RFI on AI Agent Security: https://www.nist.gov/news-events/news/2026/01/caisi-issues-request-information-about-securing-ai-agent-systems

---

## Next Steps

1. **Archimedes:** Use P0 research for ADR-014 (Identity Attestation)
2. **Scout:** Continue P1 research for ADR-015-017
3. **Consider:** Submit feedback to NIST NCCOE project (comment deadline April 2, 2026)
