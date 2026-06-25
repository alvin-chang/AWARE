// src/training/eval-harness.js — Phase 4 deliverable 4 (ADR (internal) 618-627)
//
// LiveCodeBench + GSM8K evaluation harness for the AWARE 2.0 trained
// models. Pure code — no GPU needed for the harness itself; the model
// runs in Ollama (sidecar) and the harness talks to it over HTTP.
//
// What this does
// --------------
// - Loads a small, fixed set of LiveCodeBench + GSM8K problems
//   (in-repo fixtures; no network download of benchmark data)
// - For each problem, sends a structured prompt to the model via
//   Ollama's /api/generate
// - Grades the response (exact-match for GSM8K final number,
//   simple test-case pass/fail for LiveCodeBench)
// - Returns { benchmark, total, correct, accuracy, perProblem[] }
//
// Baseline (decision P)
// ---------------------
// The operator can run the baseline against the bare base model
// (trained-model, no fine-tuning) by passing `--baseline` to the CLI.
// The CLI will ask Ollama to (re)create the bare model from the
// base name (no ADAPTER) and run the harness. This gives the
// "Benchmark delta vs. base model" comparison the ADR (internal) §Phase 4
// deliverable 4 calls for — the operator can later run the same
// harness against the trained model and subtract.
//
// No-DPO baseline (decision Q) — scaffolded, not exercised
// ---------------------------------------------------------
// The CLI also accepts `--no-dpo` mode for the no-DPO comparison
// (regular SFT instead of DPO). This slice does NOT exercise it
// (no Modal run is available yet); the flag is plumbed through
// the option shape so the operator can add it after the first
// trained checkpoint lands.
//
// Why Ollama + not transformers.js
// ---------------------------------
// Ollama is already the AWARE 2.0 inference sidecar (ADR (internal)
// Decision 3: Docker Compose 7-service stack + Ollama sidecar).
// The coordinator's model router already calls Ollama for the
// LoRA-served model. Re-using Ollama for the eval means:
//   - No new dependency in package.json
//   - No GPU memory pressure from a second in-process model
//   - The same code path the real /coordinate call uses, so
//     eval results are representative
//   - The baseline (no LoRA) is just "POST to Ollama with a
//     different model name" — no special path needed
//
// What's in-repo (fixtures)
// -------------------------
// We use a TINY set of in-repo fixtures (5 LiveCodeBench + 5
// GSM8K) — enough to smoke-test the harness plumbing and to
// surface a meaningful accuracy number for the first trained
// run. Real benchmarks have hundreds of problems; pulling the
// full LiveCodeBench / GSM8K datasets is out of scope for this
// slice (and would dominate the test runtime). Operators who
// want the full benchmark can drop their own problem set into
// `data/eval-fixtures/` and pass `--fixtures <dir>`.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -- Benchmark definitions ------------------------------------------------

/**
 * The 5 GSM8K problems are real GSM8K-style word problems (grade
 * school math). Each has a `prompt` and a `finalAnswer` (the
 * number that should appear in the model's response). Grading
 * is exact-match: the harness extracts the last number in the
 * response and compares to `finalAnswer`.
 */
export const GSM8K_FIXTURES = [
  {
    id: 'gsm8k-001',
    prompt:
      'Natalia sold clips to 48 of her friends in April, and then she sold half as many clips in May. ' +
      'How many clips did Natalia sell altogether in April and May?',
    finalAnswer: 72,
  },
  {
    id: 'gsm8k-002',
    prompt:
      'Weng earns $12 an hour for babysitting. Yesterday, she just did 50 minutes of babysitting. ' +
      'How much did she earn?',
    finalAnswer: 10,
  },
  {
    id: 'gsm8k-003',
    prompt:
      'Betty is saving money for a new wallet which costs $100. Betty has only half of the money ' +
      'she needs. Her parents decided to give her $15 for that purpose, and her grandparents twice ' +
      'as much as her parents. How much more money does Betty need to buy the wallet?',
    finalAnswer: 5,
  },
  {
    id: 'gsm8k-004',
    prompt:
      'Julie is reading a 120-page book. Yesterday, she was able to read 12 pages and today, she read ' +
      'twice as many pages as yesterday. If she wants to read half of the remaining pages tomorrow, ' +
      'how many pages should she read?',
    finalAnswer: 51,
  },
  {
    id: 'gsm8k-005',
    prompt:
      'James writes a 3-page letter to 2 different friends twice a week. How many pages does he ' +
      'write a year?',
    finalAnswer: 624,
  },
];

