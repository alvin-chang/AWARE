# OWASP DonkAI Replay Harness — LLM Top 10 (2025)

This directory scaffolds the replay-harness required by
[ADR-050 §2 decision 5](../../adr/ADR-050-aware-llm-top-10-2025-coverage.md)
and the parent task `t_5983a687` acceptance criterion #3
("at least one DonkAI exercise successfully replayed through AWARE's
audit chain with a confirmed guard event").

The harness exercises **each of the 10 OWASP LLM Top 10 (2025) risks**
against the [DonkAI](https://github.com/OWASP/DonkAI) published lab
corpus (pinned at `f05d71d`; see `fixtures/DonkAI/`) and reports a
SARIF v2.1.0 matrix of `{ risk_class, fired, gap_id? }` per lab.

## Lab → Risk mapping

The DonkAI repo's 10 challenge categories map 1:1 to the 2025 spec.
Source: `fixtures/DonkAI/README.md` §"OWASP LLM Top 10 Coverage",
cross-checked against
[`docs/compliance/llm-top-10.md`](../../compliance/llm-top-10.md) and
ADR-050 §1.2.

| Lab ID | DonkAI file | LLMNN:2025 | Risk name (2025) | Day-one expectation |
|---|---|---|---|---|
| `lab-01-prompt-injection` | `llm01_prompt_injection.py` | **LLM01** | Prompt Injection | **fires** via AST10 `untrusted-instruction-fetch` cascade |
| `lab-02-sensitive-info` | `llm02_sensitive_info.py` | **LLM02** | Sensitive Information Disclosure | **fires** via `tool-access-control` output-pattern detection (LLM02 coverage is M per ADR-050 §6) |
| `lab-03-supply-chain` | `llm03_supply_chain.py` | **LLM03** | Supply Chain | **fires** via AST10 `supply-chain-unknown-publisher` (publisher-key machinery) |
| `lab-04-data-poisoning` | `llm04_data_poisoning.py` | **LLM04** | Data and Model Poisoning | **does not fire** (GAP-2 / GAP-3 architect follow-up; behavioural-baseline flags only) |
| `lab-05-improper-output` | `llm05_improper_output.py` | **LLM05** | Improper Output Handling | **fires** via AST09 `denied-before-dispatch` (LLM05 coverage is H per ADR-050 §6) |
| `lab-06-excessive-agency` | `llm06_excessive_agency.py` | **LLM06** | Excessive Agency | **fires** via AST03 `over-privilege-write` (LLM06 coverage is H per ADR-050 §6) |
| `lab-07-system-prompt-leak` | `llm07_system_prompt_leak.py` | **LLM07** | System Prompt Leakage | **does not fire** — net-new in 2025; GAP-4 child card |
| `lab-08-vector-weaknesses` | `llm08_vector_weaknesses.py` | **LLM08** | Vector and Embedding Weaknesses | **does not fire** — net-new in 2025; GAP-5 architect spike |
| `lab-09-misinformation` | `llm09_misinformation.py` | **LLM09** | Misinformation | **does not fire** — net-new in 2025; GAP-6 child card (`review_required` event type) |
| `lab-10-unbounded-consumption` | `llm10_unbounded_consumption.py` | **LLM10** | Unbounded Consumption | **does not fire** — net-new in 2025; GAP-7 child card (`consumption-budget.js`) |

Day-one coverage matrix: **5 fires** (LLM01, LLM02, LLM03, LLM05, LLM06)
+ **5 misses** (LLM04 architect GAP-3; LLM07/08/09/10 coder GAP-4/5/6/7).
The SARIF report at `test/results/owasp-llm-top-10-replay.sarif` carries
the full matrix with `gap_id` markers.

The 4 "does not fire" rows are the **honest day-one outcome** and the
explicit deliverable of this card: the SARIF matrix names each GAP so
the researcher SPIKE (sibling card under `t_5983a687`) can correlate
the misses with the follow-up work.

## How the harness drives the audit chain

The harness does NOT spin up the coordinator; it uses the same AST10
mapper unit-test pattern (`test/standards/owasp-ast10/helpers.js`) so
it runs in <5s on a developer laptop and CI without Docker. Concretely:

1. **Per-lab fixture**: a single `tool_dispatch` (or other event type
   the lab's risk class exercises) carrying the lab's stimulus.
2. **`replay(event)`** in `helpers.js` classifies the event through
   `src/compliance/ast10-mapper.js` (`classify(mapper, event)`),
   then projects each AST10 annotation onto the LLMNN:2025 IDs that
   the firing AWARE component covers per `AWARE_COMPONENT_MAPPINGS`
   in `src/compliance/framework-mapper.js`.
3. **`buildSarifResults({ labId, llmAnnotations, fired, expectedLlmId })`**
   emits one SARIF `result` per risk class with the gap-id annotation.
4. **The integration test** (`test/integration/replay-llm-top-10.test.js`)
   runs every lab, captures the SARIF envelope, and writes it to
   `test/results/owasp-llm-top-10-replay.sarif` — the input to the
   researcher SPIKE.

## Why AST10 cascade (and not a direct LLM mapper call)

ADR-050 §9 documents the failure mode "AST10 mapper subscribes to a
2025 LLM event but no LLM Top 10 mapper exists yet" as the current
state. The harness reflects that reality:

- AWARE ships `ast10-mapper.js` as the only model-event annotator.
- The framework-mapper `OWASP_LLM_TOP_10` block is **rebound** (GAP-1
  landed on this branch; HEAD `e6c2b95`), but `AWARE_COMPONENT_MAPPINGS`
  rows still reflect v1.1 risk semantics for some components. The
  projection is intentionally tolerant of this drift.
- When GAP-1 fully reconciles the mappings + GAP-4 / GAP-5 / GAP-6 /
  GAP-7 land, the harness is refactored to call a direct LLM
  `classify(event)` instead of projecting from AST10. The L1→L2
  contracts (per the AWARE `coder-contract` skill)
  are preserved: the SARIF `properties` block is the cross-L1 contract.

## DonkAI pin

The fixture is pinned at commit `f05d71d` (last commit on `main`
as of clone time, 2026-07-19). A shallow clone (depth 1) captures
the pin; if upstream history advances past the pin, the harness
emits a `DonkAIHeadDriftWarning` and continues. The harness does not
exercise DonkAI source directly — it only consumes the lab-mapping
table in `fixtures/DonkAI/README.md` — so source drift is a
soft-signal, not a hard failure.

## How to run

```bash
# Per-lab tests (unit-style; <5s total)
npm run test:donkai

# Full replay + SARIF emission (integration; <10s)
npm run test:llm-top-10-standards
```

Both commands exit 0 on day one even with the 4 GAP rows, because the
LLM07/08/09/10 tests are `xit` (not yet) — the SARIF integration test
is the authoritative coverage matrix and DOES run.

## Out of scope

- The 4 GAP child cards (GAP-4 / GAP-6 / GAP-7 — coder; GAP-5 — architect
  spike). When they land, this card's `xit` tests flip to `it` and the
  SARIF report's `fired: true` count rises.
- Training-data provenance attestation (GAP-2) — trainer-swap ADR.
- Behavioural-baseline detection of model poisoning (GAP-3) — depends on
  the DonkAI LLM04 lab's labelled corpus, which is a follow-up ADR.

See ADR-050 §5 for the full GAP registry and §9 for the failure-mode
envelope (upstream renumbering, v1.1/2025 ID confusion, LLM Top 10
mapper absence, reader conflation with AST10 / ASI).

## Related

- Parent ADR: [`docs/adr/ADR-050-aware-llm-top-10-2025-coverage.md`](../../adr/ADR-050-aware-llm-top-10-2025-coverage.md)
- Compliance doc: [`docs/compliance/llm-top-10.md`](../../compliance/llm-top-10.md)
- AST10 test scaffold (precedent): [`test/standards/owasp-ast10/`](../owasp-ast10/)
- AST10 mapper: [`src/compliance/ast10-mapper.js`](../../../src/compliance/ast10-mapper.js)
- Framework mapper: [`src/compliance/framework-mapper.js`](../../../src/compliance/framework-mapper.js)
- DonkAI lab: <https://github.com/OWASP/DonkAI>
