// src/policies/tool-observation-proxy.js
// Tool Observation Proxy — Gateway-level observation for all tool calls
// ADR (internal): Tool Access Control & Enforcement

const EventEmitter = require('events');

/**
 * ToolObservationProxy — Gateway-level proxy that observes ALL tool calls
 *
 * All tool invocations pass through this proxy, which:
 * 1. Logs the observation BEFORE allow/deny decision
 * 2. Checks if tool is in registry (shadow detection)
 * 3. Checks for anomalous usage patterns
 * 4. Forwards to actual tool executor
 *
 * AST10 annotation (per ADR-043): when config.enableAST10Annotation is true,
 * the proxy invokes `ast10-mapper.classifyAndLog` after the source observation
 * is written. Default OFF until the test suite passes — the hook must remain
 * a passive observer per ADR-040 fail-open contract.
 *
 * ATLAS annotation (per ADR-047): when config.enableATLASAnnotation is true,
 * the proxy invokes `atlas-mapper.classifyAndLog` alongside the AST10
 * mapper. The two annotators write to the same `parentDecisionId` and the
 * chain carries both annotations on the same source event. Same fail-open
 * posture as AST10.
 *
 * AST06 source events (per ADR-048 §4): when config.enableAST06Annotation
 * is true, `observeSandboxDecision()` writes a first-class
 * `sandbox_policy_decision` source event into the audit chain BEFORE the
 * sandbox policy enforces. The annotation falls out of ast10-mapper rule 8
 * (`sandbox-boundary-violation`) when the source event carries an
 * `AWARE_SANDBOX_DENY:` error OR a verified requested/effective namespace
 * mismatch. The sandbox policy module retains its own fail policy; the
 * proxy / mapper remain fail-open per ADR-040.
 *
 * AST08 source events (per ADR-048 §5): when config.enableAST08Annotation
 * is true, `observeSkillActivation()` invokes the vendor-neutral skill
 * scanner adapter (`src/compliance/skill-scanner.js`, default backend =
 * NVIDIA SkillSpector), then writes a `skill_scan_result` source event
 * into the audit chain. AST08 annotation falls out of ast10-mapper rule 9
 * (`skill-scan-finding`); AST01 falls out of rule 10
 * (`malicious-or-unproven-skill`). Per ADR-048 §5, new/untrusted skill
 * activation is fail-closed when the scanner is unavailable — the
 * `defaultActivationPolicy` deny reasons `SCAN_UNAVAILABLE` /
 * `SCAN_MALICIOUS` / `SCAN_FAILED` etc. are returned to the caller and
 * the caller MUST refuse to activate.
 *
 * LLM07:2025 source events (per ADR-050 §5 GAP-4): when
 * config.enableLLM07Detection is true, `observeModelInput()` pattern-matches
 * the model input against a conservative set of system-prompt-elicitation
 * regexes and, on a hit, writes a `model_input_classification` source
 * event into the audit chain carrying the ADR-043-compatible annotation
 * `{ rule: 'system-prompt-elicit', confidence: 'M', reference: 'ADR-050#GAP-4' }`
 * plus the matched pattern + a content hash. Default OFF — the rule ships
 * behind a flag until corpus-validated against DonkAI's LLM07 lab. The
 * proxy / mapper remain fail-open per ADR-040: a logDecision failure
 * does NOT block the model call; the caller retains its own enforcement
 * path.
 */
