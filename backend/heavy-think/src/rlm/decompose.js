// src/rlm/decompose.js — Root decomposition prompt + parser
//
// Prompts the LM to break a problem into ≤branching independent sub-problems.
// Each sub-problem must be self-contained (no dependency on siblings) and
// reference context by REPL handle (e.g. "the function foo in src/x.py"),
// not by pasting content.
//
// Per SPEC §6.4 the decomposition prompt includes 3 hand-curated examples
// (U1 refactor, U6 architecture doc, U7 log debug). Examples are baked in
// (not retrieved) and stable across runs.
//
// Architecture ref: ARCHITECTURE.md §3 (DECOMPOSE node), §7 (failure modes).

/**
 * @typedef {Object} DecomposeOpts
 * @property {string} problem
 * @property {Object} env - Loaded context (output of environment.loadContext)
 * @property {number} branching - Max sub-problems allowed
 * @property {string} [system_prompt]
 */

/**
 * Build the decomposition prompt (system + user message).
 *
 * @param {DecomposeOpts} opts
 * @returns {{system: string, user: string} | string}
 *   - {system, user} when system_prompt is provided (MR-HIGH-002 isolation)
 *   - concatenated string otherwise (legacy HeavySkill shape)
 */
export function buildDecomposePrompt({ problem, env, branching, system_prompt }) {
  const contextShape = describeEnv(env);
  const examples = EXAMPLES.slice(0, 3).join('\n\n');

  const user = `You are decomposing a problem into ${branching} or fewer independent sub-investigations that, together, completely solve the original. Each sub-investigation will be dispatched to a high-quality reasoning primitive.

ORIGINAL PROBLEM:
${problem}

CONTEXT SHAPE (you do not see the full context — it lives in a sandboxed REPL):
${contextShape}

INSTRUCTIONS:
1. Produce 1–${branching} sub-problems whose answers, combined, solve the original.
2. Each sub-problem must be independently answerable (no dependency between sub-problems).
3. Each sub-problem must reference context by REPL handle (e.g. "the function foo in src/x.py"), not by pasting content.
4. Avoid overlap between sub-problems.

OUTPUT FORMAT (strict):
SUB-PROBLEMS:
1. <sub-problem 1>
2. <sub-problem 2>
...
N. <sub-problem N>

If the problem is atomic and should not be decomposed, output a single sub-problem that IS the original problem restated.

EXAMPLES:

${examples}

Now produce the sub-problems for the ORIGINAL PROBLEM above.`;

  if (system_prompt) {
    return { system: system_prompt, user };
  }
  return user;
}

const EXAMPLES = [
  // U1 — refactor recommendation across a repo (SPEC §6.5)
  `EXAMPLE 1 (U1 — refactor across a 200-file repo):
ORIGINAL PROBLEM:
Analyze this Python FastAPI repo and recommend what to refactor. For each recommendation, identify the file, the issue, the proposed change, and the rationale.

CONTEXT SHAPE: directory tree of ~200 Python files across src/, tests/, scripts/.

SUB-PROBLEMS:
1. Survey the src/ tree via REPL 'tree' op; identify the 5 largest files (use len on read()) and list their top-level function/class definitions (use grep for "^def |^class ").
2. Use grep to find duplicated logic across modules (e.g. patterns like "def parse_", "def validate_", "def to_dict") and report the duplicates with file paths and line counts.
3. Examine tests/ with REPL tree + read(); identify modules in src/ that lack corresponding test files; flag each untested module as a refactor candidate.`,

  // U6 — generate architecture doc (SPEC §6.5)
  `EXAMPLE 2 (U6 — architecture doc):
ORIGINAL PROBLEM:
Generate a 30-page architecture document for the AWARE 2.0 platform. Cover: system context, components, data flows, deployment, security model, cost model, future work.

CONTEXT SHAPE: directory tree of adr/ (architecture decision records) plus a top-level README.md and an existing src/ tree.

SUB-PROBLEMS:
1. Read REPL tree to enumerate every ADR under adr/; list them by number and one-line title.
2. For each ADR listed in sub-problem 1, read its first 30 lines via slice() to extract the Context and Decision sections; produce a component-by-component summary.
3. Examine the src/ tree to inventory the runtime modules and their dependency direction; produce the deployment architecture section.`,

  // U7 — debug a long log (SPEC §6.5)
  `EXAMPLE 3 (U7 — debug a 1000-line log):
ORIGINAL PROBLEM:
Find the root cause of the failure described in this log. Identify the failing operation, the cascade, and the first action that would have prevented it.

CONTEXT SHAPE: log file as 0-indexed lines array (~1000 lines from 4 interleaved services).

SUB-PROBLEMS:
1. Use REPL grep for error/fatal/panic/traceback patterns across 'lines'; return the indices and full lines, grouped by service.
2. Read slices around the earliest error indices (use slice(lines, max(0,i-20), i+5)) to reconstruct the call sequence leading to the first failure.
3. Trace the cascade: from the first error forward in time, identify which subsequent errors cite the failing operation (grep for the operation name); produce the cascade chain.`,
];

