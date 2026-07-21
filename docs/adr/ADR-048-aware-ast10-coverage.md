# ADR-048 — AST10 Risk-to-Control Coverage and Verification Contract

**Status:** Proposed (2026-07-14)
**Author:** Archimedes (architect)
**Baseline:** ADR-043 (`ADR-043-aware-ast10-compliance.md`)
**Upstream:** OWASP Agentic Skills Top 10 v1.0, commit `0e5a4c0601e41f1f6eda14da1017034c0bd9cbfb`

## 1. Context

ADR-043 established AST10 as an AWARE compliance framework and specified the first seven annotation rules. It is the broad integration decision. This ADR is a layered refinement rather than an edit to ADR-043 because the baseline already has implementations and citations, while this document fixes a narrower invariant: every AST10 claim must trace from an observed guard signal through one mapper rule into one or more decision-chain records and an executable test.

The implementation currently emits one `AST10Annotation` per matching rule. A source event can therefore fan out to multiple sibling decision records with the same `parentDecisionId`. The mapper is an annotator, not a scanner or policy decision point.

## 2. Decision

1. Keep ADR-043 unchanged as the framework baseline. This ADR defines the coverage and verification layer beneath it.
2. Treat AST01, AST06, and AST08 as explicit gaps until the controls below produce source events and dedicated mapper rules. Do not claim runtime detection from a cross-class proxy.
3. Preserve the existing seven rules unchanged. New AST06 and AST08 rules require implementation and review under this ADR; AST01 requires the same scanner result used for AST08, but a distinct rule for provenance or malicious-content findings.
4. A single source event may emit several annotation records. Each record must have the source event's `decisionId` as `parentDecisionId`; annotation shape and decision-record shape must remain complete.
5. The standards suite under `test/standards/owasp-ast10/` is wired into the existing Node test harness by the `npm run test:ast10-standards` script. The default unit command remains unchanged until the new controls are implemented.

## 3. Coverage map

Common annotation shape for every firing rule:

`{ sourceDecisionId, eventType, matchedClasses:[ASTnn], evidence:{toolId?,target?,parametersHash,agentId?,role?}, classification:{rule,confidence,reference}, timestamp }`

Common annotation `DecisionRecord` fields populated by `classifyAndLog`:

- `decisionId`: fresh UUID
- `parentDecisionId`: source `decisionId`
- `timestamp`: annotation timestamp
- `actor`: supplied actor or `{agentId, trustScore}` fallback
- `action`: `{type:'ast10_annotation', target:'ASTnn', reason:<rule>, annotation:<shape>}`
- `context`: `{pheromoneScores:{}, heuristicWeights:{}, policyId:'ast10-mapper', policyVersion:'1.0.0'}`
- `outcome`: `{success:true, latencyMs:0, errorMessage:null}`
- `prevHash` and `hash`: assigned by `decision-logger.js`