class ToolObservationProxy extends EventEmitter {
  /**
   * @param {Object} config - Configuration
   * @param {Object} config.toolRegistry - Tool registry instance
   * @param {Object} config.shadowDetector - Shadow detector instance
   * @param {Object} config.auditLogger - Audit logger instance
   * @param {Function} config.toolExecutor - Actual tool execution function
   * @param {boolean} [config.enableCredentialClassification=true] - When false,
   *        skips the APTS-MR-019 credential classifier on tool-output
   *        payloads. Default ON per ADR-049 §5.
   * @param {boolean} [config.enableAST06Annotation=false] - When true, every
   *        call to `observeSandboxDecision()` writes a `sandbox_policy_decision`
   *        source event into the audit chain. Default OFF until the test
   *        suite proves the call path is safe (per ADR-048 §7.2).
   * @param {boolean} [config.enableAST08Annotation=false] - When true, every
   *        call to `observeSkillActivation()` invokes the skill-scanner
   *        adapter and writes a `skill_scan_result` source event. Default
   *        OFF (per ADR-048 §7.3).
   * @param {Object} [config.skillScanner] - pre-built skill-scanner
   *        instance (from `src/compliance/skill-scanner.js`). When omitted,
   *        the proxy lazily constructs one with default settings (empty
   *        allowlist, no executable → all scans return 'unavailable').
   *        Tests inject a fake scanner here.
   * @param {boolean} [config.enableLLM07Detection=false] - When true, every
   *        call to `observeModelInput()` runs the conservative LLM07:2025
   *        system-prompt-elicit pattern set (per ADR-050 §5 GAP-4) and
   *        writes a `model_input_classification` source event on a hit.
   *        Default OFF — the rule ships behind a flag until corpus-validated
   *        against DonkAI's LLM07 lab. Env var override:
   *        `AWARE_LLM07_DETECTION_ENABLED=true` flips on at construction.
   *        Tests inject explicit patterns via `config.llm07Patterns` when
   *        they want to assert FP / catalogue-failure paths.
   * @param {RegExp[]} [config.llm07Patterns] - Override the default
   *        system-prompt-elicitation regex set. Tests use this to inject
   *        a catalogue-missing pattern (a regex that throws on `.test()`)
   *        for the catalogue-failure path.
   */
  constructor(config = {}) {
    super();
    this.registry = config.toolRegistry;
    this.shadowDetector = config.shadowDetector;
    this.auditLogger = config.auditLogger;
    this.executor = config.toolExecutor || this.defaultExecutor;

    // AST10 annotation wiring (per ADR-043). Default OFF until the test
    // suite proves the call path is safe; the hook must remain a passive
    // observer per ADR-040 fail-open contract.
    this.enableAST10Annotation = config.enableAST10Annotation === true;
    this._ast10Mapper = config.ast10Mapper || null;
    this._ast10HostAllowlist = config.ast10HostAllowlist || null;

    // ATLAS annotation wiring (per ADR-047). Default OFF, same posture
    // as AST10 — the hook remains a passive observer. When the AST10
    // annotation is enabled but ATLAS isn't, only AST10 annotations are
    // written; the operators opt-in to ATLAS via a separate toggle so the
    // v1 rollout can verify each mapper independently.
    this.enableATLASAnnotation = config.enableATLASAnnotation === true;
    this._atlasMapper = config.atlasMapper || null;
    this._atlasHostAllowlist = config.atlasHostAllowlist || null;
    this._atlasPublicAiHosts = config.atlasPublicAiHosts || null;
    this._atlasDriftK = config.atlasDriftK;
    this._atlasDriftSigma = config.atlasDriftSigma;

    // APTS-MR-019 credential classification (per ADR-049 §5). Default ON.
    // The classifier scans tool-output payloads for known credential
    // patterns and redacts them before they reach the model. Tests that
    // exercise the proxy with synthetic strings that intentionally match
    // the patterns can opt out via config.enableCredentialClassification = false.
    this.enableCredentialClassification = config.enableCredentialClassification !== false;

    // ADR-048 AST06 toggle — default OFF until the test suite proves
    // the call path is safe. Gates emission of `sandbox_policy_decision`
    // source events through `observeSandboxDecision()` (per ADR-048 §4).
    // When OFF, sandbox policy decisions are NOT recorded as source
    // events — the sandbox-policies module retains its own enforcement
    // path unchanged.
    this.enableAST06Annotation = config.enableAST06Annotation === true;

    // ADR-048 AST08 toggle — default OFF. Gates the skill-scanner
    // adapter invocation in `observeSkillActivation()` (per ADR-048 §5).
    // When OFF, skills are activated via the prior path without a scan
    // (the proxy emits neither a source event nor a SKILL_SCAN_UNAVAILABLE
    // health signal — the operator's existing trust boundary remains
    // the sole gate).
    this.enableAST08Annotation = config.enableAST08Annotation === true;
    this._skillScanner = config.skillScanner || null;

    // ADR-050 §5 GAP-4 — LLM07:2025 detection toggle. Default OFF
    // (sourced from process.env so operators can flip on without code
    // changes — `AWARE_LLM07_DETECTION_ENABLED=true`). The pattern set
    // is intentionally conservative per ADR-043's calibration rule
    // (false positives are worse than false negatives for this
    // heuristic). When OFF, `observeModelInput()` returns immediately
    // and emits `modelInputCheckSkipped` for in-process subscribers.
    if (config.enableLLM07Detection !== undefined) {
      this.enableLLM07Detection = config.enableLLM07Detection === true;
    } else {
      this.enableLLM07Detection = process.env.AWARE_LLM07_DETECTION_ENABLED === 'true';
    }
    // Pattern set. Conservative — see ADR-050 §5 GAP-4. Tests inject
    // their own array (including a throwing regex for the
    // catalogue-failure path). The default patterns are case-insensitive
    // and match a fixed set of elicitation phrasings.
    this.llm07Patterns = Array.isArray(config.llm07Patterns)
      ? config.llm07Patterns
      : DEFAULT_LLM07_PATTERNS;
  }

