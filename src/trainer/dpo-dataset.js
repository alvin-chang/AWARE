// src/trainer/dpo-dataset.js — Phase 4 (ADR (internal) 618-627, ADR (internal) Repair 4)
//
// DPO dataset assembly. Converts filtered preference-pair records into
// DPO training rows in "messages" format, ready for Modal.
//
// This module was extracted from rl-pipeline's expected `toDpoDataset`
// surface (which was documented in redacted-internal-doc and referenced in
// trainer/index.js:593, but never actually exported from rl-pipeline
// — see ADR (internal) §Finding 4). Implementing it in AWARE keeps rl-pipeline
// as a K+S primitive (its actual job) and makes DPO assembly a trainer
// concern (where it logically belongs). The trainer is the only consumer
// of DPO-shaped output; it shouldn't depend on a sibling repo for that
// shape.
//
// Contract:
//   toDpoDataset(records, options) -> { rows, skipped: {lowGap, duplicate, invalid} }
//
//   records: Array<PreferenceRecord> — same shape as outcome-filter.js input:
//     { problem, chosen: {reasoning, prm_score}, rejected: {reasoning, prm_score},
//       _content_hash?: string, [other metadata] }
//
//   options:
//     format: 'messages' (only format supported)
//     minScoreGap: number — drop records where (chosen.prm_score -
//                              rejected.prm_score) < minScoreGap
//     dedupeByHash: boolean — drop records with duplicate _content_hash
//                              (first occurrence wins)
//
//   rows: Array<{ prompt, chosen, rejected }> where each is a
//         [{role: 'user'|'assistant', content: string}] messages array.
//
//   skipped: { lowGap, duplicate, invalid } — counts of records dropped
//            for each reason. Surfaced in trainer's debug log.
//
// The function is pure — no I/O, no clock, no randomness. Safe to call
// from tests, from the trainer's main loop, or from a one-off CLI script.

const SUPPORTED_FORMATS = new Set(['messages']);

/**
 * @typedef {Object} PreferenceRecord
 * @property {string} problem
 * @property {{reasoning: string, prm_score?: number}} chosen
 * @property {{reasoning: string, prm_score?: number}} rejected
 * @property {string} [_content_hash]
 */

/**
 * @typedef {Object} DpoRow
 * @property {Array<{role: string, content: string}>} prompt
 * @property {Array<{role: string, content: string}>} chosen
 * @property {Array<{role: string, content: string}>} rejected
 */

/**
 * @typedef {Object} ToDpoOptions
 * @property {"messages"} [format="messages"]
 * @property {number} [minScoreGap=0.05]
 * @property {boolean} [dedupeByHash=true]
 */

/**
 * @typedef {Object} SkippedStats
 * @property {number} lowGap
 * @property {number} duplicate
 * @property {number} invalid
 */

/**
 * @typedef {Object} ToDpoResult
 * @property {DpoRow[]} rows
 * @property {SkippedStats} skipped
 */

/**
 * Convert preference-pair records into DPO training rows.
 *
 * Pure function — see module docstring for full contract.
 *
 * @param {PreferenceRecord[]} records
 * @param {ToDpoOptions} [options]
 * @returns {ToDpoResult}
 */
export function toDpoDataset(records, options = {}) {
  const format = options.format || 'messages';
  if (!SUPPORTED_FORMATS.has(format)) {
    throw new Error(
      `dpo-dataset: unknown format '${format}', expected one of: ` +
      [...SUPPORTED_FORMATS].join(', ')
    );
  }
  if (!Array.isArray(records)) {
    throw new Error('dpo-dataset: records must be an array');
  }

  const minScoreGap = typeof options.minScoreGap === 'number' ? options.minScoreGap : 0.05;
  const dedupeByHash = options.dedupeByHash !== false; // default true

  const rows = [];
  const skipped = { lowGap: 0, duplicate: 0, invalid: 0 };
  const seenHashes = new Set();

  for (const rec of records) {
    if (!rec || typeof rec !== 'object') {
      skipped.invalid += 1;
      continue;
    }
    const chosenReasoning = rec?.chosen?.reasoning;
    const rejectedReasoning = rec?.rejected?.reasoning;
    if (typeof chosenReasoning !== 'string' || typeof rejectedReasoning !== 'string') {
      skipped.invalid += 1;
      continue;
    }
    const chosenScore = rec?.chosen?.prm_score;
    const rejectedScore = rec?.rejected?.prm_score;
    // minScoreGap filter (matches rl-pipeline's toDpoDataset convention
    // from the original Status.md spec). Records with missing scores
    // pass this gate — the operator's outcome-filter.js handles the
    // "missing scores" policy separately (see ADR (internal) Repair 1).
    if (typeof chosenScore === 'number' && typeof rejectedScore === 'number') {
      const gap = chosenScore - rejectedScore;
      if (gap + 1e-9 < minScoreGap) {
        skipped.lowGap += 1;
        continue;
      }
    }
    // dedupeByHash filter — first occurrence wins. Honors content
    // hash set by rl-pipeline's preference-pair writer.
    if (dedupeByHash && rec._content_hash) {
      if (seenHashes.has(rec._content_hash)) {
        skipped.duplicate += 1;
        continue;
      }
      seenHashes.add(rec._content_hash);
    }
    rows.push({
      prompt: [{ role: 'user', content: rec.problem }],
      chosen: [{ role: 'assistant', content: chosenReasoning }],
      rejected: [{ role: 'assistant', content: rejectedReasoning }],
    });
  }

  return { rows, skipped };
}

/**
 * Return the canonical list of supported output format names. Exposed so
 * config.validate() and the bring-up smoke can assert the set hasn't
 * drifted.
 *
 * @returns {string[]}
 */
export function listDpoFormats() {
  return [...SUPPORTED_FORMATS];
}