| Class | Risk | Guard hook / classifier string | Mapper rule | Annotation-specific evidence | DecisionRecord-specific values | Test path |
|---|---|---|---|---|---|---|
| AST01 | Skill provenance and malicious content | Proposed scanner gateway: `SKILL_SCAN_MALICIOUS` or `SKILL_PROVENANCE_UNVERIFIED` at skill-load | **Gap:** proposed `malicious-or-unproven-skill` | scanner, finding IDs, artifact hash, publisher identity | target `AST01`; reason `malicious-or-unproven-skill` | `ast01.test.js` (gap contract) |
| AST02 | Supply-chain compromise | Skill-load identity binding; `permission-model` deny reasons `ROLE_NOT_FOUND`, `DENIED_BY_ROLE`, `NOT_IN_ALLOW_LIST` are contextual but do not replace publisher verification | `supply-chain-unknown-publisher` | agentId, target, parametersHash; absence of `actor.publisherKey` | target `AST02`; reason `supply-chain-unknown-publisher` | `ast02.test.js` |
| AST03 | Memory/context poisoning and over-privileged writes | `amg-client.scan`; sensitive target classifier `AGENTS.md|SOUL.md|MEMORY.md`; permission deny `DENIED_BY_ROLE` / `NOT_IN_ALLOW_LIST` | `over-privilege-write` | toolId, canonical target, parametersHash | target `AST03`; reason `over-privilege-write` | `ast03.test.js`; `fanout-memory-denial.test.js` |
| AST04 | Cascading misuse / undeclared manifest capability | Tool observation before dispatch; shell classifier plus manifest `permissions.network !== true` | `manifest-undeclared-network` | toolId, target, parametersHash | target `AST04`; reason `manifest-undeclared-network` | `ast04.test.js` |
| AST05 | Identity / privilege confusion through untrusted external instruction | Tool observation; fetch-tool classifier and host allowlist | `untrusted-instruction-fetch` | toolId, target, parametersHash | target `AST05`; reason `untrusted-instruction-fetch` | `ast05.test.js` |
| AST06 | Sandbox and isolation failure | Proposed `sandbox-policies` decision routed through `ToolObservationProxy`; classifier `AWARE_SANDBOX_DENY` with namespace/profile evidence | **Gap:** proposed `sandbox-boundary-violation` | sandbox profile, requested/effective namespace, host escape capability, toolId | target `AST06`; reason `sandbox-boundary-violation` | `ast06.test.js` (gap contract) |
| AST07 | Goal/update hijack through unpinned skill load | Skill-load manifest validation; missing `content_hash` | `update-without-pinning` | target, parametersHash | target `AST07`; reason `update-without-pinning` | `ast07.test.js`; `fanout-skill-load.test.js` |
| AST08 | Skill scanning/reconnaissance gap | Proposed scanner adapter before activation; classifier `SKILL_SCAN_FAILED` or `SKILL_SCAN_UNAVAILABLE` | **Gap:** proposed `skill-scan-finding` | scanner, scanner version, artifact hash, finding IDs/severity | target `AST08`; reason `skill-scan-finding` | `ast08.test.js` (gap contract) |
| AST09 | Human-agent trust exploitation / absent governance | Permission decision receipt; `AWARE_DENY:` prefix | `denied-before-dispatch` | toolId, target, parametersHash | target `AST09`; reason `denied-before-dispatch` | `ast09.test.js`; `fanout-memory-denial.test.js` |
| AST10 | Resource/cost and cross-platform amplification | Skill-load origin observation | `cross-platform-skill-load` | target, parametersHash; origin format when supplied | target `AST10`; reason `cross-platform-skill-load` | `ast10.test.js`; `fanout-skill-load.test.js` |

Risk labels above follow the research input pack's operational grouping. The mapper and catalog IDs remain authoritative if upstream wording changes.

## 4. AST06 control decision

Route sandbox policy decisions through `ToolObservationProxy` as first-class source events before execution. The producer must emit:

- `action.type = 'sandbox_policy_decision'`
- `action.toolId`, requested sandbox profile, effective namespace/profile, and host capabilities
- denial error prefix `AWARE_SANDBOX_DENY:`
- a stable policy/version in `context`

Add mapper rule `sandbox-boundary-violation` only for a denied boundary crossing or a verified requested/effective isolation mismatch. Do not infer AST06 from generic tool observations.

Rationale: the proxy is already the universal pre-dispatch observation point. Reusing it preserves one source of truth for audit events and avoids a second sandbox-only chain writer.

Failure mode: if the proxy or annotation logger fails, sandbox enforcement still decides independently; annotation failure is surfaced as telemetry and remains fail-open for annotation only. The sandbox policy itself must retain its configured fail policy. Detection: count sandbox decisions against AST06 annotations. Recovery: replay source decision records after mapper restoration.

## 5. AST08 control decision

Integrate NVIDIA SkillSpector first, behind a narrow scanner adapter invoked before skill activation. The adapter contract is vendor-neutral:

`scan({artifactPath, artifactHash, manifest}) -> {scanner, scannerVersion, verdict, findings[]}`

Pin the scanner version and ruleset. Emit `skill_scan_result` source events containing hashes and finding metadata, never raw skill contents. Add `skill-scan-finding` for non-clean findings and a separate operational health signal for `SKILL_SCAN_UNAVAILABLE`. Cisco `skill-scanner` remains a replaceable second implementation of the same adapter, not a parallel mandatory scanner.

Rationale: SkillSpector is the concrete open-source candidate named by the AST10 baseline, while an adapter keeps the decision reversible. Running two scanners immediately adds disagreement handling before evidence shows it is useful.

Failure mode: scanner unavailable or timeout. Default policy for new/untrusted skills is fail closed before activation; explicitly allowlisted and previously hash-verified skills may use cached results. Detection: scanner health, queue age, and `SKILL_SCAN_UNAVAILABLE` counts. Recovery: restore scanner, rescan the immutable artifact hash, then activate. Scanner results are evidence, not proof of safety.