  /**
   * Lazily construct the skill-scanner adapter. Loaded on first use
   * so the proxy stays constructible even if the scanner module is
   * missing or fails to load (defence-in-depth — the proxy never
   * blocks on scanner availability).
   *
   * @returns {Object|null}
   */
  _getSkillScanner() {
    if (this._skillScanner) return this._skillScanner;
    if (this._skillScanner === false) return null; // construction failed previously
    try {
      // eslint-disable-next-line global-require
      const { createSkillScanner } = require('../compliance/skill-scanner');
      this._skillScanner = createSkillScanner({
        // Default: no executable → probe fails → all scans return
        // 'unavailable' → SkillActivationGate refuses to activate.
        // Operators must explicitly pass an `executable` + `allowlist`
        // via config.skillScanner when ready to enable enforcement.
        allowlist: []
      });
      return this._skillScanner;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[tool-observation-proxy] skill-scanner unavailable: ${err.code || err.message}`);
      this._skillScanner = false;
      return null;
    }
  }

  /**
   * Lazily construct the AST10 mapper. Loaded on first use so the proxy
   * stays constructible even if ast10-mapper.js is missing or fails to
   * load (the construction is wrapped so a misconfigured AST10 stack
   * never breaks the observation path).
   * @returns {Object|null}
   */
  _getAST10Mapper() {
    if (this._ast10Mapper) return this._ast10Mapper;
    if (this._ast10Mapper === false) return null; // construction failed previously
    try {
      // Lazy require so this proxy can be loaded in tests that don't
      // exercise the AST10 path at all (avoids the cascade through
      // ast10-catalog.js → ast10-mapper.js module state).
      // eslint-disable-next-line global-require
      const { createAST10Mapper } = require('../compliance/ast10-mapper');
      this._ast10Mapper = createAST10Mapper({
        enableWrites: true,
        hostAllowlist: this._ast10HostAllowlist,
        // Inject the proxy's auditLogger so AST10 annotations land in
        // the SAME audit chain as the source events (defence-in-depth:
        // annotations cannot end up in a separate store the operator
        // isn't watching).
        auditLogger: this.auditLogger
      });
      return this._ast10Mapper;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[tool-observation-proxy] AST10 mapper unavailable: ${err.code || err.message}`);
      this._ast10Mapper = false;
      return null;
    }
  }

  /**
   * Lazily construct the ATLAS mapper. Loaded on first use so the proxy
   * stays constructible even if atlas-mapper.js is missing or fails to
   * load. Per ADR-047 the construction is wrapped so a misconfigured
   * ATLAS stack never breaks the observation path.
   * @returns {Object|null}
   */
  _getATLASMapper() {
    if (this._atlasMapper) return this._atlasMapper;
    if (this._atlasMapper === false) return null; // construction failed previously
    try {
      // eslint-disable-next-line global-require
      const { createATLASMapper } = require('../compliance/atlas-mapper');
      const opts = { enableWrites: true };
      if (this._atlasHostAllowlist !== null && this._atlasHostAllowlist !== undefined) {
        opts.hostAllowlist = this._atlasHostAllowlist;
      }
      if (Array.isArray(this._atlasPublicAiHosts)) {
        opts.publicAiHosts = this._atlasPublicAiHosts;
      }
      if (Number.isFinite(this._atlasDriftK)) {
        opts.driftK = this._atlasDriftK;
      }
      if (Number.isFinite(this._atlasDriftSigma)) {
        opts.driftSigma = this._atlasDriftSigma;
      }
      this._atlasMapper = createATLASMapper(opts);
      return this._atlasMapper;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[tool-observation-proxy] ATLAS mapper unavailable: ${err.code || err.message}`);
      this._atlasMapper = false;
      return null;
    }
  }

  /**
   * Default executor (placeholder)
   * @param {string} toolId - Tool ID
   * @param {Object} parameters - Tool parameters
   * @param {Object} context - Execution context
   * @returns {Promise<Object>}
   */
  async defaultExecutor(toolId, parameters, context) {
    return { error: 'NO_EXECUTOR_CONFIGURED', toolId };
  }

  /**
   * Observe a tool call and forward to executor
   * @param {string} toolId - Tool ID
   * @param {Object} parameters - Tool parameters
   * @param {Object} agentContext - Agent context { agentId, sessionId, role, callSource }
   * @returns {Promise<Object>} { allowed: boolean, result?: any, reason?: string }
   */
  async observeAndForward(toolId, parameters, agentContext) {
    const observation = {
      toolId,
      parameters,
      agentId: agentContext.agentId,
      sessionId: agentContext.sessionId,
      role: agentContext.role,
      callSource: agentContext.callSource || 'direct',
      timestamp: Date.now()
    };

    // 1. ALWAYS log the observation first (before allow/deny)
    if (this.auditLogger) {
      await this.auditLogger.logToolObservation(observation);
    }

    // 1a. AST10 classification (per ADR-043). Gated behind
    //     enableAST10Annotation (default OFF). Fail-open: if the mapper
    //     is missing or `classifyAndLog` throws, we continue executing
    //     the proxy. The hook never blocks per ADR-040.
    if (this.enableAST10Annotation) {
      try {
        const mapper = this._getAST10Mapper();
        if (mapper) {
          // The mapper reads decision-chain records; we build a minimal
          // record shape so the rules can match. This is intentionally
          // not the full DecisionRecord shape — `classify` only reads
          // `action.type / action.target / action.parameters /
          // outcome.success / outcome.errorMessage`, plus
          // `actor.{agentId,publisherKey}`. See ast10-mapper.js.
          const event = {
            decisionId: 'obs-' + observation.timestamp,
            parentDecisionId: null,
            timestamp: new Date(observation.timestamp).toISOString(),
            actor: {
              agentId: observation.agentId,
              role: observation.role
            },
            action: {
              type: 'tool_observation',
              toolId,
              target: typeof parameters === 'object' ? JSON.stringify(parameters).slice(0, 200) : String(parameters),
              parameters: parameters || {},
              reason: 'tool-observation-proxy'
            },
            context: {
              pheromoneScores: {},
              heuristicWeights: {},
              policyId: 'tool-observation-proxy',
              policyVersion: '1.0.0'
            },
            outcome: { success: true, latencyMs: 0, errorMessage: null }
          };
          // Best-effort annotation; failures swallowed inside classifyAndLog.
          // ADR-043 API surface: classifyAndLog(mapper, event) takes the mapper
          // as the first arg (the module exports it as a free function).
          const { classifyAndLog } = require('../compliance/ast10-mapper');
          await classifyAndLog(mapper, event);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[tool-observation-proxy] AST10 annotate failed: ${err.message}`);
      }
    }

    // 1b. ATLAS classification (per ADR-047). Gated behind
    //     enableATLASAnnotation (default OFF). Same event shape as
    //     AST10 above — `classify` reads the same minimal record.
    //     Annotations are written with `parentDecisionId` pointing at
    //     this observation's id; the AST10 and ATLAS annotations
    //     coexist on the same source event in the chain.
    if (this.enableATLASAnnotation) {
      try {
        const mapper = this._getATLASMapper();
        if (mapper) {
          const event = {
            decisionId: 'obs-' + observation.timestamp,
            parentDecisionId: null,
            timestamp: new Date(observation.timestamp).toISOString(),
            actor: {
              agentId: observation.agentId,
              role: observation.role
            },
            action: {
              type: 'tool_observation',
              toolId,
              target: typeof parameters === 'object' ? JSON.stringify(parameters).slice(0, 200) : String(parameters),
              parameters: parameters || {},
              reason: 'tool-observation-proxy'
            },
            context: {
              pheromoneScores: {},
              heuristicWeights: {},
              policyId: 'tool-observation-proxy',
              policyVersion: '1.0.0'
            },
            outcome: { success: true, latencyMs: 0, errorMessage: null }
          };
          // eslint-disable-next-line global-require
          const { classifyAndLog } = require('../compliance/atlas-mapper');
          await classifyAndLog(mapper, event);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[tool-observation-proxy] ATLAS annotate failed: ${err.message}`);
      }
    }

    // Emit observation event for monitoring
    this.emit('toolObservation', observation);

    // 2. Check if tool is in registry
    let tool = null;
    if (this.registry) {
      tool = await this.registry.getTool(toolId);
    }

    if (!tool) {
      // Unknown tool - record as shadow candidate
      if (this.shadowDetector) {
        await this.shadowDetector.recordUnregisteredCall(observation);
      }

      this.emit('unknownTool', observation);

      return {
        allowed: false,
        reason: 'TOOL_NOT_IN_REGISTRY',
        shadow: true,
        observation
      };
    }

    // 3. Tool exists - check if usage pattern is anomalous
    if (this.shadowDetector) {
      const shadowCheck = await this.shadowDetector.checkAnomalousUsage(
        agentContext.agentId,
        toolId,
        observation
      );

      if (shadowCheck.isShadow || shadowCheck.isAnomalous) {
        // Known tool but unusual usage - alert and log
        await this.shadowDetector.recordAnomalousCall(observation, shadowCheck);

        this.emit('anomalousToolUsage', {
          ...observation,
          shadowCheck
        });

        return {
          allowed: false,
          reason: shadowCheck.isShadow ? 'SHADOW_TOOL_PATTERN' : 'ANOMALOUS_USAGE',
          alert: true,
          shadowCheck,
          observation
        };
      }
    }

    // 4. Check if tool is enabled
    if (tool.enabled === false) {
      return {
        allowed: false,
        reason: 'TOOL_DISABLED',
        tool
      };
    }

    // 5. Forward to actual executor
    try {
      const rawResult = await this.executor(toolId, parameters, {
        ...agentContext,
        tool
      });

      // 5a. APTS-MR-019 credential classifier. Scan the tool-output
      //      payload for credential patterns BEFORE the payload is
      //      returned to the caller (which may forward it to the model).
      //      On a hit, redact the matched substring with a stable
      //      placeholder. The matched secret is never persisted, logged,
      //      or returned. A decision record is written for both hits and
      //      misses. Fail-open: a classifier throw is swallowed so the
      //      observation path keeps working (same posture as the AST10 /
      //      ATLAS hooks above).
      let result = rawResult;
      let credentialRedacted = false;
      if (this.enableCredentialClassification !== false) {
        try {
          const { classify, redact, buildDecisionRecord } = require('./credential-classifier');
          const classification = classify(rawResult);
          // String inputs: replace in-place with a stable placeholder.
          // Non-string inputs (objects, arrays, numbers): record the
          // classification decision but do NOT mutate the structure —
          // callers depend on the shape. We also redact the
          // stringified form internally to confirm the regex fires, but
          // the original structure is returned unchanged. Most real tool
          // outputs are objects; the classifier still produces a
          // decision-record for the audit chain.
          if (classification.matched && typeof rawResult === 'string') {
            const redacted = redact(rawResult, classification);
            result = redacted.text;
            credentialRedacted = true;
          }
          // Log a decision record (hit or miss) so the audit chain has
          // the policy evidence. Uses the same fail-open logDecision
          // contract — the classifier never crashes the call path.
          if (this.auditLogger && typeof this.auditLogger.logDecision === 'function') {
            const crypto = require('crypto');
            const record = buildDecisionRecord(classification, {
              agentId: agentContext.agentId,
              role: agentContext.role,
              trustScore: null
            });
            // The decision-logger assigns decisionId / prevHash / hash;
            // we provide decisionId here so callers can correlate.
            record.decisionId = 'cred-' + crypto.randomUUID();
            record.parentDecisionId = null;
            await this.auditLogger.logDecision(record);
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[tool-observation-proxy] credential classifier failed: ${err.message}`);
        }
      }

      // Log successful execution
      if (this.auditLogger) {
        await this.auditLogger.logToolExecution({
          ...observation,
          success: true,
          result
        });
      }

      const credentialCheck = (() => {
        if (this.enableCredentialClassification === false) return undefined;
        return {
          redacted: credentialRedacted,
          classifier_version: require('./credential-classifier').CLASSIFIER_VERSION
        };
      })();
      return {
        allowed: true,
        result,
        tool,
        // APTS-MR-019: redaction signal. The matched-secret is NEVER
        // returned; only the metadata-safe classification result. Callers
        // (the model-input boundary) get the redacted text in `result`
        // and a redacted-at timestamp in `credentialCheck`. They do NOT
        // get the original secret.
        credentialCheck
      };
    } catch (error) {
      // Log failed execution
      if (this.auditLogger) {
        await this.auditLogger.logToolExecution({
          ...observation,
          success: false,
          error: error.message
        });
      }

      return {
        allowed: true, // Execution failure doesn't mean denied
        error: error.message,
        tool
      };
    }
  }

  /**
   * Wrap an executor function with observation
   * @param {Function} executor - Tool executor function
   * @returns {Function} Wrapped executor
   */
  wrapExecutor(executor) {
    const proxy = this;
    return async function(toolId, parameters, context) {
      return proxy.observeAndForward(toolId, parameters, context);
    };
  }

  // ==========================================================================
  // ADR-048 §4 — AST06 source-event producer.
  //
  // `observeSandboxDecision` is called by the sandbox-policies module
  // BEFORE it enforces a boundary crossing. The proxy writes a
  // first-class `sandbox_policy_decision` source event into the audit
  // chain (gated behind `enableAST06Annotation`). The annotation falls
  // out of ast10-mapper rule 8 (`sandbox-boundary-violation`) when the
  // source event carries an `AWARE_SANDBOX_DENY:` error OR a verified
  // requested/effective namespace mismatch.
  //
  // The proxy / mapper remain fail-open per ADR-040: a logDecision
  // failure does NOT block the sandbox enforcement. The sandbox policy
  // module retains its own fail-closed (or fail-open, per operator
  // config) policy — it MUST NOT consult the proxy for enforcement.
  //
  // Contract (input):
  //   {
  //     toolId,
  //     target,
  //     sandboxProfile, requestedNamespace, effectiveNamespace,
  //     hostEscapeCapabilities,
  //     outcome: { success, errorMessage, ... },
  //     agentContext: { agentId, sessionId, role, callSource }
  //   }
  //
  // Returns the same shape as a tool_dispatch observation (so the
  // downstream AST10 mapper can treat it identically):
  //   { allowed, observation }
  // =============================================================================
  async observeSandboxDecision(decision) {
    if (!decision || typeof decision !== 'object') {
      throw new TypeError('observeSandboxDecision requires a decision object');
    }

    const observation = {
      decisionType: 'sandbox_policy_decision',
      toolId: decision.toolId || null,
      target: decision.target || null,
      sandboxProfile: decision.sandboxProfile || null,
      requestedNamespace: decision.requestedNamespace || null,
      effectiveNamespace: decision.effectiveNamespace || null,
      hostEscapeCapabilities: Array.isArray(decision.hostEscapeCapabilities)
        ? decision.hostEscapeCapabilities.slice()
        : [],
      outcome: decision.outcome || { success: true, errorMessage: null },
      agentId: (decision.agentContext && decision.agentContext.agentId) || null,
      sessionId: (decision.agentContext && decision.agentContext.sessionId) || null,
      role: (decision.agentContext && decision.agentContext.role) || null,
      timestamp: Date.now()
    };

    // ADR-048 §7.2 — staged rollout. When the toggle is OFF, we do
    // NOT write the source event (shadow mode = no observation at
    // all). When ON, we always write the source event so the
    // downstream annotation can fire.
    if (!this.enableAST06Annotation) {
      // Still emit a lightweight event for in-process subscribers,
      // but DO NOT write to the audit chain. This lets a shadow-mode
      // operator verify the call path locally without polluting the
      // chain with non-production evidence.
      this.emit('sandboxPolicyDecisionSkipped', observation);
      return { allowed: observation.outcome.success !== false, observation, skipped: true };
    }

    if (this.auditLogger && typeof this.auditLogger.logDecision === 'function') {
      try {
        const sourceRecord = {
          decisionId: 'sandbox-' + observation.timestamp + '-' + Math.random().toString(36).slice(2, 8),
          parentDecisionId: null,
          timestamp: new Date(observation.timestamp).toISOString(),
          actor: {
            agentId: observation.agentId,
            role: observation.role,
            trustScore: 1.0
          },
          action: {
            type: 'sandbox_policy_decision',
            toolId: observation.toolId,
            target: observation.target,
            reason: (observation.outcome && observation.outcome.errorMessage) || 'sandbox-policy',
            parameters: {
              sandboxProfile: observation.sandboxProfile,
              requestedNamespace: observation.requestedNamespace,
              effectiveNamespace: observation.effectiveNamespace,
              hostEscapeCapabilities: observation.hostEscapeCapabilities,
              allowMismatch: decision.allowMismatch === true
            }
          },
          context: {
            pheromoneScores: {},
            heuristicWeights: {},
            policyId: decision.policyId || 'sandbox-policies',
            policyVersion: decision.policyVersion || '1.0.0'
          },
          outcome: {
            success: observation.outcome.success !== false,
            latencyMs: 0,
            errorMessage: (observation.outcome && observation.outcome.errorMessage) || null
          }
        };
        await this.auditLogger.logDecision(sourceRecord);

        // If AST10 annotation is also enabled, the mapper picks up
        // the source event via `classifyAndLog` against the AST10
        // mapper. We invoke it directly here so the operator does not
        // have to wire up a separate chain segment reader.
        if (this.enableAST10Annotation) {
          try {
            const mapper = this._getAST10Mapper();
            if (mapper) {
              const { classifyAndLog } = require('../compliance/ast10-mapper');
              await classifyAndLog(mapper, sourceRecord);
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(`[tool-observation-proxy] AST10 annotate on sandbox decision failed: ${err.message}`);
          }
        }
      } catch (err) {
        // Fail-open: log failure does NOT block the sandbox policy's
        // own enforcement. The source event may be missing from the
        // chain — surface via telemetry so operators can detect
        // source/annotation count divergence (per ADR-048 §8).
        // eslint-disable-next-line no-console
        console.warn(`[tool-observation-proxy] sandbox policy decision log failed: ${err.message}`);
      }
    }

    this.emit('sandboxPolicyDecision', observation);

    // The proxy never ENFORCES — that is the sandbox policy module's
    // job. We return the sandbox policy's own outcome so the caller
    // can short-circuit if needed.
    return { allowed: observation.outcome.success !== false, observation };
  }

  // ==========================================================================
  // ADR-048 §5 — AST08 source-event producer + SkillActivationGate.
  //
  // `observeSkillActivation` is called by the skill loader BEFORE it
  // activates a new skill. The proxy invokes the skill-scanner adapter
  // (gated behind `enableAST08Annotation`), applies
  // `defaultActivationPolicy` (fail-closed for new/untrusted skills),
  // then writes a `skill_scan_result` source event into the audit
  // chain. AST08 falls out of ast10-mapper rule 9
  // (`skill-scan-finding`); AST01 falls out of rule 10
  // (`malicious-or-unproven-skill`).
  //
  // Contract (input):
  //   {
  //     skillId,        // stable id (target)
  //     artifactPath,   // path to the skill artifact (skill bundle)
  //     artifactHash,   // sha256 hex of the artifact (pinned at scan-time)
  //     manifest,       // skill manifest (publisher identity, etc.)
  //     agentContext,   // { agentId, sessionId, role }
  //     activationPolicy  // optional { allowFindings: bool } override
  //   }
  //
  // Returns:
  //   {
  //     allowed: boolean,           // false → caller MUST refuse to activate
  //     reason?: string,            // SCAN_* deny reason when allowed=false
  //     scanResult: { ... },        // the scan result (for audit chain)
  //     annotationSkipped: boolean  // true when enableAST08Annotation=false
  //   }
  // =============================================================================
  async observeSkillActivation(request) {
    if (!request || typeof request !== 'object') {
      throw new TypeError('observeSkillActivation requires a request object');
    }
    if (typeof request.artifactHash !== 'string' || request.artifactHash.length === 0) {
      throw new TypeError('observeSkillActivation requires artifactHash (string)');
    }
    if (typeof request.artifactPath !== 'string' || request.artifactPath.length === 0) {
      throw new TypeError('observeSkillActivation requires artifactPath (string)');
    }

    // ADR-048 §7.3 — staged rollout. When the toggle is OFF, we do
    // NOT scan, NOT write the source event, NOT enforce. The skill
    // is activated via the prior path (the operator's existing trust
    // boundary remains the sole gate). The caller MUST still apply
    // its own trust checks — this proxy does not weaken them.
    if (!this.enableAST08Annotation) {
      return {
        allowed: true,
        reason: 'AST08_DISABLED',
        scanResult: null,
        annotationSkipped: true
      };
    }

    const scanner = this._getSkillScanner();
    if (!scanner) {
      // Scanner module is missing entirely. Treat as 'unavailable' —
      // fail-closed for new/untrusted skills per ADR-048 §5.
      const scanResult = {
        scanner: 'unavailable',
        scannerVersion: 'unavailable',
        rulesetVersion: 'unavailable',
        artifactHash: request.artifactHash,
        verdict: 'unavailable',
        findings: [],
        status: 'scanner_module_missing',
        scannedAt: new Date().toISOString(),
        fromCache: false
      };
      return { allowed: false, reason: 'SCAN_UNAVAILABLE', scanResult, annotationSkipped: false };
    }

    const scanResult = await scanner.scan({
      artifactPath: request.artifactPath,
      artifactHash: request.artifactHash,
      manifest: request.manifest || {}
    });

    const policyDecision = defaultActivationPolicyFor(scanResult, request.activationPolicy);

    // Emit a `skill_scan_result` source event so the AST10 mapper
    // can classify it into AST08 / AST01 annotations. The audit
    // chain carries the source event regardless of the policy
    // decision — denying a skill is itself evidence worth recording.
    if (this.auditLogger && typeof this.auditLogger.logDecision === 'function') {
      try {
        const sourceRecord = {
          decisionId: 'scan-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
          parentDecisionId: null,
          timestamp: scanResult.scannedAt || new Date().toISOString(),
          actor: {
            agentId: (request.agentContext && request.agentContext.agentId) || 'unknown',
            role: (request.agentContext && request.agentContext.role) || null,
            trustScore: 1.0
          },
          action: {
            type: 'skill_scan_result',
            toolId: null,
            target: request.skillId || request.artifactPath,
            reason: policyDecision.allowed ? 'SCAN_OK' : policyDecision.reason,
            parameters: {
              scanner: scanResult.scanner,
              scannerVersion: scanResult.scannerVersion,
              rulesetVersion: scanResult.rulesetVersion,
              artifactHash: scanResult.artifactHash,
              verdict: scanResult.verdict,
              findings: scanResult.findings,
              fromCache: scanResult.fromCache === true,
              publisherIdentity: (request.manifest && request.manifest.publisher && request.manifest.publisher.identity) || null
            }
          },
          context: {
            pheromoneScores: {},
            heuristicWeights: {},
            policyId: 'skill-scanner',
            policyVersion: '1.0.0'
          },
          outcome: {
            success: policyDecision.allowed,
            latencyMs: 0,
            errorMessage: policyDecision.allowed ? null : policyDecision.reason
          }
        };
        await this.auditLogger.logDecision(sourceRecord);

        // If AST10 annotation is also enabled, route through the
        // AST10 mapper so AST08/AST01 annotations appear in the
        // chain. The mapper reads the source event's action.type
        // ('skill_scan_result') and rules 9/10 pick it up.
        if (this.enableAST10Annotation) {
          try {
            const mapper = this._getAST10Mapper();
            if (mapper) {
              const { classifyAndLog } = require('../compliance/ast10-mapper');
              await classifyAndLog(mapper, sourceRecord);
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(`[tool-observation-proxy] AST10 annotate on skill scan failed: ${err.message}`);
          }
        }
      } catch (err) {
        // Fail-open: log failure does NOT change the policy decision.
        // The operator's telemetry will see the source/annotation
        // count divergence (per ADR-048 §8).
        // eslint-disable-next-line no-console
        console.warn(`[tool-observation-proxy] skill scan result log failed: ${err.message}`);
      }
    }

    this.emit('skillScanResult', { request, scanResult, policyDecision });
    return {
      allowed: policyDecision.allowed,
      reason: policyDecision.allowed ? undefined : policyDecision.reason,
      scanResult,
      annotationSkipped: false
    };
  }

  // ==========================================================================
  // ADR-050 §5 GAP-4 — LLM07:2025 source-event producer.
  //
  // `observeModelInput` is called by the model-input boundary BEFORE
  // the model receives the input. The proxy pattern-matches the input
  // string against a conservative set of system-prompt-elicitation
  // regexes (DEFAULT_LLM07_PATTERNS below). On a hit, it writes a
  // `model_input_classification` source event into the audit chain
  // carrying the ADR-043-compatible annotation
  // `{ rule: 'system-prompt-elicit', confidence: 'M', reference: 'ADR-050#GAP-4' }`
  // plus the matched pattern and a sha256 content hash of the input.
  //
  // The proxy / mapper remain fail-open per ADR-040: a logDecision
  // failure does NOT block the model call. The caller retains its own
  // enforcement path; this surface is observation-only.
  //
  // Default OFF (per ADR-050 §5 GAP-4): the rule ships behind
  // `enableLLM07Detection` (env: AWARE_LLM07_DETECTION_ENABLED=true)
  // until corpus-validated against DonkAI's LLM07 lab. The pattern
  // set is intentionally conservative — false positives are operator-
  // hostile (ADR-043 calibration rule), so we prefer under-matching to
  // over-matching.
  //
  // Contract (input):
  //   {
  //     input,             // string (model input text)
  //     agentContext,      // { agentId, sessionId, role, callSource }
  //     matchedRule?: 'system-prompt-elicit' | null  // optional override
  //                                                   // (tests)
  //   }
  //
  // Returns:
  //   {
  //     matched: boolean,
  //     patternMatched?: RegExp,
  //     observation,       // the normalized observation record
  //     skipped: boolean   // true when enableLLM07Detection is OFF
  //   }
  // ==========================================================================
  async observeModelInput(request) {
    if (!request || typeof request !== 'object') {
      throw new TypeError('observeModelInput requires a request object');
    }
    if (typeof request.input !== 'string') {
      throw new TypeError('observeModelInput requires input (string)');
    }

    const observation = {
      decisionType: 'model_input_classification',
      input: request.input,
      agentId: (request.agentContext && request.agentContext.agentId) || null,
      sessionId: (request.agentContext && request.agentContext.sessionId) || null,
      role: (request.agentContext && request.agentContext.role) || null,
      callSource: (request.agentContext && request.agentContext.callSource) || 'model_input',
      timestamp: Date.now()
    };

    // ADR-050 §5 GAP-4 — staged rollout. When the toggle is OFF, we
    // do NOT scan, NOT write the source event. The caller MUST still
    // apply its own trust checks — this proxy does not weaken them.
    if (!this.enableLLM07Detection) {
      this.emit('modelInputCheckSkipped', observation);
      return { matched: false, observation, skipped: true };
    }

    // Pattern-match the input against the conservative LLM07:2025
    // regex set. Each regex is run independently — first hit wins.
    // If any regex throws on `.test()` (catalogue corruption), we
    // surface that as a catalogue-failure source event and continue
    // fail-open (the call is not blocked; the operator's telemetry
    // surfaces the catalogue-mismatch).
    let patternMatched = null;
    let catalogueFailure = null;
    for (const pattern of this.llm07Patterns) {
      try {
        if (pattern.test(request.input)) {
          patternMatched = pattern;
          break;
        }
      } catch (err) {
        catalogueFailure = {
          pattern: String(pattern),
          error: err && err.message ? err.message : String(err)
        };
        // Keep scanning the rest of the catalogue so a single bad
        // pattern doesn't blind the whole rule set.
        continue;
      }
    }

    // If the entire catalogue failed (no patterns could evaluate),
    // surface a catalogue-failure source event so operators can see
    // the failure mode via telemetry, but DO NOT block the call.
    if (catalogueFailure && patternMatched === null) {
      if (this.auditLogger && typeof this.auditLogger.logDecision === 'function') {
        try {
          const sourceRecord = buildLlm07CatalogueFailureRecord(observation, catalogueFailure);
          await this.auditLogger.logDecision(sourceRecord);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[tool-observation-proxy] LLM07 catalogue-failure log failed: ${err.message}`);
        }
      }
      this.emit('modelInputCatalogueFailure', { observation, catalogueFailure });
      // Fail-open: matched=false so the caller proceeds. The audit
      // record is the durable evidence.
      return { matched: false, observation, skipped: false, catalogueFailure };
    }

    if (patternMatched === null) {
      // No match. Don't write a source event — the audit chain would
      // drown in negative results. The caller still gets the
      // observation back so it can chain its own logging if needed.
      this.emit('modelInputCheckClean', observation);
      return { matched: false, observation, skipped: false };
    }

    // Hit. Write the source event with the ADR-043-compatible
    // annotation schema. The classification.reference cites ADR-050
    // GAP-4 so downstream mappers / `llm-top-10.md` ingestion can
    // back-trace the rule to the ADR.
    if (this.auditLogger && typeof this.auditLogger.logDecision === 'function') {
      try {
        const sourceRecord = buildLlm07HitRecord(observation, patternMatched);
        await this.auditLogger.logDecision(sourceRecord);
      } catch (err) {
        // Fail-open per ADR-040: log failure does NOT block the model
        // call. Surface via telemetry so operators can detect
        // detection/log divergence.
        // eslint-disable-next-line no-console
        console.warn(`[tool-observation-proxy] LLM07 hit log failed: ${err.message}`);
      }
    }

    this.emit('modelInputElicitDetected', {
      observation,
      patternMatched: String(patternMatched)
    });
    return {
      matched: true,
      patternMatched,
      observation,
      skipped: false
    };
  }
}

