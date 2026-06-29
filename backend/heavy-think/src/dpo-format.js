// src/dpo-format.js — Convert HeavySkill JSONL preference pairs to DPO training format
// Output is consumable by TRL, Axolotl, and Unsloth DPO trainers.
//
// The HeavySkill JSONL format (see src/preference-pair.js) is:
//   { ts, problem, task_type, chosen: { reasoning, prm_score },
//     rejected: { reasoning, prm_score }, all_attempts: [...],
//     verification: { method, passed, duration_ms },
//     cost: { attempts_usd, refinement_usd, judge_usd },
//     _content_hash: "..." }
//
// The DPO format the trainer wants is:
//   { prompt: string, chosen: string, rejected: string, ...optional metadata }
//
// We also produce a "raw" DPO format (just the three fields) and a "messages"
// format compatible with chat-style trainers (chosen/rejected as full message
// lists instead of plain strings). Pick what your trainer expects.

/**
 * Convert one HeavySkill record to DPO training row.
 *
 * @param {Object} record — HeavySkill JSONL record
 * @param {Object} [opts]
 * @param {'raw'|'messages'} [opts.format='raw'] — output shape
 * @param {string} [opts.systemPrompt] — prepend a system prompt to the prompt field
 * @param {boolean} [opts.includeMetadata=true] — include ts, task_type, prm_scores, cost
 * @returns {Object} DPO row: { prompt, chosen, rejected, ...metadata }
 */
export function toDpoRow(record, opts = {}) {
  if (!record || !record.problem) {
    throw new Error('toDpoRow: record.problem is required');
  }
  if (!record.chosen || !record.rejected) {
    throw new Error('toDpoRow: record.chosen and record.rejected are required');
  }
  if (!record.chosen.reasoning || !record.rejected.reasoning) {
    throw new Error('toDpoRow: chosen.reasoning and rejected.reasoning are required');
  }

  const format = opts.format || 'raw';
  const includeMetadata = opts.includeMetadata !== false;
  const systemPrompt = opts.systemPrompt || null;

  if (format === 'raw') {
    const row = {
      prompt: buildPromptText(record.problem, systemPrompt, record.task_type),
      chosen: record.chosen.reasoning,
      rejected: record.rejected.reasoning,
    };
    if (includeMetadata) {
      Object.assign(row, extractMetadata(record));
    }
    return row;
  }

  if (format === 'messages') {
    // Chat-style: prompt is a user message, chosen/rejected are assistant messages
    const userContent = buildPromptText(record.problem, systemPrompt, record.task_type);
    const row = {
      prompt: [{ role: 'user', content: userContent }],
      chosen: [{ role: 'assistant', content: record.chosen.reasoning }],
      rejected: [{ role: 'assistant', content: record.rejected.reasoning }],
    };
    if (includeMetadata) {
      Object.assign(row, extractMetadata(record));
    }
    return row;
  }

  throw new Error(`toDpoRow: unknown format '${format}', expected 'raw' or 'messages'`);
}

/**
 * Convert an array of HeavySkill records to a DPO training dataset.
 * Filters out records that don't satisfy a minimum quality threshold
 * (e.g. PRM score too close together — DPO needs a clear preference signal).
 *
 * @param {Object[]} records
 * @param {Object} [opts] — same as toDpoRow, plus:
 * @param {number} [opts.minScoreGap=0.05] — minimum (chosen.prm_score - rejected.prm_score)
 * @param {boolean} [opts.dedupeByHash=true] — skip records whose _content_hash is already seen
 * @returns {{ rows: Object[], skipped: { lowGap: number, duplicate: number } }}
 */
export function toDpoDataset(records, opts = {}) {
  const minScoreGap = opts.minScoreGap ?? 0.05;
  const dedupeByHash = opts.dedupeByHash !== false;

  const rows = [];
  const seenHashes = new Set();
  const skipped = { lowGap: 0, duplicate: 0, invalid: 0 };

  for (const rec of records) {
    try {
      if (dedupeByHash && rec._content_hash) {
        if (seenHashes.has(rec._content_hash)) {
          skipped.duplicate++;
          continue;
        }
        seenHashes.add(rec._content_hash);
      }

      const gap = (rec.chosen.prm_score ?? 0) - (rec.rejected.prm_score ?? 0);
      // Use a small epsilon to avoid floating-point edge cases (e.g. 0.9 - 0.8 = 0.0999...)
      if (gap + 1e-9 < minScoreGap) {
        skipped.lowGap++;
        continue;
      }

      rows.push(toDpoRow(rec, opts));
    } catch {
      skipped.invalid++;
    }
  }

  return { rows, skipped };
}

/**
 * Convert a HeavySkill JSONL file (or stream of records) to a DPO JSONL file.
 *
 * @param {string} inputPath — source JSONL path
 * @param {string} outputPath — destination JSONL path
 * @param {Object} [opts] — passed to toDpoDataset
 * @returns {Promise<{ written: number, skipped: { lowGap: number, duplicate: number, invalid: number } }>}
 */
export async function convertFile(inputPath, outputPath, opts = {}) {
  const { readFile, writeFile } = await import('node:fs/promises');
  const text = await readFile(inputPath, 'utf8');
  const records = text
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));

  const { rows, skipped } = toDpoDataset(records, opts);

  const out = rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  await writeFile(outputPath, out, 'utf8');

  return { written: rows.length, skipped };
}

function buildPromptText(problem, systemPrompt, taskType) {
  const parts = [];
  if (systemPrompt) parts.push(systemPrompt);
  if (taskType && taskType !== 'standard') parts.push(`[task: ${taskType}]`);
  parts.push(problem);
  return parts.join('\n\n');
}

function extractMetadata(record) {
  return {
    _ts: record.ts,
    _task_type: record.task_type,
    _chosen_prm_score: record.chosen.prm_score,
    _rejected_prm_score: record.rejected.prm_score,
    _verification_passed: record.verification?.passed ?? null,
    _verification_method: record.verification?.method ?? null,
    _cost_usd: (record.cost?.attempts_usd ?? 0) + (record.cost?.refinement_usd ?? 0) + (record.cost?.judge_usd ?? 0),
  };
}
