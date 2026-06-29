// src/rlm/aggregate.js — Aggregation prompt + PRM-weighting + parser
//
// Combines child sub-investigation answers into a single, complete answer to
// the original problem. The prompt instructs the LM to weight disagreements
// by PRM score (higher = more trustworthy) but does NOT mathematically
// weight — that's a v2 enhancement. v1 captures PRM scores in the prompt
// so the LM can make a soft judgment.
//
// Per SPEC §6.1 the prompt template is normative. Per §6.3 malformed output
// triggers one stricter-prompt retry, then fallback to the best child by
// PRM score.
//
// Architecture ref: ARCHITECTURE.md §3 (AGGREGATE node), §7 (F5 fallback).

/**
 * @typedef {Object} ChildResult
 * @property {string} problem
 * @property {string} summary
 * @property {number} prm_score
 * @property {number} cost_usd
 * @property {number} depth
 * @property {boolean} [failed]
 */

/**
 * Build the aggregation prompt (system + user).
 * Returns the strict format by default; pass `stricter: true` for retry.
 *
 * @param {Object} opts
 * @param {string} opts.problem - The parent problem
 * @param {ChildResult[]} opts.child_results
 * @param {string} [opts.original_context_view] - What the parent LM saw at this node
 * @param {boolean} [opts.stricter=false] - Stricter retry prompt
 * @param {string} [opts.system_prompt]
 * @returns {{system: string, user: string} | string}
 */
export function buildAggregatePrompt({ problem, child_results, original_context_view, stricter, system_prompt }) {
  const rendered = child_results.map((c, i) =>
    `[${i + 1}] prm_score=${fmt(c.prm_score)} | answer="${escapeQuotes(c.summary)}"`
  ).join('\n');

  const ctxView = original_context_view
    ? `\n\nPARENT CONTEXT VIEW (the parent LM's view at this node):\n${original_context_view}\n`
    : '';

  const user = `You are aggregating the answers of ${child_results.length} sub-investigations into a single, complete answer to the original problem.

ORIGINAL PROBLEM:
${problem}
${ctxView}
SUB-INVESTIGATION ANSWERS (each scored by a Process Reward Model):
${rendered}

INSTRUCTIONS:
1. Identify agreements and disagreements between sub-investigations.
2. When sub-investigations disagree, weight by PRM score (higher = more trustworthy).
3. Produce a single, complete answer to the ORIGINAL problem.
4. If a sub-investigation's PRM score is < 0.3, mention it as low-confidence.
5. Do not introduce claims not supported by at least one sub-investigation.

OUTPUT FORMAT${stricter ? ' (MANDATORY — the SYNTHESIS line is required and must not be empty)' : ''}:
SYNTHESIS: <the complete answer>
CONFIDENCE: <0.0–1.0>
GAPS: <any sub-questions that no sub-investigation adequately answered>`;

  if (system_prompt) {
    return { system: system_prompt, user };
  }
  return user;
}

/**
 * Parse the LM's aggregation output into a structured result.
 *
 * @param {string} text - LM output
 * @returns {{final: string, confidence: number, gaps: string} | null}
 *   null when the SYNTHESIS line is missing or empty (caller treats as
 *   malformed and retries / falls back).
 */
export function parseAggregation(text) {
  if (typeof text !== 'string') return null;

  const stripped = text.replace(/```[\s\S]*?```/g, '').trim();
  if (!stripped) return null;

  // Anchor at line-start, match SYNTHESIS: then capture up to the next
  // section header or end-of-string. Section headers are anchored at line
  // start too (so we don't capture cross-line prose).
  const synMatch = stripped.match(/^SYNTHESIS\s*:\s*([\s\S]*?)(?=^\s*(?:CONFIDENCE|GAPS)\s*:|\s*$)/im);
  if (!synMatch) return null;
  const final = synMatch[1].trim();
  if (!final) return null;

  // Confidence + gaps are optional; defaults applied.
  const confMatch = stripped.match(/^\s*CONFIDENCE\s*:\s*([0-9]*\.?[0-9]+)/im);
  const gapsMatch = stripped.match(/^\s*GAPS\s*:\s*([\s\S]*?)(?=^\s*[A-Z][A-Z\s]+:|\s*$)/im);

  let confidence = confMatch ? parseFloat(confMatch[1]) : 0.5;
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    final,
    confidence,
    gaps: (gapsMatch && gapsMatch[1].trim()) || '',
  };
}

/**
 * Aggregate child results into a final answer.
 *
 * Tries once with the normal prompt; on malformed output retries once with
 * a stricter prompt; on second failure returns the best child by PRM score
 * (with the `partial` / `aggregation_failed` flags set so the caller can
 * detect the fallback).
 *
 * @param {Object} opts
 * @param {string} opts.problem
 * @param {ChildResult[]} opts.child_results
 * @param {string} [opts.original_context_view]
 * @param {Object} opts.client - Must implement { generate(prompt, opts) }
 * @param {string} [opts.system_prompt]
 * @param {(rec: any) => void} [opts.onPair] - Optional callback for audit pair
 * @returns {Promise<{
 *   final: string,
 *   confidence: number,
 *   gaps: string,
 *   cost_usd: number,
 *   retries: number,
 *   fallback: 'none' | 'best_child'
 * }>}
 */
export async function aggregate({
  problem,
  child_results,
  original_context_view,
  client,
  system_prompt,
  onPair,
}) {
  if (!Array.isArray(child_results) || child_results.length === 0) {
    throw new Error('aggregate: child_results must be a non-empty array');
  }

  // Filter out fully-failed children for the prompt (kept for context count).
  const healthy = child_results.filter(c => !c.failed);
  const toRender = healthy.length > 0 ? healthy : child_results;

  let cost_usd = 0;
  let retries = 0;
  let parsed = null;
  let prompt = buildAggregatePrompt({
    problem,
    child_results: toRender,
    original_context_view,
    system_prompt,
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await client.generate(prompt, { task_type: 'standard', role: 'aggregate' });
    const text = out.reasoning || out.text || '';
    cost_usd += out.cost_usd || 0;

    parsed = parseAggregation(text);
    if (parsed) {
      if (attempt > 0) retries = attempt;
      break;
    }
    // Retry with stricter prompt.
    retries = attempt + 1;
    prompt = buildAggregatePrompt({
      problem,
      child_results: toRender,
      original_context_view,
      stricter: true,
      system_prompt,
    });
  }

  if (parsed) {
    if (onPair) {
      onPair({
        problem,
        final: parsed.final,
        confidence: parsed.confidence,
        cost_usd,
        retries,
      });
    }
    return {
      final: parsed.final,
      confidence: parsed.confidence,
      gaps: parsed.gaps,
      cost_usd,
      retries,
      fallback: 'none',
    };
  }

  // Fallback: best child by PRM score.
  const best = [...child_results].sort((a, b) => (b.prm_score || 0) - (a.prm_score || 0))[0];
  return {
    final: best.summary,
    confidence: Math.max(0.1, best.prm_score || 0.1),
    gaps: 'aggregation_failed; returning best child by PRM',
    cost_usd,
    retries,
    fallback: 'best_child',
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0.50';
  return n.toFixed(2);
}

function escapeQuotes(s) {
  return String(s == null ? '' : s).replace(/"/g, '\\"').replace(/\n/g, ' ');
}