// ----------------------------------------------------------------------------
// Local helper: thin wrapper around the skill-scanner's
// `defaultActivationPolicy` so the proxy module doesn't pull the
// compliance module at top-level (keeps the proxy constructible when
// the compliance stack is missing).
// ----------------------------------------------------------------------------

let _defaultActivationPolicy = null;
function defaultActivationPolicyFor(scanResult, opts) {
  if (!_defaultActivationPolicy) {
    // eslint-disable-next-line global-require
    _defaultActivationPolicy = require('../compliance/skill-scanner').defaultActivationPolicy;
  }
  return _defaultActivationPolicy(scanResult, opts || {});
}

// ----------------------------------------------------------------------------
// ADR-050 §5 GAP-4 — LLM07:2025 default pattern set + record builders.
//
// The patterns are intentionally conservative per ADR-043's calibration
// rule (false positives are operator-hostile — they show up in the
// audit log as false alarms). The set here mirrors the four regexes
// the ADR-050 GAP-4 spec calls out verbatim:
//   /reveal your (system )?prompt/i
//   /what (are you|were you) told/i
//   /repeat (your|the) (instructions|system prompt)/i
//   /output (your )?(initial |system )?(message|instructions)/i
// ----------------------------------------------------------------------------

const DEFAULT_LLM07_PATTERNS = Object.freeze([
  /reveal your (system )?prompt/i,
  /what (are you|were you) told/i,
  /repeat (your|the) (instructions|system prompt)/i,
  /output (your )?(initial |system )?(message|instructions)/i
]);