## 6. Cross-class fan-out verification

Two executable invariants are required:

1. One unpinned, unsigned `skill_load` source event emits AST02, AST07, and AST10 annotations. All three have the same `sourceDecisionId` and their decision records have the same `parentDecisionId`, while each record has its own `decisionId`.
2. One denied `MEMORY.md` write emits AST03 (`over-privilege-write`) and AST09 (`denied-before-dispatch`). Both share the source and have complete annotation and DecisionRecord field shapes.

Tests must assert the class set exactly for the specified fixture, not merely `includes`, so accidental rule fan-out is visible.

## 7. Rollout and reversibility

1. Land this ADR and standards scaffold.
2. Implement AST06 source events and rule behind the existing AST10 annotation toggle; verify in shadow mode.
3. Implement the scanner adapter and AST08/AST01 rules behind a separate scan-enforcement toggle; start with reporting, then enforce fail-closed for new untrusted skills.
4. Promote the standards suite into the default test command only after the gap tests become implementation tests.
5. Roll back by disabling the two toggles; source decision records remain readable and mapper rules are additive.

This change does not alter agent permissions or APTS tier eligibility today. Enforcing AST06 or AST08 later can improve evidence for tier eligibility, but must not silently promote an agent tier.

## 8. Failure modes

- **Source event is not written:** no annotation can be trusted. Detect source/annotation count divergence; recover by restoring the producer and replaying immutable records where available.
- **One mapper rule throws:** preserve the originating decision and other rule results; expose an annotation error metric. Never fabricate coverage.
- **Multiple annotations lose their source link:** chain verification fails if any `parentDecisionId` differs from `sourceDecisionId`. Quarantine the compliance report and replay after repair.
- **Scanner produces false negatives:** retain explicit confidence and scanner version; use runtime controls independently. A clean scan never bypasses permission or sandbox enforcement.
- **Scanner or sandbox policy blocks too broadly:** disable the new enforcement toggle, not the audit chain; retain source records for review.
- **Upstream AST10 changes:** pin this map to the cited commit and update by a reviewed ADR amendment or successor.

## 9. Consequences

Positive: each coverage claim has an observable hook, rule, record shape, and test. AST06 and AST08 now have concrete, reversible implementation paths.

Cost: the standards suite duplicates some unit-rule fixtures intentionally. Unit tests verify mapper mechanics; standards tests verify the compliance contract and cross-class invariants.

**Known gaps:** AST01, AST06, and AST08 remain non-covered until their proposed rules and producers ship. This ADR does not modify `src/compliance/ast10-mapper.js`.

## 12. APTS tier implication (per ADR-049)

This ADR closes the AST01 / AST06 / AST08 gaps in the AST10 coverage
map but **does not change the APTS tier claim** in ADR-049. The
T1 Foundation (partial) claim and the PASS / PARTIAL / GAP / N/A
counts in ADR-049 §7 stand unchanged. Concretely:

- **AST06 source events** (`sandbox_policy_decision` →
  `sandbox-boundary-violation`): the AST10 rule fires and writes an
  annotation, but the **sandbox policy's own fail policy is
  unchanged** (still the operator's choice; not promoted to
  fail-closed by this ADR). The new rule produces evidence that
  *could* support a future APTS-AR-019 / APTS-SE-013 PARTIAL → PASS
  upgrade, but does not trigger it today.
- **AST08 source events** (`skill_scan_result` →
  `skill-scan-finding`): the rule fires only when the scanner
  returns a pinned, non-clean verdict. **Fail-closed for new /
  untrusted skills when the scanner is unavailable** is the policy
  the SkillActivationGate enforces — but the `enableAST08Annotation`
  toggle defaults OFF and SkillSpector is not pinned at runtime
  today, so no production activation path is currently
  scanner-gated. Future evidence: enable the toggle and wire a
  pinned executable → APTS-TP-014 / APTS-TP-016 PARTIAL → PASS
  candidates.
- **AST01 annotations** (`malicious-or-unproven-skill`): shares the
  AST08 scanner-result path. Same posture as AST08 — no production
  path fires today.

A future ADR may promote parts of the AST10 map into PASS rows for
APTS claims, but doing so requires (a) the toggles enabled in
production with a pinned scanner executable, (b) a sample window of
real scan results showing the annotation path is wired end-to-end,
and (c) an explicit tier-claim amendment in ADR-049. This ADR
provides the implementation; the tier claim is a downstream
decision.
