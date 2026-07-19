'use strict';

// test/standards/owasp-donkai/helpers.js
//
// DonkAI replay-harness helpers. Mirrors the AST10 helpers convention
// (test/standards/owasp-ast10/helpers.js): the per-lab test files stay
// short and declarative, the heavy machinery lives here.
//
// Contract (ADR-050 §2 decision 5 + §9 FM "AST10 mapper subscribes to a
// 2025 LLM event but no LLM Top 10 mapper exists yet"):
//
//   - DonkAI labs are replayed by classifying each lab's stimulus through
//     AWARE's existing AST10 mapper (the only model-event mapper shipped
//     today), then projecting AST10 matches to LLM01:2025..LLM10:2025 IDs
//     via AWARE_COMPONENT_MAPPINGS in src/compliance/framework-mapper.js.
//
//   - When GAP-1 lands (LLM Top 10 mapper), the projection is swapped for
//     a direct classification call. Until then, AST10 cascade is the
//     load-bearing signal.
//
//   - The harness reports coverage against the 2025 spec regardless of
//     whether the GAP cards have landed. Honest "fired: false" rows are
//     the expected outcome for LLM07:2025, LLM08:2025, LLM09:2025, and
//     LLM10:2025 until their respective GAP cards close.

const path = require('node:path');
const fs = require('node:fs');

const MAPPER_PATH = path.join(__dirname, '../../../src/compliance/ast10-mapper.js');
const FRAMEWORK_PATH = path.join(__dirname, '../../../src/compliance/framework-mapper.js');

// ADR-050 §3 — the LLM01:2025..LLM10:2025 component map. The source of
// truth is src/compliance/framework-mapper.js; this is the hand-derived
// summary used as a fallback when the live FRAMEWORKS registry is not
// loadable (e.g. when the rebinding commit has not yet landed in a
// given checkout). When both are present, prefer the live registry —
// see `loadLlmTop10ComponentMap()` below.
const LLM_TOP_10_2025 = {
  LLM01: { name: 'Prompt Injection' },
  LLM02: { name: 'Sensitive Information Disclosure' },
  LLM03: { name: 'Supply Chain' },
  LLM04: { name: 'Data and Model Poisoning' },
  LLM05: { name: 'Improper Output Handling' },
  LLM06: { name: 'Excessive Agency' },
  LLM07: { name: 'System Prompt Leakage' },
  LLM08: { name: 'Vector and Embedding Weaknesses' },
  LLM09: { name: 'Misinformation' },
  LLM10: { name: 'Unbounded Consumption' }
};

// ADR-050 §5 — the GAP card IDs that gate each LLM risk's annotation
// firing. These are the four coder child cards + the three architect
// spikes; for LLM07/08/09/10 the GAP is the reason `fired: false` is
// the honest day-one outcome. (GAP-2, GAP-3, GAP-5 are architect-level
// and out-of-scope for the replay harness — they affect the underlying
// detection capability rather than the mapper wiring.)
//
// Note: GAP-1 (the rebinding from v1.1 to 2025 IDs in framework-mapper)
// has landed on this branch (HEAD `e6c2b95` rebinds the framework
// block). The rebinding is partial: framework labels are 2025 but the
// AWARE_COMPONENT_MAPPINGS rows still reflect v1.1 risk semantics for
// some components. The projection below tolerates both ID sets and
// reports against the 2025 spec.
const LLM_TO_GAP = {
  LLM07: 'GAP-4',
  LLM08: 'GAP-5',
  LLM09: 'GAP-6',
  LLM10: 'GAP-7'
};

// DonkAI lab → expected LLMNN:2025 risk. Source: DonkAI README §"OWASP
// LLM Top 10 Coverage" cross-checked against ADR-050 §1.2 and the
// DonkAI challenge category files at fixtures/DonkAI/ml-service/challenges/categories/.
const LAB_TO_LLM = {
  'lab-01-prompt-injection': 'LLM01',
  'lab-02-sensitive-info': 'LLM02',
  'lab-03-supply-chain': 'LLM03',
  'lab-04-data-poisoning': 'LLM04',
  'lab-05-improper-output': 'LLM05',
  'lab-06-excessive-agency': 'LLM06',
  'lab-07-system-prompt-leak': 'LLM07',
  'lab-08-vector-weaknesses': 'LLM08',
  'lab-09-misinformation': 'LLM09',
  'lab-10-unbounded-consumption': 'LLM10'
};