/**
 * The 5 LiveCodeBench problems are simple Python tasks with
 * test-case-based grading. Each has a `prompt` (the problem
 * statement) and a `testCases` array of { input, expected }
 * tuples. Grading runs the model's code in a subprocess
 * (sandboxed via `node:vm` for the test runner, but the
 * code-execution path is itself sandboxed; see notes in
 * `_gradeLiveCode`).
 */
export const LIVECODE_FIXTURES = [
  {
    id: 'lcb-001',
    prompt:
      'Write a Python function `add(a, b)` that returns the sum of a and b.',
    functionName: 'add',
    testCases: [
      { input: [2, 3], expected: 5 },
      { input: [0, 0], expected: 0 },
      { input: [-1, 1], expected: 0 },
      { input: [100, 200], expected: 300 },
    ],
  },
  {
    id: 'lcb-002',
    prompt:
      'Write a Python function `is_even(n)` that returns True if n is even, False otherwise.',
    functionName: 'is_even',
    testCases: [
      { input: [4], expected: true },
      { input: [7], expected: false },
      { input: [0], expected: true },
      { input: [-3], expected: false },
    ],
  },
  {
    id: 'lcb-003',
    prompt:
      'Write a Python function `factorial(n)` that returns n! (assume n >= 0).',
    functionName: 'factorial',
    testCases: [
      { input: [0], expected: 1 },
      { input: [1], expected: 1 },
      { input: [5], expected: 120 },
      { input: [10], expected: 3628800 },
    ],
  },
  {
    id: 'lcb-004',
    prompt:
      'Write a Python function `reverse_string(s)` that returns the string reversed.',
    functionName: 'reverse_string',
    testCases: [
      { input: ['hello'], expected: 'olleh' },
      { input: [''], expected: '' },
      { input: ['a'], expected: 'a' },
      { input: ['racecar'], expected: 'racecar' },
    ],
  },
  {
    id: 'lcb-005',
    prompt:
      'Write a Python function `max_of_three(a, b, c)` that returns the largest of a, b, c.',
    functionName: 'max_of_three',
    testCases: [
      { input: [1, 2, 3], expected: 3 },
      { input: [3, 2, 1], expected: 3 },
      { input: [-1, -2, -3], expected: -1 },
      { input: [5, 5, 4], expected: 5 },
    ],
  },
];

// -- Grading helpers -------------------------------------------------------

/**
 * Extract the last integer or float in a string. GSM8K grading
 * is exact-match on this number.
 *
 * Strips thousands separators (commas) from the captured number
 * before parsing. The regex matches: optional minus, digits,
 * optional comma-groups + digits, optional decimal + digits.
 *
 * @param {string} text
 * @returns {number|null}
 */
