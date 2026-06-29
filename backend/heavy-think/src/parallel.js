// src/parallel.js — K parallel reasoning attempts
// Each attempt is a fresh, independent chain-of-thought pass against the same problem.
// We use Promise.all with no shared state between attempts (other than the prompt itself)
// to maximize diversity. The client is responsible for any temperature/topP settings.

const DEFAULT_CONCURRENCY = 8;

export async function parallelReasoning({ problem, K, task_type, context, client, concurrency, system_prompt }) {
  if (K < 1) throw new Error(`parallelReasoning: K must be >= 1, got ${K}`);

  const cap = Math.min(K, concurrency || DEFAULT_CONCURRENCY);
  // MR-HIGH-002 fix: return { system, user } shape so the client can build
  // messages: [{role:'system',...}, {role:'user',...}] — true architectural
  // isolation between system instructions and user input. Callers that
  // don't pass system_prompt fall back to the legacy string-concat shape.
  const prompt = buildReasoningPrompt({ problem, task_type, context, system_prompt });

  const attempts = new Array(K);
  let cost_usd = 0;

  // Run with bounded concurrency. We don't want to fire 8 simultaneous LLM calls
  // against a rate-limited API; the cap is per-call.
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= K) return;
      const attempt = await client.generate(prompt, { task_type, attempt_index: i, K });
      const reasoning = attempt.reasoning || attempt.text || '';
      attempts[i] = { reasoning, attempt_index: i };
      cost_usd += attempt.cost_usd || 0;
    }
  }

  const workers = Array.from({ length: cap }, () => worker());
  await Promise.all(workers);

  return { attempts, cost_usd };
}

function buildReasoningPrompt({ problem, task_type, context, system_prompt }) {
  const ctxStr = context && Object.keys(context).length
    ? `\n\nContext:\n${JSON.stringify(context, null, 2)}`
    : '';

  // MR-HIGH-002 fix: when system_prompt is provided, return { system, user }
  // so the client builds two-role messages. When absent (legacy callers),
  // fall back to the concatenated string shape.
  if (system_prompt) {
    const user = `Problem: ${problem}${ctxStr}\n\nThink step by step. Produce a complete solution.`;
    return { system: system_prompt, user };
  }

  const taskGuidance = TASK_GUIDANCE[task_type] || TASK_GUIDANCE.standard;
  return `${taskGuidance}

Problem: ${problem}${ctxStr}

Think step by step. Produce a complete solution.`;
}

const TASK_GUIDANCE = {
  simple: 'You are a careful, concise problem-solver. Aim for the most direct correct answer.',
  standard: 'You are a thorough, careful problem-solver. Consider multiple angles. Show your reasoning.',
  security: 'You are a security-focused expert. Identify threats, attack vectors, and mitigations. Be exhaustive.',
  financial: 'You are a financial/audit expert. Show calculations, cite constraints, flag risks explicitly.',
  creative: 'You are a creative thinker. Explore non-obvious approaches. Prefer novel solutions to conventional ones.',
};