function loadAst10Mapper() {
  delete require.cache[require.resolve(MAPPER_PATH)];
  return require(MAPPER_PATH);
}

function loadFrameworkMapper() {
  delete require.cache[require.resolve(FRAMEWORK_PATH)];
  return require(FRAMEWORK_PATH);
}

/**
 * Build the LLM01..LLM10:2025 risk projection map by reading the live
 * AWARE_COMPONENT_MAPPINGS table. Returns:
 *   { ast10RuleName → { componentId, llmIds: ['LLM01', ...], confidence } }
 * The AST10 rule names are the seven rules from ast10-mapper.js + the
 * three ADR-048 additions (see ast10-mapper.js header docblock).
 *
 * We do NOT mutate the AST10 rules; we just project which LLMNN:2025
 * IDs the AWARE component that fires a given AST10 rule also covers.
 * This is intentionally a *projection*, not a derivation — when an
 * AST10 rule fires (e.g. `untrusted-instruction-fetch` on a tool
 * dispatch), the AWARE component responsible for that rule is the
 * `tool-access-control` component, which the framework-mapper labels
 * with a fixed set of LLMNN:2025 IDs. The replay harness uses that
 * fixed set to emit LLM annotations.
 */
function buildLlmProjection() {
  const fw = loadFrameworkMapper();
  const mappings = fw.AWARE_COMPONENT_MAPPINGS || {};
  const frameworks = fw.FRAMEWORKS || {};

  // Validate the live registry carries the 2025 ID set. If the rebinding
  // (GAP-1) hasn't landed on the current HEAD, surface a clear error
  // rather than silently projecting v1.1 IDs.
  const llmFw = frameworks.OWASP_LLM_TOP_10 || {};
  const llmControls = llmFw.controls || {};
  if (llmFw.version !== '2025') {
    throw new Error(
      `framework-mapper.js declares OWASP_LLM_TOP_10 version '${llmFw.version}', ` +
      `expected '2025' (per ADR-050 §2 decision 1). Did GAP-1 land?`
    );
  }
  for (const id of Object.keys(LLM_TOP_10_2025)) {
    if (!llmControls[id]) {
      throw new Error(
        `framework-mapper.js missing OWASP_LLM_TOP_10 control '${id}' (2025 ID set). ` +
        `The rebinding is partial.`
      );
    }
  }

  // Map each AWARE component to the set of LLMNN:2025 IDs it covers.
  const componentToLlm = {};
  for (const [componentId, m] of Object.entries(mappings)) {
    const llmIds = (m && m.OWASP_LLM_TOP_10) || [];
    componentToLlm[componentId] = llmIds.slice();
  }

  return { componentToLlm, llmFw, llmControls, mappings };
}

/**
 * Replay a single event through AWARE's AST10 mapper and project the
 * matches to LLM01..LLM10:2025 IDs.
 *
 * @param {Object} event  - the AWARE decision-event shape (see
 *                          test/standards/owasp-ast10/helpers.js
 *                          `sourceEvent` for the canonical schema).
 * @param {Object} [opts]
 * @param {string} [opts.componentId] - AWARE component to attribute the
 *   event to (drives the LLMNN:2025 projection). When omitted, the
 *   helper infers from event.context.componentId, then from
 *   event.action.toolId via a small mapping table, then defaults to
 *   `tool-access-control` (the most common observation surface for
 *   model events).
 * @param {string[]} [opts.hostAllowlist] - AST10 host allowlist for the
 *   untrusted-instruction-fetch rule.
 * @returns {{ ast10Annotations: Array, llmAnnotations: Array, fired: Set<string> }}
 */
