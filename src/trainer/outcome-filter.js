// src/trainer/outcome-filter.js — Phase 4 deliverable 1 (ADR-020 618-627)
//
// Filters preference-pair records before they're packaged into a DPO
// training dataset. The "outcome filter" gates process-RL pipeline pairs against
// AZR pass/fail signals — the goal is to keep only pairs whose
// verification outcome is consistent with the preference signal.
//
// The trainer calls this on every record that comes back from
// reading the preference-pair JSONL files referenced by the
// unconsumed aware_conversations rows.
//
// FILTER RULES (configurable via options.rule):
//   - "noop"           — keep all records. Default behavior on dev/legacy
//                        paths; NOT the recommended default in production.
//                        Phase 4 first slice.
//   - "min_score_gap"  — drop records where (chosen.prm_score -
//                        rejected.prm_score) < options.minGap. **Added
//                        2026-06-22 (ADR-029 Repair 1): also drops any
//                        pair where chosen.prm_score ≤ rejected.prm_score
//                        (the "directionality check"), regardless of
//                        magnitude. This catches PRM-inverted pairs
//                        where the "rejected" attempt is actually better.
//                        Same gate as heavy-think's toDpoDataset()'s
//                        minScoreGap, exposed at the filter level so
//                        operators can tune it without code changes.
//   - "tag_match"      — drop records whose task_type is NOT in
//                        options.allowedTaskTypes. Useful for keeping
//                        only math/reasoning pairs and dropping
//                        chitchat.
//   - "azr_result"     — drop process-RL pipeline records whose (task_type,
//                        content_hash) does NOT have a passing
//                        AZR result in options.azrIndex. The index is
//                        a Map<content_hash, {passed, runId, ...}>
//                        pre-loaded by the trainer from
//                        aware_azr_results. Implements ADR-020
//                        Decision 2: "AZR outcome filter gates
//                        process-RL pipeline process training." Records without
//                        any AZR result (no entry in the index) are
//                        KEPT (we don't drop on missing data; the
//                        index starts empty and grows as the first
//                        Modal run completes). Records WITH an entry
//                        that did NOT pass are DROPPED (hard
//                        negative). This is the strict reading of
//                        "AZR pass/fail gates process-RL pipeline".
//
// The output is intentionally a separate function from toDpoDataset:
// toDpoDataset() handles the *intrinsic* quality of a pair (PRM score
// gap, dedup); outcome-filter handles the *meta* question of whether
// this pair should be in the training corpus at all (AZR pass/fail,
// task_type filter, future embedding-similarity filter).
//
// The default rule is "noop" because we have no AZR pass/fail data
// in production yet (the first AZR corpus comes from the first
// Modal training run). When the AZR results table exists and the
// operator has decided a filter rule, the operator flips
// AWARE_TRAINER_FILTER_RULE in the trainer service's env and the
// poller picks it up on the next tick.

/**
 * @typedef {Object} PreferenceRecord
 * @property {string} problem
 * @property {{reasoning: string, prm_score?: number}} chosen
 * @property {{reasoning: string, prm_score?: number}} rejected
 * @property {string} [task_type]
 * @property {string} [_content_hash]
 * @property {Object} [verification] — heavy-think's verification result
 * @property {Object} [azr_result]   — populated when Phase 4 wires up
 *                                      the AZR results table
 */

/**
 * @typedef {FilterOptions}
 * @property {"noop"|"min_score_gap"|"tag_match"|"azr_result"} [rule="min_score_gap"]
 * @property {number} [minGap=0.20] — used when rule="min_score_gap"
 * @property {string[]} [allowedTaskTypes=[]] — used when rule="tag_match"
 * @property {Map<string, {passed: boolean, runId: string, recordedAt: string}>} [azrIndex=new Map()]
 *           — used when rule="azr_result". Keys are content_hash
 *           (matches pair._content_hash and azr_result.content_hash).
 *           Only entries with passed=true should be present in
 *           practice (the trainer filters the query to passed=true
 *           so the index is always a "this passed AZR before" set).
 */

/**
 * @typedef {Object} FilterResult
 * @property {PreferenceRecord[]} kept — records that passed the filter
 * @property {{record: PreferenceRecord, reason: string}[]} dropped
 *           — records that failed, with the human-readable reason
 * @property {{rule: string, totalIn: number, totalKept: number, totalDropped: number}} stats
 */