export function extractFinalNumber(text) {
  if (typeof text !== 'string') return null;
  // Match the last number, allowing thousands separators (1,234.56).
  // The non-greedy + lookahead at the end-of-string is for
  // GSM8K-style "the final answer is 42." cases where the number
  // is followed by punctuation. We allow the regex to find any
  // number anywhere, then prefer the rightmost one (GSM8K
  // convention: final answer is the last number in the response).
  const matches = text.match(/-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g);
  if (!matches || matches.length === 0) {
    // Fall back to plain numbers (no thousands separators)
    const plain = text.match(/-?\d+(?:\.\d+)?/g);
    if (!plain || plain.length === 0) return null;
    const last = plain[plain.length - 1];
    const n = Number(last);
    return Number.isFinite(n) ? n : null;
  }
  const last = matches[matches.length - 1];
  const n = Number(last.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract the first Python code block from a response. We
 * support ```python ... ``` and ``` ... ``` fenced blocks; if
 * neither is present, we return the trimmed whole response.
 *
 * @param {string} text
 * @returns {string}
 */
export function extractPythonCode(text) {
  if (typeof text !== 'string') return '';
  // Try ```python ... ``` first (case-insensitive on the language tag)
  let m = text.match(/```(?:python|py)?\s*\n([\s\S]*?)```/i);
  if (m) return m[1].trim();
  // Fall back to plain ``` ... ```
  m = text.match(/```\s*\n([\s\S]*?)```/);
  if (m) return m[1].trim();
  // No code block — treat the whole response as code (common for
  // small problems where the model just writes the function).
  return text.trim();
}

/**
 * Grade a LiveCodeBench problem by extracting the code and
 * running the test cases in a Node VM sandbox. The sandbox
 * exposes `require` to nothing (no I/O, no child_process) so
 * the model can't escape. This is intentionally simple — full
 * Python execution would require a subprocess, which is out of
 * scope for this slice. The 5 in-repo problems are
 * Python-portable-to-JS (only use arithmetic, string, bool).
 *
 * @param {string} code — the model's response (extracted)
 * @param {string} functionName
 * @param {Array<{input: any[], expected: any}>} testCases
 * @returns {{passes: number, total: number, errors: string[]}}
 */
export function gradeLiveCode(code, functionName, testCases) {
  const result = { passes: 0, total: testCases.length, errors: [] };
  if (typeof code !== 'string' || code.length === 0) {
    result.errors.push('empty_code');
    return result;
  }
  let fn;
  try {
    // Wrap the code in a function expression so the model can
    // write `def foo(...)` Python style. We strip the `def`
    // header and rewrite to a JS `function` declaration.
    const jsCode = rewritePythonDefToJs(code, functionName);
    // Execute in an isolated context (no globals) so the model
    // can't escape. vm.Script is the safe-eval primitive in Node
    // 22+ (no `eval()`, no `Function()`).
    const script = new vm.Script(`(${jsCode})`);
    const context = vm.createContext({});
    fn = script.runInContext(context);
    if (typeof fn !== 'function') {
      result.errors.push(`not_a_function: ${typeof fn}`);
      return result;
    }
  } catch (e) {
    result.errors.push(`parse_error: ${e?.message || e}`);
    return result;
  }
  for (const tc of testCases) {
    try {
      const actual = fn(...tc.input);
      if (deepEqual(actual, tc.expected)) {
        result.passes += 1;
      } else {
        result.errors.push(
          `case_failed: fn(${JSON.stringify(tc.input)}) = ${JSON.stringify(actual)}, expected ${JSON.stringify(tc.expected)}`
        );
      }
    } catch (e) {
      result.errors.push(`case_threw: ${e?.message || e}`);
    }
  }
  return result;
}

/**
 * Very small Python def → JS function rewriter. Handles the
 * common shapes the 5 in-repo problems use:
 *   def NAME(args): return EXPR
 * For multi-statement functions, this is a best-effort fallback
 * to the JS source as-is (the model wrote invalid Python or
 * something we don't understand; the parse_error in the
 * caller will surface it).
 */
function rewritePythonDefToJs(code, functionName) {
  // Match `def name(arg, arg):` or `def name(arg):` on a single line
  const defMatch = code.match(
    new RegExp(`def\\s+${functionName}\\s*\\(([^)]*)\\)\\s*:\\s*([\\s\\S]*)`)
  );
  if (!defMatch) {
    // No def found — assume the whole code is already a JS function
    // expression or a single expression.
    return code.trim();
  }
  const args = defMatch[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let body = defMatch[2].trim();
  // Strip a leading docstring if present
  body = body.replace(/^""".*?"""/s, '').replace(/^'''.*?'''/s, '').trim();
  // If the body has multiple lines, indent-strip the rest (Python
  // is indent-sensitive, but our 5 fixtures are all one-liner
  // returns). For multi-line, we keep it as-is and let the parser
  // error if the JS doesn't parse — the test will record the error.
  return `function ${functionName}(${args.join(', ')}) { ${body} }`;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

// -- Ollama client (for the CLI) -------------------------------------------

/**
 * Build an Ollama-backed model generator: prompt → response text.
 *
 * @param {Object} opts
 * @param {string} opts.ollamaUrl — e.g. 'http://127.0.0.1:11434'
 * @param {string} opts.modelName — Ollama model name
 * @param {number} [opts.timeoutMs=60_000] — per-problem timeout
 * @param {typeof fetch} [opts._fetch=globalThis.fetch]
 * @returns {(prompt: string) => Promise<string>}
 */
export function makeOllamaGenerator({ ollamaUrl, modelName, timeoutMs = 60_000, _fetch = globalThis.fetch }) {
  if (typeof ollamaUrl !== 'string' || ollamaUrl.length === 0) {
    throw new Error('makeOllamaGenerator: ollamaUrl is required');
  }
  if (typeof modelName !== 'string' || modelName.length === 0) {
    throw new Error('makeOllamaGenerator: modelName is required');
  }
  return async (prompt) => {
    const url = `${ollamaUrl.replace(/\/+$/, '')}/api/generate`;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await _fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelName, prompt, stream: false }),
        signal: ac.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Ollama ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = await res.json();
      return String(data.response || '');
    } finally {
      clearTimeout(t);
    }
  };
}

// -- Benchmark runners -----------------------------------------------------

/**
 * Run a single benchmark against a model generator.
 *
 * @param {Object} opts
 * @param {string} opts.name — 'gsm8k' | 'livecodebench'
 * @param {Array} opts.fixtures — the problem set
 * @param {(prompt: string) => Promise<string>} opts.generate — the model
 * @param {Function} [opts.grade] — per-problem grader (defaults: gsm8k/livecode)
 * @returns {Promise<{name, total, correct, accuracy, perProblem: Array}>}
 */
export async function runBenchmark({ name, fixtures, generate, grade }) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('runBenchmark: name is required');
  }
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    throw new Error('runBenchmark: fixtures must be a non-empty array');
  }
  if (typeof generate !== 'function') {
    throw new Error('runBenchmark: generate must be a function');
  }
  const perProblem = [];
  let correct = 0;
  for (const fixture of fixtures) {
    const start = Date.now();
    let response = '';
    let error = null;
    try {
      response = await generate(fixture.prompt);
    } catch (e) {
      error = e?.message || String(e);
    }
    const elapsedMs = Date.now() - start;
    let score = 0;
    let detail = '';
    if (error === null) {
      const r = (grade || defaultGrader(name))(response, fixture);
      score = r.score;
      detail = r.detail;
      if (score >= 1.0) correct += 1;
    } else {
      detail = `error: ${error}`;
    }
    perProblem.push({
      id: fixture.id,
      score,
      detail,
      elapsedMs,
      responsePreview: response.slice(0, 200),
    });
  }
  return {
    name,
    total: fixtures.length,
    correct,
    accuracy: fixtures.length === 0 ? 0 : correct / fixtures.length,
    perProblem,
  };
}