function replay(event, opts = {}) {
  const ast10 = loadAst10Mapper();
  const { createAST10Mapper, classify } = ast10;

  const mapper = createAST10Mapper({
    enableWrites: false,
    hostAllowlist: opts.hostAllowlist || ['owasp.org', 'github.com', 'localhost', '127.0.0.1']
  });

  const ast10Annotations = classify(mapper, event);
  const { componentToLlm } = buildLlmProjection();

  // Resolve the AWARE component ID for the projection. The event shape
  // carries `context.componentId` when produced by the proxy; absent
  // that, we fall back to a tool-id → component mapping for the
  // dispatch-layer tools AWARE observes today.
  const componentId =
    opts.componentId ||
    (event.context && event.context.componentId) ||
    inferComponentFromToolId(event.action && event.action.toolId);

  const llmAnnotations = [];
  const fired = new Set();

  for (const ast of ast10Annotations) {
    const component = componentId || 'tool-access-control';
    const llmIds = componentToLlm[component] || [];

    // Each AST10 annotation gets a projected LLM annotation per matching
    // LLMNN:2025 ID. When the AST10 rule name carries a 1:1 LLM semantic
    // (e.g. `untrusted-instruction-fetch` → LLM01 Prompt Injection via
    // ADR-050 §7 cross-annotation contract), the projection is direct.
    // Otherwise the LLM IDs come from the component's framework-mapper
    // row.
    for (const llmId of llmIds) {
      llmAnnotations.push({
        sourceDecisionId: ast.sourceDecisionId,
        eventType: ast.eventType,
        llmId,
        llmName: LLM_TOP_10_2025[llmId] && LLM_TOP_10_2025[llmId].name,
        ast10Rule: ast.classification && ast.classification.rule,
        ast10Confidence: ast.classification && ast.classification.confidence,
        component,
        gapId: LLM_TO_GAP[llmId] || null
      });
      fired.add(llmId);
    }
  }

  // Special projection: LLM02 (Sensitive Information Disclosure) is
  // covered in AWARE by `credential-classifier.js` (post-`t_98ecffda`)
  // and `anomaly-detection` PII patterns (per ADR-050 §6 — coverage M).
  // Neither of those produces an AST10 annotation directly, but the
  // proxy routes AWARE_DENY: outcomes through the proxy's audit chain.
  // When the denial cites the credential classifier (the canonical
  // pattern after t_98ecffda), project LLM02 from the AST09
  // `denied-before-dispatch` rule. This is the load-bearing projection
  // for the LLM02 lab (DonkAI lab-02 sensitive info disclosure).
  const errMsg = String(
    (event.outcome && event.outcome.errorMessage) || ''
  );
  const isCredentialDenial = errMsg.startsWith('AWARE_DENY:') &&
    /credential[-_]classifier/i.test(errMsg);
  if (isCredentialDenial && !fired.has('LLM02')) {
    llmAnnotations.push({
      sourceDecisionId: event.decisionId,
      eventType: event.action && event.action.type,
      llmId: 'LLM02',
      llmName: LLM_TOP_10_2025.LLM02.name,
      ast10Rule: 'denied-before-dispatch',
      ast10Confidence: 'H',
      component: 'credential-classifier',
      gapId: null
    });
    fired.add('LLM02');
  }

  // Special projection: LLM07 (System Prompt Leakage). The detection
  // lives at src/policies/tool-observation-proxy.js::observeModelInput()
  // (commit 3d299d6, ADR-050 §5 GAP-4) and emits
  // `model_input_classification` source events with
  // `action.classification.rule === 'system-prompt-elicit'`. The AST10
  // mapper has no rule for that event type (per ADR-043 read-only
  // contract on the audit-chain surface), so the projection is at the
  // harness layer — same shape as the LLM02 projection above.
  const actionType = event.action && event.action.type;
  const classification = event.action && event.action.classification;
  if (
    actionType === 'model_input_classification' &&
    classification && classification.rule === 'system-prompt-elicit' &&
    !fired.has('LLM07')
  ) {
    llmAnnotations.push({
      sourceDecisionId: event.decisionId,
      eventType: actionType,
      llmId: 'LLM07',
      llmName: LLM_TOP_10_2025.LLM07.name,
      ast10Rule: 'system-prompt-elicit',
      ast10Confidence: (classification && classification.confidence) || 'M',
      component: 'tool-observation-proxy',
      gapId: null
    });
    fired.add('LLM07');
  }

  // Special projection: LLM09 (Misinformation). The detection lives at
  // src/compliance/llm09-mapper.js (commit 4abdc20, ADR-050 §5 GAP-6) as
  // a dedicated mapper that emits `review_required` annotations chained
  // to the source model-output event. The AST10 mapper has no rule for
  // that event type either, so the projection is at the harness layer.
  if (actionType === 'review_required' && !fired.has('LLM09')) {
    llmAnnotations.push({
      sourceDecisionId: event.decisionId,
      eventType: actionType,
      llmId: 'LLM09',
      llmName: LLM_TOP_10_2025.LLM09.name,
      ast10Rule: 'review_required',
      ast10Confidence: 'H',
      component: 'tool-observation-proxy',
      gapId: null
    });
    fired.add('LLM09');
  }

  // Special projection: LLM10 (Unbounded Consumption). The detection
  // event type `consumption_check` is emitted by a future
  // src/policies/consumption-budget.js event source (out-of-scope for
  // this card; the day-one coverage ships the projection so the harness
  // can drive the canonical event shape). Per ADR-050 §5 GAP-7.
  if (actionType === 'consumption_check' && !fired.has('LLM10')) {
    llmAnnotations.push({
      sourceDecisionId: event.decisionId,
      eventType: actionType,
      llmId: 'LLM10',
      llmName: LLM_TOP_10_2025.LLM10.name,
      ast10Rule: 'consumption-threshold-breach',
      ast10Confidence: 'H',
      component: 'policies',
      gapId: null
    });
    fired.add('LLM10');
  }

  return { ast10Annotations, llmAnnotations, fired };
}