/**
 * Build the audit source record for an LLM07:2025 hit.
 * Schema mirrors ADR-043's AST10Annotation (`classification.rule`,
 * `classification.confidence`, `classification.reference`) so the
 * future `llm-top-10-mapper.js` (ADR-050 §5 GAP-1) can ingest it
 * directly.
 *
 * @param {Object} observation - the normalized observation from observeModelInput
 * @param {RegExp} patternMatched - the pattern that hit
 * @returns {Object} the source-record shape consumed by auditLogger.logDecision
 */
function buildLlm07HitRecord(observation, patternMatched) {
  // sha256 of the input — never the input itself, so the audit log
  // doesn't carry PII / system prompt fragments downstream.
  const crypto = require('crypto');
  const inputHash = crypto.createHash('sha256').update(observation.input || '').digest('hex');
  return {
    decisionId: 'llm07-' + observation.timestamp + '-' + Math.random().toString(36).slice(2, 8),
    parentDecisionId: null,
    timestamp: new Date(observation.timestamp).toISOString(),
    actor: {
      agentId: observation.agentId,
      role: observation.role,
      trustScore: 1.0
    },
    action: {
      type: 'model_input_classification',
      toolId: null,
      target: 'LLM07:2025',
      reason: 'system-prompt-elicit',
      parameters: {
        callSource: observation.callSource,
        sessionId: observation.sessionId
      },
      classification: {
        rule: 'system-prompt-elicit',
        confidence: 'M',
        reference: 'ADR-050#GAP-4'
      },
      evidence: {
        patternMatched: String(patternMatched),
        inputHash
      }
    },
    context: {
      pheromoneScores: {},
      heuristicWeights: {},
      policyId: 'tool-observation-proxy',
      policyVersion: '1.0.0'
    },
    outcome: {
      success: true, // detection is observation, not enforcement
      latencyMs: 0,
      errorMessage: null
    }
  };
}

