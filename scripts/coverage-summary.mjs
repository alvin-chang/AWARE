#!/usr/bin/env node
// scripts/coverage-summary.mjs
//
// Reads ./coverage/lcov.info (produced by c8 --reporter=lcov) and prints
// a per-file coverage table to stdout. Designed for operator CI logs
// and the bring-up smoke (scripts/bring-up-coordinator.sh).
//
// Usage:
//   npm run coverage:summary      # runs c8 + this script
//   node scripts/coverage-summary.mjs  # just this script (after c8)
//
// Exit code: always 0 (this is a reporter, not a gate — the actual
// ≥80% gate is a separate slice). To enforce, run with
// c8 --check-coverage --lines 80.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LCOV_PATH = resolve(__dirname, '..', 'coverage', 'lcov.info');

if (!existsSync(LCOV_PATH)) {
  console.error(`✗ ${LCOV_PATH} not found. Run 'npm run coverage' first.`);
  process.exit(1);
}

const lcov = readFileSync(LCOV_PATH, 'utf8');
const records = lcov.split('end_of_record').map(r => r.trim()).filter(Boolean);

const rows = [];
for (const rec of records) {
  const sf = rec.match(/^SF:(.+)$/m);
  const lf = rec.match(/^LF:(\d+)$/m);
  const lh = rec.match(/^LH:(\d+)$/m);
  if (!sf || !lf || !lh) continue;
  const file = sf[1].trim();
  const found = Number(lf[1]);
  const hit = Number(lh[1]);
  const pct = found > 0 ? (hit / found) * 100 : 100;
  rows.push({ file, found, hit, pct });
}

rows.sort((a, b) => a.pct - b.pct);

// Print the table
const COLOR = process.stdout.isTTY;
const c = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s) => c('32', s);
const yellow = (s) => c('33', s);
const red = (s) => c('31', s);
const bold = (s) => c('1', s);

const colorFor = (pct) => {
  if (pct >= 80) return green;
  if (pct >= 60) return yellow;
  return red;
};

const fileWidth = Math.max(20, ...rows.map(r => r.file.length));
const header = `  ${'File'.padEnd(fileWidth)}  ${'Lines'.padStart(8)}  ${'Hit'.padStart(8)}  ${'Pct'.padStart(7)}`;
const sep = '─'.repeat(header.length);

console.log(bold('\nAWARE 2.0 coverage summary (v2 source paths only)'));
console.log(sep);
console.log(header);
console.log(sep);
for (const r of rows) {
  const shortFile = r.file.replace(process.cwd() + '/', '');
  const line = `  ${shortFile.padEnd(fileWidth)}  ${String(r.found).padStart(8)}  ${String(r.hit).padStart(8)}  ${(r.pct.toFixed(1) + '%').padStart(7)}`;
  console.log(colorFor(r.pct)(line));
}
console.log(sep);

const totalFound = rows.reduce((s, r) => s + r.found, 0);
const totalHit = rows.reduce((s, r) => s + r.hit, 0);
const totalPct = totalFound > 0 ? (totalHit / totalFound) * 100 : 100;
const verdict = totalPct >= 80 ? green('✓ ≥80%') : yellow('! <80% — separate slice to enforce the gate');
console.log(bold(`  TOTAL${' '.repeat(fileWidth - 5)}  ${String(totalFound).padStart(8)}  ${String(totalHit).padStart(8)}  ${(totalPct.toFixed(1) + '%').padStart(7)}`) + `  ${verdict}`);
console.log(sep);
console.log(green(`HTML report: coverage/index.html`));
console.log(green(`lcov.info:   coverage/lcov.info`));
console.log('');