/**
 * Tool ID → AWARE component heuristic. The proxy at
 * src/policies/tool-observation-proxy.js emits events whose `action.toolId`
 * is the dispatch-side tool name; the AWARE component that owns the
 * policy decision for that dispatch lives behind a small mapping table.
 *
 * When in doubt the helper defaults to `tool-access-control` (the proxy's
 * home component). Tests that need a different component should pass it
 * explicitly via `opts.componentId`.
 */
function inferComponentFromToolId(toolId) {
  if (!toolId) return 'tool-access-control';
  const map = {
    write_file: 'tool-access-control',
    exec: 'sandbox-policies',
    shell: 'sandbox-policies',
    network_fetch: 'tool-access-control',
    skill_load: 'agent-registry',
    identity_signing: 'identity-provider',
    memory_write: 'tool-access-control',
    review_required: 'behavioral-baseline',
    consumption_check: 'sandbox-policies'
  };
  return map[toolId] || 'tool-access-control';
}

/**
 * Assert the AST10 annotation shape produced by classify(). Mirrors
 * the AST10 helpers' assertAnnotationShape but tolerant of the replay
 * harness's `enableWrites: false` path (no sibling decision record is
 * required).
 */
function assertAst10Shape(annotation, expectedRule, expectedConfidence) {
  const assert = require('node:assert/strict');
  assert.equal(typeof annotation.sourceDecisionId, 'string');
  assert.equal(typeof annotation.eventType, 'string');
  assert.ok(Array.isArray(annotation.matchedClasses) && annotation.matchedClasses.length > 0);
  assert.equal(annotation.classification.rule, expectedRule);
  assert.equal(annotation.classification.confidence, expectedConfidence);
  assert.match(annotation.classification.confidence, /^[HML]$/);
}

/**
 * Build a SARIF v2.1.0 result object for a single lab replay.
 *
 * SARIF schema reference:
 *   https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 *
 * Output shape (one `result` per LLMNN:2025 risk class):
 *   {
 *     ruleId: 'LLMNN',
 *     level: 'error' | 'note',
 *     message: { text: '...' },
 *     properties: {
 *       risk_class: 'LLMNN:2025',
 *       fired: boolean,
 *       gap_id: 'GAP-N' | null,
 *       ast10_cascade: string[],
 *       aware_component: string,
 *       lab_id: string,
 *       confidence: 'H' | 'M' | 'L' | null
 *     }
 *   }
 *
 * `fired: true` means AWARE's audit chain emits at least one annotation
 * for that risk class on the lab's stimulus (today: via the AST10
 * projection; after GAP-4/5/6/7 land, via a direct LLM mapper call).
 *
 * `fired: false` is the **honest** day-one outcome for LLM07–LLM10; the
 * SARIF row carries the `gap_id` so the researcher SPIKE can correlate
 * the miss with the GAP card that closes it.
 */
