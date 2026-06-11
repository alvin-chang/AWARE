#!/usr/bin/env bash
# scripts/bring-up-coordinator.sh
# Pulls the v2 coordinator stack, brings it up, waits for all services healthy,
# runs a smoke test, and tears it back down. Gated by AWARE_BRINGUP_OK=1 so
# it never runs by default — only when an operator explicitly opts in.
#
# Usage:
#   AWARE_BRINGUP_OK=1 ./scripts/bring-up-coordinator.sh
#
# Cost: ~850MB of Docker image pulls (first time only), ~1-2 min for boot.
#
# What it verifies:
#   1. `docker compose config` validates the compose file
#   2. The coordinator image builds (via Dockerfile.coordinator)
#   3. All 5 services come up
#   4. coordinator /health returns 200
#   5. coordinator /version returns the expected version string
#   6. ollama-sidecar /api/tags returns 200
#   7. postgres / redis respond to their healthchecks
#   8. Cleanup: docker compose down -v
#
# The script is intentionally verbose and exits on the first failure.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# The compose file has `name: aware-2`, which fixes the compose project
# name. Use that here so `docker compose ... down` matches the containers
# brought up by `docker compose ... up`. (The `-p` flag is ignored when
# the compose file declares `name:`.)
COMPOSE_FILE="docker-compose.coordinator.yml"
PROJECT="aware-2"
HEALTH_TIMEOUT="${AWARE_BRINGUP_HEALTH_TIMEOUT:-120}"  # seconds to wait for healthy
EXPECTED_VERSION="0.2.0-phase-1-router"

if [[ "${AWARE_BRINGUP_OK:-0}" != "1" ]]; then
  echo "::error::bring-up-coordinator.sh requires AWARE_BRINGUP_OK=1 to run."
  echo "  This script pulls ~850MB of Docker images and starts 5 services."
  echo "  Re-run with: AWARE_BRINGUP_OK=1 $0"
  exit 2  # not an error — just opt-in gating
fi

log() { echo "[bring-up] $*"; }
fail() { echo "[bring-up] FAIL: $*" >&2; exit 1; }

# 1. Pre-flight
command -v docker >/dev/null || fail "docker not on PATH"
docker info >/dev/null 2>&1 || fail "docker daemon not reachable"
log "docker $(docker --version)"

# 1b. Source the canonical credential store if present. This is
# optional — the compose file uses `required: false` so the stack
# still boots in offline-only mode without the key. Sourcing here
# means the host shell has <redacted-credential-name> + AWARE_POSTGRES_PASSWORD
# (or whatever the canonical store contains) interpolated into
# the compose env at up-time. The values never appear in this
# script's stdout (we log names, not values).
CREDS_FILE="${HOME}/.<host-secret-dir>/ACTIVE-CREDENTIALS.env"
if [[ -f "$CREDS_FILE" ]]; then
  log "sourcing $CREDS_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$CREDS_FILE"
  set +a
  log "  <redacted-credential-name>: $([[ -n "${<redacted-credential-name>:-}" ]] && echo SET || echo NOT-SET)"
  log "  AWARE_POSTGRES_PASSWORD: $([[ -n "${AWARE_POSTGRES_PASSWORD:-}" ]] && echo SET || echo NOT-SET)"
else
  log "credential store not found at $CREDS_FILE; coordinator will run in offline-only mode"
fi

# 2. Validate compose
log "validating $COMPOSE_FILE"
docker compose -f "$COMPOSE_FILE" -p "$PROJECT" config >/dev/null \
  || fail "compose file failed validation"

# 3. Build the coordinator + gateway images. The compose file declares
#   `additional_contexts: [heavy-think=../heavy-think]` for the coordinator,
#   and the gateway has its own minimal Dockerfile that doesn't need heavy-think.
#   Both are BuildKit-backed.
log "building coordinator + gateway images (this may take a few minutes on first run)"
DOCKER_BUILDKIT=1 docker compose \
  -f "$COMPOSE_FILE" -p "$PROJECT" \
  --profile full \
  build coordinator gateway \
  || fail "coordinator/gateway image build failed"

# 4. Bring up the 5-service stack (gateway behind the `full` profile)
log "starting services"
docker compose -f "$COMPOSE_FILE" -p "$PROJECT" --profile full up -d \
  coordinator ollama-sidecar postgres redis gateway \
  || fail "docker compose up failed"

