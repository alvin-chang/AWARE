#!/usr/bin/env bash
# scripts/eval-delta.sh — Phase 4 D5: compute the trained-vs-baseline delta.
#
# Reads the most recent eval-results/*-baseline.json and *-trained.json
# (written by `npm run eval:baseline` and `npm run eval:trained` respectively),
# computes the per-benchmark and aggregate accuracy delta, and prints a
# PASS/FAIL verdict against the ADR-020 Phase 4 D5 acceptance criterion
# (trained.mean ≥ baseline.mean + 0.03).
#
# Usage:
#   ./scripts/eval-delta.sh                       # picks newest baseline + newest trained
#   ./scripts/eval-delta.sh --target=0.03         # override the +3pp target
#   ./scripts/eval-delta.sh --results-dir=./foo   # use a different output dir
#
# Env vars (all optional):
#   AWARE_EVAL_OUTPUT_DIR  default: ./eval-results
#   AWARE_EVAL_TARGET_PP   default: 0.03  (the +3pp threshold from ADR-020)
#
# Exit codes:
#   0 = PASS (delta ≥ target)
#   1 = FAIL (delta < target, or missing inputs)
#   2 = operator error (bad args, missing files)

set -euo pipefail

# ─── Defaults ────────────────────────────────────────────────────────
OUTPUT_DIR="${AWARE_EVAL_OUTPUT_DIR:-./eval-results}"
TARGET_PP="${AWARE_EVAL_TARGET_PP:-0.03}"
TARGET_PCT="$(awk -v t="$TARGET_PP" 'BEGIN{printf "%.1f", t*100}')"

# ─── Arg parse ──────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --target=*)    TARGET_PP="${arg#*=}"; TARGET_PCT="$(awk -v t="$TARGET_PP" 'BEGIN{printf "%.1f", t*100}')" ;;
    --results-dir=*) OUTPUT_DIR="${arg#*=}" ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "unknown arg: $arg" >&2
      exit 64
      ;;
  esac
done

# ─── Color helpers ──────────────────────────────────────────────────
if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YEL=$'\033[33m'
  C_BLU=$'\033[34m'; C_DIM=$'\033[2m'; C_RST=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_YEL=""; C_BLU=""; C_DIM=""; C_RST=""
fi
ok()   { printf '%s✓%s %s\n' "$C_GREEN" "$C_RST" "$*"; }
warn() { printf '%s!%s %s\n' "$C_YEL" "$C_RST" "$*"; }
fail() { printf '%s✗%s %s\n' "$C_RED" "$C_RST" "$*" >&2; exit 1; }
step() { printf '\n%s==>%s %s\n' "$C_BLU" "$C_RST" "$*"; }

# ─── Find newest files ──────────────────────────────────────────────
if [ ! -d "$OUTPUT_DIR" ]; then
  fail "output dir '$OUTPUT_DIR' does not exist. Run: npm run eval:baseline && npm run eval:trained"
fi

# Sort by filename (timestamps are ISO-like so lexical sort = chronological).
BASELINE_JSON=$(ls -1 "$OUTPUT_DIR"/*-baseline.json 2>/dev/null | sort | tail -1 || true)
TRAINED_JSON=$(ls -1 "$OUTPUT_DIR"/*-trained.json 2>/dev/null | sort | tail -1 || true)

if [ -z "$BASELINE_JSON" ]; then
  fail "no *-baseline.json in $OUTPUT_DIR. Run: npm run eval:baseline"
fi
if [ -z "$TRAINED_JSON" ]; then
  fail "no *-trained.json in $OUTPUT_DIR. Run: npm run eval:trained (after the trainer produces weights)"
fi

step "Inputs"
log_n() { printf '  %-22s %s\n' "$1" "$2"; }
log_n "baseline" "$(basename "$BASELINE_JSON")"
log_n "trained"  "$(basename "$TRAINED_JSON")"
log_n "target"   "≥ +${TARGET_PCT}pp aggregate accuracy"

# ─── Parse JSONs (no jq dependency — use node) ─────────────────────
read_scores() {
  node -e '
    const fs = require("node:fs");
    const path = process.argv[1];
    const r = JSON.parse(fs.readFileSync(path, "utf8"));
    const acc = (b) => (b && typeof b.accuracy === "number") ? b.accuracy : NaN;
    const out = {
      gsm8k: acc(r.gsm8k),
      livecodebench: acc(r.livecodebench),
      mean: (typeof r.accuracy === "number") ? r.accuracy : NaN,
      label: r.label || path.split("/").pop(),
    };
    process.stdout.write(JSON.stringify(out));
  ' "$1"
}

BASELINE=$(read_scores "$BASELINE_JSON")
TRAINED=$(read_scores "$TRAINED_JSON")

# ─── Compute deltas ─────────────────────────────────────────────────
node -e '
  const b = JSON.parse(process.argv[1]);
  const t = JSON.parse(process.argv[2]);
  const target = parseFloat(process.argv[3]);

  const fmt = (n) => (Number.isFinite(n) ? (n * 100).toFixed(1) + "pp" : "n/a");
  const delta = (bAcc, tAcc) => {
    if (!Number.isFinite(bAcc) || !Number.isFinite(tAcc)) return NaN;
    return tAcc - bAcc;
  };

  const dGsm = delta(b.gsm8k, t.gsm8k);
  const dLcb = delta(b.livecodebench, t.livecodebench);
  const dMean = delta(b.mean, t.mean);

  const verdict = Number.isFinite(dMean) && dMean >= target ? "PASS" : "FAIL";

  const row = (name, bAcc, tAcc, d) =>
    `  ${name.padEnd(13)} ${fmt(bAcc).padStart(7)} → ${fmt(tAcc).padStart(7)}    ${(Number.isFinite(d) ? (d >= 0 ? "+" : "") + (d*100).toFixed(1) + "pp" : "n/a").padStart(7)}`;

  console.log("");
  console.log("  benchmark         baseline   trained    delta");
  console.log("  ──────────────── ──────── ──────── ────────");
  console.log(row("gsm8k",         b.gsm8k, t.gsm8k, dGsm));
  console.log(row("livecodebench", b.livecodebench, t.livecodebench, dLcb));
  console.log(row("mean",          b.mean, t.mean, dMean));
  console.log("");
  console.log("  ADR-020 Phase 4 D5 target: aggregate mean ≥ baseline.mean + " + (target*100).toFixed(1) + "pp");
  console.log("  verdict: " + verdict);
  process.exit(verdict === "PASS" ? 0 : 1);
' "$BASELINE" "$TRAINED" "$TARGET_PP"