// ─── High-level wrapper ────────────────────────────────────────────────────

/**
 * Decompose a problem into sub-problems by calling the injected client.
 *
 * @param {Object} opts
 * @param {string} opts.problem
 * @param {Object} opts.env - Output of environment.loadContext
 * @param {number} opts.branching - Max sub-problems allowed
 * @param {Object} opts.client - Must implement { generate(prompt, opts) }
 * @param {string} [opts.system_prompt]
 * @param {number} [opts.maxRetries=1] - Retries on malformed output
 * @returns {Promise<{ subproblems: string[], cost_usd: number, retried: boolean }>}
 *   subproblems is [] when the LM chose not to decompose (atomic problem).
 */
export async function decompose({
  problem,
  env,
  branching,
  client,
  system_prompt,
  maxRetries = 1,
}) {
  if (!client || typeof client.generate !== 'function') {
    throw new Error('decompose: client.generate is required');
  }

  let cost_usd = 0;
  let retried = false;
  let prompt = buildDecomposePrompt({ problem, env, branching, system_prompt });

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const out = await client.generate(prompt, { task_type: 'standard', role: 'decompose' });
    const text = out.reasoning || out.text || '';
    cost_usd += out.cost_usd || 0;

    const subs = parseDecomposition(text, branching);
    if (subs.length > 0) {
      if (attempt > 0) retried = true;
      return { subproblems: subs, cost_usd, retried };
    }

    // Retry with a corrective prompt.
    retried = true;
    prompt =
      `${buildDecomposePrompt({ problem, env, branching, system_prompt })}\n\n` +
      `REMINDER: Output format is strict. Emit a SUB-PROBLEMS: header followed ` +
      `by 1-${branching} numbered sub-problems. If the problem is atomic, restate ` +
      `it as a single sub-problem.`;
  }

  // Malformed twice → return empty (caller treats as atomic / leaf).
  return { subproblems: [], cost_usd, retried: true };
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse the LM's decomposition output into an array of sub-problem strings.
 * Robust to prose around the SUB-PROBLEMS block, code fences (we extract
 * the content INSIDE the fences rather than discarding it), and numbering
 * variations ("1." vs "1)" vs "- ").
 *
 * @param {string} text - LM output
 * @param {number} maxSubproblems
 * @returns {string[]} - 0..maxSubproblems sub-problems. [] means "atomic".
 */
export function parseDecomposition(text, maxSubproblems) {
  if (typeof text !== 'string') return [];

  // First: try to extract content inside the first code fence (if any).
  // Many LMs wrap the structured output in a fence.
  const fenceMatch = text.match(/```(?:[a-zA-Z]*\n)?([\s\S]*?)```/);
  let candidates;
  if (fenceMatch && /SUB[-\s]?PROBLEMS/i.test(fenceMatch[1])) {
    candidates = [fenceMatch[1], text.replace(/```[\s\S]*?```/g, '').trim()];
  } else {
    // Strip fences only when they don't contain the SUB-PROBLEMS block.
    candidates = [text.replace(/```[\s\S]*?```/g, '').trim()];
  }

  // Accept numbered ("1." / "1)") or bulleted ("- " / "* ") lines.
  const lineRe = /^\s*(?:\d+[.)]|[-*])\s+(.+?)\s*$/;

  for (const body of candidates) {
    if (!body) continue;
    const headerMatch = body.match(/^[\s\S]*?\bSUB[-\s]?PROBLEMS\s*:?\s*$/im);
    const after = headerMatch
      ? body.slice(headerMatch.index + headerMatch[0].length)
      : body;

    const subproblems = [];
    for (const rawLine of after.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      // Stop at section headers like "OUTPUT:" / "ANSWER:" / "EXAMPLES:".
      if (/^[A-Z][A-Z\s]+:/.test(line)) break;
      const m = line.match(lineRe);
      if (m) {
        const sp = m[1].trim();
        if (sp) subproblems.push(sp);
        if (subproblems.length >= maxSubproblems) break;
      }
    }

    if (subproblems.length > 0) return subproblems.slice(0, maxSubproblems);
  }

  return [];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function describeEnv(env) {
  if (!env) return '(no context)';
  return env.summary || `${env.kind} context`;
}
