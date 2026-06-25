#!/usr/bin/env bash
# collect-runtime-evidence.sh — Items 18/19 evidence collection
#
# Standardized transcript generator for the AWARE v2.5.0 rollout SOP.
# Run AFTER the bring-up script has confirmed all services healthy.
# Produces:
#   evidence/v2.5.0-staging-bringup-<date>.md  — operator checklist evidence
#
# Requirements:
#   - AWARE stack running on default ports (18081 = coordinator, 3000 = gateway)
#   - AWARE_BRINGUP_OK=1 already set in your bring-up env
#   - AWARE_COORDINATOR_TOKEN set in env (for /coordinate auth)
#
# This script does NOT require a live MiniMax API key for item 19
# (audit-log HTTP query). For item 18 (real /coordinate call),
# either a live LLM backend OR a reachable Ollama instance is required.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EVIDENCE_DIR="$REPO_ROOT/evidence"
mkdir -p "$EVIDENCE_DIR"
DATE_TAG="$(date -u +%Y-%m-%d)"
OUT="$EVIDENCE_DIR/v2.5.0-staging-bringup-${DATE_TAG}.md"

COORD_URL="${AWARE_COORDINATOR_URL:-http://127.0.0.1:18081}"
GATEWAY_URL="${AWARE_GATEWAY_URL:-http://127.0.0.1:3000}"
TOKEN_VAR='AWARE_COORDINATOR_TOKEN'
TOKEN="${!TOKEN_VAR:-}"
if [[ -z "$TOKEN" ]]; then
  echo "::error::AWARE_COORDINATOR_TOKEN is not set. Source your canonical credential store first." >&2
  exit 2
fi

HDR_TOKEN="$(printf 'Bearer %s' "$TOKEN")"

{
  echo '# AWARE v2.5.0 Staging Bring-up Evidence'
  echo
  echo "**Date:** $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "**Operator:** ${USER}"
  echo "**Coordinator URL:** $COORD_URL"
  echo "**Gateway URL:** $GATEWAY_URL"
  echo
  echo '---'
  echo

  echo '## Gate 1 — Health & Version'
  echo
  echo '```bash'
  echo "$ curl -sS $COORD_URL/version"
  echo
  VERSION_RESP=$(curl -sS -m 5 "$COORD_URL/version" || echo 'FAILED')
  echo "$VERSION_RESP"
  echo '```'
  echo
  echo '```bash'
  echo "$ curl -sS $COORD_URL/health"
  echo
  HEALTH_RESP=$(curl -sS -m 5 "$COORD_URL/health" || echo 'FAILED')
  echo "$HEALTH_RESP"
  echo '```'
  echo
  if echo "$HEALTH_RESP" | grep -q '"ok":true'; then
    HEALTH_VERDICT='PASS'
  else
    HEALTH_VERDICT='FAIL'
  fi
  echo "**Verdict:** $HEALTH_VERDICT"
  echo

  echo '## Gate 2 — Item 18: Real /coordinate call'
  echo
  echo '```bash'
  echo "$ curl -sS -X POST $COORD_URL/coordinator \\"
  echo "    -H \"$(printf 'Authorization: Bearer %s' 'REDACTED-AT-RUNTIME')\\\" \\"
  echo "    -H \"Content-Type: application/json\\\" \\"
  echo "    -d '{\"problem\": \"evidence-collection-probe\", \"task_type\": \"standard\", \"K\": 1}'"
  echo
  COORD_HTTP=$(curl -sS -o /tmp/coord_resp.json -w '%{http_code}' -X POST "$COORD_URL/coordinate" \
    -H "$HDR_TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"problem": "evidence-collection-probe", "task_type": "standard", "K": 1}' || echo 'FAILED')
  COORD_BODY=$(cat /tmp/coord_resp.json 2>/dev/null || echo 'FAILED')
  echo "HTTP_STATUS: $COORD_HTTP"
  echo "$COORD_BODY"
  echo '```'
  echo
  if echo "$COORD_BODY" | grep -q '"ok":true'; then
    COORD_VERDICT='PASS'
  else
    COORD_VERDICT='FAIL'
  fi
  echo "**HTTP Status:** $COORD_HTTP"
  echo "**Verdict:** $COORD_VERDICT"
  if [[ "$COORD_VERDICT" == 'FAIL' ]]; then
    echo
    echo '> **FAILURE LOG:** If /coordinate fails, the most likely causes are:'
    echo '> 1. AWARE_MODE=online but LLM_API_KEY not set (coordinator refuses to boot)'
    echo '> 2. AWARE_MODE=hybrid/offline but no Ollama instance reachable at OLLAMA_URL'
    echo '> 3. AWARE_COORDINATOR_TOKEN mismatch (403)'
    echo '> 4. Coordinator healthcheck passed but /coordinate fails (router fell through all backends)'
  fi
  echo

  echo '## Gate 3 — Item 19: Decision-log HTTP query'
  echo
  echo '```bash'
  echo "$ curl -sS $COORD_URL/api/audit/chain"
  echo
  CHAIN_RESP=$(curl -sS -m 5 "$COORD_URL/api/audit/chain" || echo 'FAILED')
  echo "$CHAIN_RESP"
  echo '```'
  echo
  echo '```bash'
  echo "$ curl -sS $COORD_URL/api/audit/verify"
  echo
  VERIFY_RESP=$(curl -sS -m 5 "$COORD_URL/api/audit/verify" || echo 'FAILED')
  echo "$VERIFY_RESP"
  echo '```'
  echo
  if echo "$VERIFY_RESP" | grep -q '"valid":true'; then
    CHAIN_VERDICT='PASS'
  else
    CHAIN_VERDICT='FAIL'
  fi
  echo "**Verdict:** $CHAIN_VERDICT"
  echo

  echo '## Gate 4 — Audit retention dry-run'
  echo
  echo '```bash'
  echo '$ npm run audit:retention:cleanup -- --dry-run'
  echo
  RETENTION_OUT=$(cd "$REPO_ROOT" && npm run audit:retention:cleanup -- --dry-run 2>&1 || echo 'FAILED')
  echo "$RETENTION_OUT"
  echo '```'
  echo
  if echo "$RETENTION_OUT" | grep -qE 'OK|exit.*0|chain archived|no records'; then
    RET_VERDICT='PASS'
  else
    RET_VERDICT='REVIEW'
  fi
  echo "**Verdict:** $RET_VERDICT"
  echo

  echo '## Summary'
  echo
  echo '| Gate | Status |'
  echo '|---|---|'
  echo "| 1 — Health & Version | $HEALTH_VERDICT |"
  echo "| 2 — Item 18 /coordinate | $COORD_VERDICT |"
  echo "| 3 — Item 19 audit HTTP | $CHAIN_VERDICT |"
  echo "| 4 — Retention dry-run | $RET_VERDICT |"
  echo
  if [[ "$COORD_VERDICT" == 'PASS' && "$CHAIN_VERDICT" == 'PASS' ]]; then
    echo '**Overall:** READY FOR CUTOVER'
  else
    echo '**Overall:** PAUSE — investigate failed gates'
  fi
} > "$OUT"

echo "Evidence written to: $OUT"
echo
cat "$OUT"