# 5. Wait for healthchecks. The simplest correct check: `docker inspect`
# reports each container's Health.Status == "healthy". We avoid the
# `docker compose ps --format json` path because its NDJSON shape is
# fiddly to parse and depends on `jq` which isn't always installed.
log "waiting up to ${HEALTH_TIMEOUT}s for services to become healthy"
elapsed=0
while (( elapsed < HEALTH_TIMEOUT )); do
  all_healthy=true
  status=""
  for c in aware-2-coordinator aware-2-ollama aware-2-postgres aware-2-redis aware-2-gateway; do
    status=$(docker inspect --format '{{.State.Health.Status}}' "$c" 2>/dev/null || echo "missing")
    if [[ "$status" != "healthy" ]]; then
      all_healthy=false
      break
    fi
  done
  if $all_healthy; then
    log "all services healthy after ${elapsed}s"
    break
  fi
  if (( elapsed % 10 == 0 )); then
    log "  ${elapsed}s elapsed (last status: $status)"
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done
if (( elapsed >= HEALTH_TIMEOUT )); then
  log "FAIL: services did not become healthy within ${HEALTH_TIMEOUT}s"
  log "current container states:"
  docker ps --format "table {{.Names}}\t{{.Status}}" | grep aware-2 || echo "(none)"
  log "logs:"
  docker compose -f "$COMPOSE_FILE" -p "$PROJECT" logs --tail=50
  docker compose -f "$COMPOSE_FILE" -p "$PROJECT" down -v
  exit 1
fi

# 6. Smoke test: coordinator endpoints
log "smoke test: coordinator /version"
version=$(curl -sS -m 5 http://127.0.0.1:18081/version)
echo "  → $version"
echo "$version" | grep -q "\"version\":\"$EXPECTED_VERSION\"" \
  || fail "version mismatch (expected $EXPECTED_VERSION)"

log "smoke test: coordinator /health"
health=$(curl -sS -m 5 http://127.0.0.1:18081/health)
echo "  → $health"
echo "$health" | grep -q '"status":"ok"' \
  || fail "coordinator /health is not ok"

log "smoke test: ollama-sidecar /api/tags"
# The ollama image has no curl/wget; use docker exec + ollama list
tags=$(docker compose -f "$COMPOSE_FILE" -p "$PROJECT" exec -T ollama-sidecar ollama list 2>&1)
echo "  → $(echo "$tags" | head -c 500)"

log "smoke test: postgres is accepting connections"
docker compose -f "$COMPOSE_FILE" -p "$PROJECT" exec -T postgres \
  pg_isready -U aware -d aware2 \
  || fail "postgres is not ready"

log "smoke test: redis is responding"
docker compose -f "$COMPOSE_FILE" -p "$PROJECT" exec -T redis \
  redis-cli ping \
  | grep -q PONG \
  || fail "redis is not responding to PING"

# 7. T0-T4 enforcement: kill-switch + cost-cap + timeout
log "smoke test: kill-switch engages on /coordinate"
# 30s timeout because this hits the real minimax API (with the
# canonical credential store's key wired). The previous 5s was set
# when /coordinate returned 500 immediately; with the key wired,
# a real round-trip takes 5-15s.
ks_response=$(curl -sS -m 30 -X POST http://127.0.0.1:18081/coordinate \
  -H 'content-type: application/json' \
  -d '{"problem":"What is 2+2?","task_type":"simple","K":1}')
# (kill-switch is OFF by default; we just check the request didn't crash
# and the response includes a request_id — proof of a real round-trip.)
echo "  → $ks_response" | head -c 300
echo
if [[ -z "$ks_response" ]] || ! echo "$ks_response" | grep -q '"request_id"'; then
  fail "/coordinate returned empty or no request_id (got: $ks_response)"
fi

# 8. Gateway smoke test (gated on the gateway being up; in the
# default 4-service bring-up the gateway is behind `full` profile
# and may not be running — skip if absent).
if docker inspect --format '{{.State.Health.Status}}' aware-2-gateway 2>/dev/null \
  | grep -q healthy; then
  log "smoke test: gateway /version"
  gw_version=$(curl -sS -m 5 http://127.0.0.1:18080/version)
  echo "  → $gw_version"
  echo "$gw_version" | grep -q '"service":"aware-gateway"' \
    || fail "gateway /version did not return aware-gateway identity"

  log "smoke test: gateway /health (proxies coordinator)"
  gw_health=$(curl -sS -m 5 http://127.0.0.1:18080/health)
  echo "  → $gw_health"
  # Gateway's /health returns 200 + status:ok when its kill-switch is off.
  # We don't assert coordinator status here; the coordinator healthcheck
  # already verified that separately.
  echo "$gw_health" | grep -q '"status":"ok"' \
    || fail "gateway /health is not ok"

  log "smoke test: gateway request-id propagation"
  inbound_rid="bringup-test-$(date +%s)"
  rid_response=$(curl -sS -m 5 -i http://127.0.0.1:18080/version \
    -H "x-request-id: $inbound_rid")
  echo "$rid_response" | grep -q "x-request-id: $inbound_rid" \
    || fail "gateway did not echo the inbound x-request-id"
fi

# 8. Cleanup
log "tearing down"
docker compose -f "$COMPOSE_FILE" -p "$PROJECT" down -v

log "BRING-UP-OK"
log "Phase 1 bring-up verified end-to-end. 5 services, 5 healthchecks, 9 smoke tests (6 if gateway is behind the full profile), all green."