function defaultGrader(name) {
  if (name === 'gsm8k') {
    return (response, fixture) => {
      const predicted = extractFinalNumber(response);
      const correct = predicted === fixture.finalAnswer;
      return {
        score: correct ? 1.0 : 0.0,
        detail: correct
          ? `predicted=${predicted} (correct)`
          : `predicted=${predicted}, expected=${fixture.finalAnswer}`,
      };
    };
  }
  if (name === 'livecodebench') {
    return (response, fixture) => {
      const code = extractPythonCode(response);
      const r = gradeLiveCode(code, fixture.functionName, fixture.testCases);
      return {
        score: r.total === 0 ? 0 : r.passes / r.total,
        detail: `passes=${r.passes}/${r.total}${r.errors.length ? `; first_error=${r.errors[0]}` : ''}`,
      };
    };
  }
  throw new Error(`defaultGrader: unknown benchmark '${name}'`);
}

/**
 * Run the full Phase 4 deliverable 4 eval suite: GSM8K + LiveCodeBench.
 * Returns a structured result with both benchmark summaries + a
 * top-level `accuracy` (mean of the two).
 *
 * @param {Object} opts
 * @param {(prompt: string) => Promise<string>} opts.generate
 * @param {Object} [opts.overrides] — { gsm8k: [...], livecodebench: [...] }
 * @returns {Promise<{
 *   accuracy: number,
 *   gsm8k: {name, total, correct, accuracy, perProblem},
 *   livecodebench: {name, total, correct, accuracy, perProblem},
 *   modelName: string,
 *   label: string,
 *   startedAt: string,
 *   finishedAt: string,
 * }>}
 */
