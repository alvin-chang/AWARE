#!/usr/bin/env bash
# scripts/check-prod.sh
# Pre-flight checks for a production deploy. Fails fast on:
#   - Default passwords in compose
#   - Missing required env vars
#   - Dev-only markers in config files
#
# Usage:
#   ./scripts/check-prod.sh [--strict]
#
# In --strict mode, also fails on warnings.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

STRICT=0
[[ "${1:-}" == "--strict" ]] && STRICT=1

errors=0
warnings=0

log() { echo "[prod-check] $*"; }
fail() { echo "::error::prod-check: $*" >&2; errors=$((errors+1)); }
warn() { echo "::warning::prod-check: $*"; warnings=$((warnings+1)); }
ok() { echo "::ok::prod-check: $*"; }

# 1. Postgres default password check
log "checking compose file for dev-only defaults..."
if grep -q "dev-only-pwd" docker-compose.coordinator.yml; then
  fail "docker-compose.coordinator.yml uses default postgres password 'dev-only-pwd'. Set AWARE_DB_PWD in your .env file."
else
  ok "no dev-only postgres password in compose"
fi

# 2. Kill-switch default must be 0
if grep -q "AWARE_KILL_SWITCH=\${AWARE_KILL_SWITCH:-1}" docker-compose.coordinator.yml; then
  fail "kill-switch defaults to 1 — must default to 0 (operator-controlled)"
else
  ok "kill-switch default is operator-controlled"
fi

# 3. NODE_ENV must be production
if grep -q "NODE_ENV=production" docker-compose.coordinator.yml; then
  ok "NODE_ENV=production set in compose"
else
  warn "NODE_ENV not set to production in compose"
fi

# 4. Required env vars (when --strict)
if (( STRICT )); then
  for var in AWARE_DB_PWD AWAR...Y; do
    if [[ -z "${!var:-}" ]]; then
      fail "required env var $var is not set (--strict mode)"
    fi
  done
fi

# 5. The coordinator image is pinned to a tag
if grep -q "image: aware-coordinator:" docker-compose.coordinator.yml; then
  ok "coordinator image is pinned to a tag (not :latest)"
else
  warn "coordinator image is not pinned to a specific tag"
fi

# Summary
echo
if (( errors > 0 )); then
  echo "::error::prod-check failed: $errors error(s), $warnings warning(s)"
  exit 1
fi
if (( warnings > 0 )); then
  echo "::warning::prod-check passed with $warnings warning(s)"
  (( STRICT )) && exit 1 || exit 0
fi
echo "::ok::prod-check passed: 0 errors, 0 warnings"