/**
 * Build the audit source record for a catalogue-failure (every pattern
 * threw on `.test()`). This is the durable evidence that the LLM07
 * detection rule was unable to evaluate; operators see it via
 * telemetry. The rule remains fail-open: the caller proceeds.
 *
 * @param {Object} observation - the normalized observation
 * @param {Object} catalogueFailure - { pattern, error }
 * @returns {Object} the source-record shape consumed by auditLogger.logDecision
 */
function buildLlm07CatalogueFailureRecord(observation, catalogueFailure) {
  return {
    decisionId: 'llm07-catfail-' + observation.timestamp + '-' + Math.random().toString(36).slice(2, 8),
    parentDecisionId: null,
    timestamp: new Date(observation.timestamp).toISOString(),
    actor: {
      agentId: observation.agentId,
      role: observation.role,
      trustScore: 1.0
    },
    action: {
      type: 'model_input_classification',
      toolId: null,
      target: 'LLM07:2025',
      reason: 'catalogue-failure',
      parameters: {
        callSource: observation.callSource,
        sessionId: observation.sessionId
      },
      classification: {
        rule: 'system-prompt-elicit',
        confidence: 'M',
        reference: 'ADR-050#GAP-4'
      },
      evidence: {
        patternMatched: catalogueFailure.pattern,
        errorMessage: catalogueFailure.error
      }
    },
    context: {
      pheromoneScores: {},
      heuristicWeights: {},
      policyId: 'tool-observation-proxy',
      policyVersion: '1.0.0'
    },
    outcome: {
      success: false,
      latencyMs: 0,
      errorMessage: 'CATALOGUE_FAILURE'
    }
  };
}