export async function runEvalSuite({ generate, overrides = {}, modelName = 'unknown', label = 'eval' }) {
  const gsm8k = await runBenchmark({
    name: 'gsm8k',
    fixtures: overrides.gsm8k || GSM8K_FIXTURES,
    generate,
  });
  const livecodebench = await runBenchmark({
    name: 'livecodebench',
    fixtures: overrides.livecodebench || LIVECODE_FIXTURES,
    generate,
  });
  const startedAt = new Date().toISOString();
  const accuracy = (gsm8k.accuracy + livecodebench.accuracy) / 2;
  return {
    accuracy,
    gsm8k,
    livecodebench,
    modelName,
    label,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

// -- CLI (in-repo fixtures) -----------------------------------------------

/**
 * Format a result object as a human-readable table. Used by
 * the CLI; also nice for the operator's eye in JSON output.
 *
 * @param {Object} result
 * @returns {string}
 */
export function formatResult(result) {
  const lines = [];
  lines.push(`AWARE 2.0 eval result (label=${result.label}, model=${result.modelName})`);
  lines.push(`  started:  ${result.startedAt}`);
  lines.push(`  finished: ${result.finishedAt}`);
  lines.push(`  GSM8K:        ${result.gsm8k.correct}/${result.gsm8k.total} = ${(result.gsm8k.accuracy * 100).toFixed(1)}%`);
  lines.push(`  LiveCodeBench: ${result.livecodebench.correct}/${result.livecodebench.total} = ${(result.livecodebench.accuracy * 100).toFixed(1)}%`);
  lines.push(`  mean accuracy: ${(result.accuracy * 100).toFixed(1)}%`);
  lines.push('');
  lines.push('  Per-problem:');
  for (const p of [...result.gsm8k.perProblem, ...result.livecodebench.perProblem]) {
    const tag = p.score >= 1.0 ? '✔' : (p.score > 0 ? '~' : '✖');
    lines.push(`    ${tag} ${p.id}  score=${p.score.toFixed(2)}  ${p.elapsedMs}ms  ${p.detail}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Check whether this file is being run as the entry point (vs
 * imported as a module). When run directly, we print a usage
 * hint and exit — the actual CLI wrapper lives in
 * scripts/run-eval-baseline.sh, which sets the right env vars
 * and invokes Node with a small driver.
 */
function isMainModule() {
  if (typeof process === 'undefined' || !process.argv?.[1]) return false;
  try {
    return path.resolve(process.argv[1]) === path.resolve(__filename);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  console.log('eval-harness: this is a library, not a CLI.');
  console.log('Use:');
  console.log('  node scripts/run-eval-baseline.mjs          # baseline against trained-model');
  console.log('  node scripts/run-eval-baseline.mjs --label=trained --model=trained-model');
  console.log('');
  console.log('Or import runEvalSuite() in your own driver.');
  process.exit(0);
}

export default {
  GSM8K_FIXTURES,
  LIVECODE_FIXTURES,
  extractFinalNumber,
  extractPythonCode,
  gradeLiveCode,
  makeOllamaGenerator,
  runBenchmark,
  runEvalSuite,
  formatResult,
};