const VALID_RULES = new Set(['noop', 'min_score_gap', 'tag_match', 'azr_result']);

/**
 * Apply a filter rule to an array of preference records.
 *
 * Pure function — no I/O, no clock, no randomness. Safe to call from
 * tests, from the trainer's main loop, or from a one-off CLI script.
 *
 * @param {PreferenceRecord[]} records
 * @param {FilterOptions} [options]
 * @returns {FilterResult}
 */
export function filterOutcomePairs(records, options = {}) {
  // Default rule is 'min_score_gap' as of 2026-06-22 (ADR-029 Repair 1).
  // The legacy default 'noop' is still available via explicit opt-in:
  // filterOutcomePairs(records, { rule: 'noop' }).
  //
  // Rationale: 'noop' was the original Phase 4 first-slice default when
  // there was no production data. As of 2026-06-22 there is real data
  // (verified live: /data/awareness-pairs/2026-06-22.jsonl has 2 pairs)
  // and PRM scoring is inverted on hedging-vs-hallucination (see ADR-028
  // §Finding 1). Keeping noop as default would let inverted pairs flow
  // through to the trainer. min_score_gap with directionality check
  // catches the inversion as a hard negative.
  const rule = options.rule || 'min_score_gap';
  if (!VALID_RULES.has(rule)) {
    throw new Error(
      `outcome-filter: unknown rule '${rule}', expected one of: ` +
      [...VALID_RULES].join(', ')
    );
  }
  if (!Array.isArray(records)) {
    throw new Error('outcome-filter: records must be an array');
  }

  const kept = [];
  const dropped = [];

  for (const rec of records) {
    if (!rec || typeof rec !== 'object') {
      dropped.push({ record: rec, reason: 'malformed_record' });
      continue;
    }
    const verdict = _applyRule(rule, rec, options);
    // Verdict shape: { action: 'keep'|'drop', reason: string }
    // - 'keep' → record passes the filter
    // - 'drop' + reason → record is dropped, reason is a short
    //   machine-readable string (e.g. 'min_score_gap:0.0200<0.0500')
    //   surfaced in the trainer's debug log
    if (verdict.action === 'keep') {
      kept.push(rec);
    } else {
      dropped.push({ record: rec, reason: verdict.reason });
    }
  }

  return {
    kept,
    dropped,
    stats: {
      rule,
      totalIn: records.length,
      totalKept: kept.length,
      totalDropped: dropped.length,
    },
  };
}

/**
 * Return the canonical list of valid filter rule names. Exposed so
 * config.validate() and the bring-up smoke can assert the set hasn't
 * drifted.
 *
 * @returns {string[]}
 */
export function listFilterRules() {
  return [...VALID_RULES];
}

/**
 * @param {string} rule
 * @param {PreferenceRecord} rec
 * @param {FilterOptions} options
 * @returns {"keep"|string} — "keep" or a short reason string
 */