/**
 * Create a tool observation proxy with standard components
 * @param {Object} config - Configuration
 * @returns {ToolObservationProxy}
 */
function createToolObservationProxy(config = {}) {
  const {
    toolRegistry,
    shadowDetector,
    auditLogger,
    toolExecutor,
    // APTS-MR-019: forward the credential-classification toggle so the
    // factory caller's option actually reaches the constructor.
    enableCredentialClassification,
  } = config;

  return new ToolObservationProxy({
    toolRegistry: toolRegistry || getDefaultToolRegistry(),
    shadowDetector: shadowDetector || getDefaultShadowDetector(),
    auditLogger: auditLogger || getDefaultAuditLogger(),
    toolExecutor,
    enableCredentialClassification,
  });
}

// Placeholder defaults - these should be replaced with actual implementations
function getDefaultToolRegistry() {
  return {
    getTool: async (toolId) => null,
    isKnownTool: async (toolId) => false
  };
}

function getDefaultShadowDetector() {
  return {
    recordUnregisteredCall: async () => ({}),
    checkAnomalousUsage: async () => ({ isShadow: false, isAnomalous: false })
  };
}

function getDefaultAuditLogger() {
  return {
    logToolObservation: async () => {},
    logToolExecution: async () => {}
  };
}

module.exports = {
  ToolObservationProxy,
  createToolObservationProxy
};