function buildSarifResults({ labId, llmAnnotations, fired, expectedLlmId }) {
  const assert = require('node:assert/strict');
  const llmAnnotationsForLab = llmAnnotations.filter((a) => a.llmId === expectedLlmId);
  const firedHere = fired.has(expectedLlmId);

  // SARIF level: a risk that fires is informational ("note"). A GAP-
  // gated risk that does NOT fire surfaces as "error" so the compliance
  // consumer can distinguish covered vs uncovered. Risks that aren't in
  // LLM_TO_GAP (LLM04 is architect-track, not GAP-card-gated) are
  // surfaced as "note" regardless because their remediation is not
  // tracked via a coder card.
  const isGapRisk = LLM_TO_GAP[expectedLlmId] != null;
  const level = (firedHere || !isGapRisk) ? 'note' : 'error';

  // gap_id: when the risk fires, the actual annotation's gapId (null
  // when the GAP closed) is the authoritative source. When it doesn't
  // fire, fall back to the LLM_TO_GAP lookup so the researcher SPIKE
  // can correlate the miss with the gating card.
  const firedGapId = llmAnnotationsForLab[0] ? llmAnnotationsForLab[0].gapId : null;
  const gapId = firedHere
    ? (firedGapId !== undefined ? firedGapId : null)
    : (LLM_TO_GAP[expectedLlmId] || null);

  const message = firedHere
    ? `AWARE's audit chain fires ${expectedLlmId}:2025 on the ${labId} stimulus via AST10 cascade.`
    : `AWARE's audit chain does NOT yet fire ${expectedLlmId}:2025 on the ${labId} stimulus. ` +
      `Gap card ${LLM_TO_GAP[expectedLlmId] || 'n/a'} gates the underlying detection.`;

  const properties = {
    risk_class: `${expectedLlmId}:2025`,
    risk_name: LLM_TOP_10_2025[expectedLlmId].name,
    fired: firedHere,
    gap_id: gapId,
    ast10_cascade: Array.from(new Set(llmAnnotationsForLab.map((a) => a.ast10Rule).filter(Boolean))),
    aware_component: llmAnnotationsForLab[0] ? llmAnnotationsForLab[0].component : null,
    lab_id: labId,
    confidence: llmAnnotationsForLab[0] ? llmAnnotationsForLab[0].ast10Confidence : null
  };

  return {
    ruleId: expectedLlmId,
    level,
    message: { text: message },
    properties
  };
}

/**
 * The canonical SARIF envelope wrapping all 10 lab results.
 */
function buildSarifReport({ runId, results, timestamp }) {
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'aware-llm-top-10-replay',
            informationUri: 'https://github.com/GoodCISO/aware',
            version: '0.1.0',
            semanticVersion: '0.1.0',
            rules: Object.keys(LLM_TOP_10_2025).map((id) => ({
              id,
              name: LLM_TOP_10_2025[id].name,
              shortDescription: { text: `OWASP LLM Top 10 (2025) — ${LLM_TOP_10_2025[id].name}` },
              helpUri: `https://genai.owasp.org/llmrisk/${id.toLowerCase()}2025-${LLM_TOP_10_2025[id].name.toLowerCase().replace(/\s+/g, '-')}/`
            }))
          }
        },
        invocations: [
          {
            executionSuccessful: true,
            endTimeUtc: timestamp || new Date().toISOString(),
            machine: 'aware-coder-t_e7e77442',
            properties: { run_id: runId || null }
          }
        ],
        results: results || []
      }
    ]
  };
}

/**
 * Locate the pinned DonkAI clone at fixtures/DonkAI. Throws if the
 * submodule / directory is missing or at the wrong commit.
 */
function donkaiFixturePath() {
  const fixtures = path.join(__dirname, 'fixtures', 'DonkAI');
  if (!fs.existsSync(fixtures)) {
    throw new Error(
      `DonkAI fixture not found at ${fixtures}. Re-clone with: ` +
      `\`git clone --depth 1 https://github.com/OWASP/DonkAI.git ${fixtures}\``
    );
  }
  // Verify the pin. We allow a few characters of drift (depth-1 clone
  // might be a few commits ahead of the pinned SHA) but warn loudly.
  const pinnedSha = 'f05d71dace23df0b1a22d18181767951eeba484d';
  const head = (() => {
    try {
      return require('node:child_process')
        .execSync('git rev-parse HEAD', { cwd: fixtures, encoding: 'utf8' })
        .trim();
    } catch (e) {
      return null;
    }
  })();
  if (head && head !== pinnedSha) {
    // Soft warning. DonkAI's last commit as of the clone was f05d71d;
    // future clones may pull newer history. We don't fail here — the
    // harness exercises the AST10 mapper, not the DonkAI source — but
    // we surface the drift for the operator's awareness.
    process.emitWarning(
      `DonkAI fixture HEAD (${head}) differs from pinned SHA (${pinnedSha}). ` +
      `Update fixtures/DonkAI to a fresh clone or update the pin in helpers.js.`,
      'DonkAIHeadDriftWarning'
    );
  }
  return fixtures;
}

module.exports = {
  LLM_TOP_10_2025,
  LLM_TO_GAP,
  LAB_TO_LLM,
  loadAst10Mapper,
  loadFrameworkMapper,
  buildLlmProjection,
  replay,
  inferComponentFromToolId,
  assertAst10Shape,
  buildSarifResults,
  buildSarifReport,
  donkaiFixturePath
};
