#!/usr/bin/env node
// scripts/run-eval-baseline.mjs — Phase 4 deliverable 4 (ADR-020 618-627)
//
// CLI driver for the eval harness. Default mode is the P baseline
// (bare trained-model, no fine-tuning). Operators can override the
// model name (e.g. the trained `trained-model`) to compare
// against the trained checkpoint.
//
// Usage:
//   node scripts/run-eval-baseline.mjs                                  # baseline
//   node scripts/run-eval-baseline.mjs --label=trained \
//        --model=trained-model                                    # trained
//   node scripts/run-eval-baseline.mjs --fixtures=./my-fixtures --label=trained-v2
//
// Env vars (all optional):
//   OLLAMA_URL              default: http://127.0.0.1:11434
//   AWARE_EVAL_TIMEOUT_MS   default: 60_000 (per problem)
//   AWARE_EVAL_OUTPUT_DIR   default: ./eval-results (created if missing)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  makeOllamaGenerator,
  runEvalSuite,
  formatResult,
  GSM8K_FIXTURES,
  LIVECODE_FIXTURES,
} from '../src/training/eval-harness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tiny argv parser (no dependency, handles --flag=value + --flag value)
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        out[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          out[a.slice(2)] = next;
          i++;
        } else {
          out[a.slice(2)] = true;
        }
      }
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
  const timeoutMs = Number(process.env.AWARE_EVAL_TIMEOUT_MS || 60_000);
  const outputDir = process.env.AWARE_EVAL_OUTPUT_DIR || path.join(process.cwd(), 'eval-results');
  const modelName = String(args.model || process.env.AWARE_EVAL_MODEL || 'qwen2.5:7b');
  const label = String(args.label || process.env.AWARE_EVAL_LABEL || 'baseline');
  const fixturesDir = args.fixtures ? path.resolve(String(args.fixtures)) : null;

  // Optional: load custom fixtures from a directory.
  // Each file is JSON with shape { id, prompt, finalAnswer?, functionName?, testCases? }
  // Filename is informational; id from the JSON is the canonical key.
  let overrides = {};
  if (fixturesDir) {
    const { readdir, readFile } = await import('node:fs/promises');
    const files = (await readdir(fixturesDir)).filter((f) => f.endsWith('.json'));
    const gsm = [];
    const lcb = [];
    for (const f of files) {
      const full = path.join(fixturesDir, f);
      const data = JSON.parse(await readFile(full, 'utf8'));
      if (typeof data.functionName === 'string' && Array.isArray(data.testCases)) {
        lcb.push(data);
      } else if (typeof data.finalAnswer === 'number') {
        gsm.push(data);
      }
    }
    overrides = { gsm8k: gsm, livecodebench: lcb };
    console.log(`Loaded custom fixtures: ${gsm.length} gsm8k, ${lcb.length} livecodebench from ${fixturesDir}`);
  } else {
    console.log(`Using in-repo fixtures: ${GSM8K_FIXTURES.length} gsm8k + ${LIVECODE_FIXTURES.length} livecodebench`);
  }

  console.log(`AWARE 2.0 eval driver`);
  console.log(`  ollamaUrl:  ${ollamaUrl}`);
  console.log(`  model:      ${modelName}`);
  console.log(`  label:      ${label}`);
  console.log(`  timeout:    ${timeoutMs}ms per problem`);
  console.log('');

  const generate = makeOllamaGenerator({ ollamaUrl, modelName, timeoutMs });

  // Connectivity probe — fail fast with a clear error if Ollama
  // isn't reachable. We send a tiny /api/generate and check the
  // response is parseable.
  try {
    const probe = await generate('Reply with just the word OK.');
    if (!probe || typeof probe !== 'string') {
      throw new Error(`Ollama returned empty response: ${JSON.stringify(probe)}`);
    }
    console.log(`  connectivity: ok (probe response: ${JSON.stringify(probe.slice(0, 30))})`);
  } catch (e) {
    console.error(`ERROR: cannot reach Ollama at ${ollamaUrl}: ${e?.message || e}`);
    console.error(`Is Ollama running? Try: docker compose -p aware-2 up -d ollama`);
    process.exit(2);
  }
  console.log('');

  // Run the full suite
  const result = await runEvalSuite({
    generate,
    overrides,
    modelName,
    label,
  });

  // Print + persist
  const text = formatResult(result);
  process.stdout.write(text);

  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(outputDir, `${stamp}-${label}.json`);
  const txtPath = path.join(outputDir, `${stamp}-${label}.txt`);
  await writeFile(jsonPath, JSON.stringify(result, null, 2));
  await writeFile(txtPath, text);
  console.log(`Wrote: ${jsonPath}`);
  console.log(`Wrote: ${txtPath}`);
}

main().catch((e) => {
  console.error('FATAL:', e?.stack || e);
  process.exit(1);
});