function _applyRule(rule, rec, options) {
  switch (rule) {
    case 'noop':
      return { action: 'keep' };

    case 'min_score_gap': {
      const chosenScore = rec?.chosen?.prm_score;
      const rejectedScore = rec?.rejected?.prm_score;
      // Missing scores policy changed 2026-06-22 (ADR-029 Repair 1):
      // was 'keep' (lenient, "let downstream decide"), now 'drop'
      // (strict, "we can't verify quality so don't train on it").
      // Rationale: a pair without PRM scores cannot satisfy ADR-024
      // §Precondition 2's "PRM scores from real extraction" clause.
      // Letting such pairs through would train the model on pairs we
      // can't evaluate. Drop and surface the reason in the trainer's
      // debug log so operators can decide whether to re-score.
      if (typeof chosenScore !== 'number' || typeof rejectedScore !== 'number') {
        return { action: 'drop', reason: 'min_score_gap:missing_prm_scores' };
      }
      // Function default raised 2026-06-22 (ADR-029 Repair 1) from
      // 0.05 to 0.20 to match the config default in src/config/index.cjs.
      // The config default takes precedence at runtime (the trainer
      // reads config.trainer.filterMinGap and passes it explicitly),
      // but the function default matters for direct callers (unit tests,
      // ad-hoc CLI scripts, future modules that bypass config).
      const minGap = typeof options.minGap === 'number' ? options.minGap : 0.20;
      const gap = chosenScore - rejectedScore;
      // Directionality check (NEW 2026-06-22, ADR-029 Repair 1):
      // drop any pair where chosen.prm_score ≤ rejected.prm_score.
      // This is a hard negative that catches PRM-inverted pairs
      // regardless of magnitude. Without this check, a pair with
      // chosen=0.51, rejected=0.50 (gap=0.01) would be dropped by
      // the magnitude gate (gap < minGap=0.05), but a pair with
      // chosen=0.50, rejected=0.51 (gap=-0.01) would also be dropped
      // by the magnitude gate — same outcome, correct reasoning.
      // However, a pair with chosen=0.10, rejected=0.50 (gap=-0.40)
      // is also dropped by the magnitude gate. The directionality
      // check makes the "why" explicit in the reason string, which
      // is more useful for operator visibility than a generic
      // "below threshold" message that could equally mean "ties" or
      // "near-ties".
      if (gap <= 0) {
        return { action: 'drop', reason: `min_score_gap:inverted:${gap.toFixed(4)}<=0` };
      }
      // Use a small epsilon to match heavy-think's toDpoDataset convention
      if (gap + 1e-9 < minGap) {
        return { action: 'drop', reason: `min_score_gap:${gap.toFixed(4)}<${minGap}` };
      }
      return { action: 'keep' };
    }

    case 'tag_match': {
      const allowed = Array.isArray(options.allowedTaskTypes)
        ? options.allowedTaskTypes
        : [];
      if (allowed.length === 0) {
        // No allowed types configured → keep all (operator hasn't decided yet)
        return { action: 'keep' };
      }
      if (!rec.task_type || !allowed.includes(rec.task_type)) {
        return { action: 'drop', reason: `tag_match:${rec.task_type || '<unset>'} not in [${allowed.join(',')}]` };
      }
      return { action: 'keep' };
    }

    case 'azr_result': {
      // Phase 4 deliverable 1: gate process-RL pipeline pairs on AZR pass/fail.
      //
      // ADR-020 Decision 2 reading: "AZR pass/fail gates process-RL pipeline
      // process training." The filter's job is to remove pairs that
      // the AZR verifier has explicitly REJECTED, not to require
      // every pair to have been verified. Implementation policy
      // (consistent with the missing-scores policy in
      // min_score_gap):
      //   - azrIndex is a Map<content_hash, {passed, runId, ...}>
      //     pre-loaded by the trainer from the aware_azr_results
      //     table, filtered to passed=true (so the index IS the
      //     "passed AZR before" set).
      //   - Record with a content_hash in azrIndex → verified
      //     PASSED before → KEEP.
      //   - Record with a content_hash NOT in azrIndex → never
      //     verified (the index is small relative to the corpus
      //     for the first few training cycles) → KEEP. Rationale:
      //     dropping on missing data would yield empty datasets
      //     until AZR has been run over the entire corpus, which
      //     defeats the iterative improvement loop. Operators who
      //     want the strict policy should switch the filter rule
      //     to "noop" once they've grown a large enough AZR
      //     index, or implement a separate "require_azr" rule.
      //   - The negative case (AZR-verified AND did not pass) is
      //     excluded by the trainer's query (only passed=true rows
      //     populate the index), so it can never reach the filter.
      const index = options.azrIndex instanceof Map
        ? options.azrIndex
        : new Map();
      const hash = rec._content_hash;
      if (typeof hash !== 'string' || hash.length === 0) {
        // No content hash → can't join → keep.
        return { action: 'keep' };
      }
      if (index.has(hash)) {
        return { action: 'keep' };
      }
      // Unverified → keep (missing-data policy). The verdict is
      // tagged with a 'unverified' marker so the trainer's debug
      // log can surface the count for operator visibility, but it
      // does NOT add to the dropped list.
      return { action: 'keep', reason: 'unverified' };
    }

    default:
      // Should be unreachable due to VALID_RULES check above
      throw new Error(`outcome-filter: unhandled rule '${rule}'`);
  }
}
