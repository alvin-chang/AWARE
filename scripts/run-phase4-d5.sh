#!/usr/bin/env bash
# scripts/run-phase4-d5.sh — Phase 4 Deliverable 5: real benchmark delta.
#
# What this does (and doesn't):
#   - Preflights the local environment (Modal auth, Docker, config keys).
#   - Deploys the trainer image to Modal (`aware-trainer` app).
#   - Boots the trainer container with AZR-corpus emission enabled.
#   - Waits for the training run to complete (poll aware_training_runs).
#   - Verifies the AZR corpus was ingested (aware_azr_results row count).
#   - Halts with a clear error if any precondition fails. NO GPU spend
#     is incurred until step 4 (boot) succeeds.
#
# What this does NOT do:
#   - Run the eval harness. Use scripts/eval-delta.sh for that.
#   - Rotate credentials. The Modal token must already be in
#     ~/.modal.toml under the `goodciso` profile (run `modal token set`
#     once if not).
#   - Tear down the trainer container or the Modal app. Operator decides.
#
# PGPASSWORD convention: this script reads AWARE_DB_PWD from the
# operator's env (the SAME var the v2 compose file uses, per
# docker-compose.coordinator.yml lines 114/208/282), with the compose
# file's hardcoded dev fallback of 'dev-only-pwd'. Assigns to a local
# var, unsets it at the end, and never echoes it. Matches the pattern
# in scripts/bring-up-coordinator.sh:183.
#
# Env-var naming chain in the v2 compose (do not confuse these):
#   AWARE_DB_PWD              ← host-side env var (this script reads it)
#     ↓ docker-compose interpolation
#   POSTGRES_PASSWORD         ← postgres service env (db init)
#   AWARE_POSTGRES_PASSWORD   ← coordinator + trainer service env
#                                (only set INSIDE those containers;
#                                 never on the host)
#
# If you have nothing set, this script will use the compose file's
# dev-only default, which is what the bring-up script has been using
# all session. Override with: AWARE_DB_PWD=... ./scripts/run-phase4-d5.sh
#
# Usage:
#   ./scripts/run-phase4-d5.sh                  # full preflight → deploy → run → verify
#   ./scripts/run-phase4-d5.sh --preflight     # just the preflight checks
#   ./scripts/run-phase4-d5.sh --no-deploy     # preflight + boot only (skip modal deploy)
#   AWARE_TRAINER_TIMEOUT_MIN=300 ./scripts/run-phase4-d5.sh --timeout=300
#
# Env vars (all optional, with defaults):
#   AWARE_TRAINER_TIMEOUT_MIN   default: 360  (how long to wait for the training run)
#   AWARE_TRAINER_POLL_SEC      default: 30   (how often to poll aware_training_runs)
#   MODAL_PROFILE               default: goodciso  (the workspace name)
#   AWARE_DB_HOST               default: 127.0.0.1
#   AWARE_DB_PORT               default: 18432  (v2 port, per ADR-020)
#   AWARE_TRAINER_AZR_CORPUS_PATH  default: /root/aware-weights/corpus.jsonl
#
# Exits non-zero on any preflight failure or any in-step failure. The
# operator should NOT proceed past a non-zero exit.

set -euo pipefail

# ─── Defaults ──────────────────────────────────────────────────────────
TIMEOUT_MIN="${AWARE_TRAINER_TIMEOUT_MIN:-360}"
POLL_SEC="${AWARE_TRAINER_POLL_SEC:-30}"
MODAL_PROFILE="${MODAL_PROFILE:-goodciso}"
DB_HOST="${AWARE_DB_HOST:-127.0.0.1}"
DB_PORT="${AWARE_DB_PORT:-18432}"
DB_NAME="${AWARE_DB_NAME:-aware2}"
DB_USER="${AWARE_DB_USER:-aware}"
AZR_CORPUS_PATH="${AWARE_TRAINER_AZR_CORPUS_PATH:-/root/aware-weights/corpus.jsonl}"

DEPLOY=1
PREFLIGHT_ONLY=0
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ─── Arg parse (tiny, no deps) ────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --preflight) PREFLIGHT_ONLY=1 ;;
    --no-deploy) DEPLOY=0 ;;
    --timeout=*) TIMEOUT_MIN="${arg#*=}" ;;
    -h|--help)
      sed -n '2,38p' "$0"
      exit 0
      ;;
    *)
      echo "unknown arg: $arg" >&2
      exit 64
      ;;
  esac
done

# ─── Color helpers ────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YEL=$'\033[33m'
  C_BLU=$'\033[34m'; C_DIM=$'\033[2m'; C_RST=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_YEL=""; C_BLU=""; C_DIM=""; C_RST=""
fi
log()   { printf '%s\n' "$*"; }
ok()    { printf '%s✓%s %s\n' "$C_GREEN" "$C_RST" "$*"; }
warn()  { printf '%s!%s %s\n' "$C_YEL" "$C_RST" "$*"; }
fail()  { printf '%s✗%s %s\n' "$C_RED" "$C_RST" "$*" >&2; exit 1; }
step()  { printf '\n%s==>%s %s\n' "$C_BLU" "$C_RST" "$*"; }

# Read the postgres password from the same source the compose file uses.
# Compose reads $AWARE_DB_PWD with a 'dev-only-pwd' fallback — we mirror
# that here so the script works out-of-the-box in dev (which is what
# the bring-up has been using all session). Pattern matches
# scripts/bring-up-coordinator.sh:183: assign to a clearly-named local
# var, unset at the end, never echo. The host-side env var is
# AWARE_DB_PWD; AWARE_POSTGRES_PASSWORD is the in-container view of
# the same value and is NEVER set on the host.
if [ -z "${AWARE_DB_PWD:-}" ]; then
  warn "AWARE_DB_PWD is not set; using compose file's dev-only default. Override with: export AWARE_DB_PWD=... before running."
  AWARE_DB_PWD="dev-only-pwd"
fi
PGPASSWORD_VALUE="$AWARE_DB_PWD"
export PGPASSWORD="$PGPASSWORD_VALUE"
trap 'unset PGPASSWORD PGPASSWORD_VALUE' EXIT

# ─── Preflight checks ────────────────────────────────────────────────
preflight() {
  step "Preflight: checking local environment"

  # 1. Modal CLI
  if ! command -v modal >/dev/null 2>&1; then
    fail "modal CLI not found. Install: uv tool install modal  (or brew install modal)"
  fi
  ok "modal CLI present: $(modal --version 2>&1 | head -1)"

  # 2. Modal auth
  if ! modal profile list >/dev/null 2>&1; then
    fail "modal profile list failed. Run: modal token set  (or modal token new)"
  fi
  # NB: don't use `! ... | grep -q` under `set -o pipefail` — bash's pipefail
  # short-circuits on the upstream command's exit code, and `modal profile
  # list` writes informational output that confuses the pipeline. Use a
  # captured variable instead, which is portable across bash 3.2/4.x/5.x.
  modal profile list 2>/dev/null > /tmp/modal-profiles.$$.txt
  if ! grep -q "$MODAL_PROFILE" /tmp/modal-profiles.$$.txt; then
    rm -f /tmp/modal-profiles.$$.txt
    fail "modal profile '$MODAL_PROFILE' not configured. Run: modal token set (default workspace: $MODAL_PROFILE)"
  fi
  rm -f /tmp/modal-profiles.$$.txt
  ok "modal profile '$MODAL_PROFILE' configured"

  # 3. Modal app empty (per the standing goal: 'it''s all empty')
  APP_COUNT=$(modal app list 2>/dev/null | grep -cE '^\|' | tail -1 || true)
  if [ "${APP_COUNT:-0}" -gt 0 ]; then
    warn "Modal workspace has existing apps. Deployment of 'aware-trainer' is idempotent (replaces)."
    warn "Listing: $(modal app list 2>/dev/null | grep -oE 'aware-[a-z0-9-]+' | sort -u | tr '\n' ' ')"
  else
    ok "Modal workspace is empty (no prior apps)"
  fi

  # 4. Docker (for the trainer container, which is compose-managed)
  if ! command -v docker >/dev/null 2>&1; then
    fail "docker not found. Install Docker Desktop for Mac or orbstack."
  fi
  if ! docker compose version >/dev/null 2>&1; then
    fail "'docker compose' subcommand missing. Update Docker Desktop."
  fi
  ok "docker + compose present: $(docker --version | head -1)"

  # 5. Postgres reachable
  # Use docker exec against the aware-2-postgres container (matches the
  # pattern in scripts/bring-up-coordinator.sh). This avoids requiring
  # psql on the host PATH — the v2 stack always talks to postgres
  # through the container.
  if ! docker inspect --format '{{.State.Running}}' aware-2-postgres 2>/dev/null | grep -q true; then
    fail "Container 'aware-2-postgres' is not running. Bring up the v2 stack first: scripts/aware-up"
  fi
  if ! docker exec -e PGPASSWORD="$PGPASSWORD_VALUE" aware-2-postgres \
       pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    fail "Postgres inside aware-2-postgres is not ready. Check: docker logs aware-2-postgres"
  fi
  ok "postgres reachable via docker exec: aware-2-postgres ($DB_USER@$DB_NAME)"

  # 6. Required tables present
  for table in aware_training_runs aware_azr_results; do
    if ! docker exec -e PGPASSWORD="$PGPASSWORD_VALUE" aware-2-postgres \
         psql -U "$DB_USER" -d "$DB_NAME" -tAc \
         "SELECT 1 FROM information_schema.tables WHERE table_name='$table'" 2>/dev/null \
         | grep -q 1; then
      fail "Required table '$table' missing. Run migrations: docker compose -f docker-compose.coordinator.yml -p aware-2 up -d postgres && npm run migrate"
    fi
  done
  ok "migrations present: aware_training_runs, aware_azr_results"

  # 7. Training run.py present
  if [ ! -f "$REPO_ROOT/training/run.py" ]; then
    fail "training/run.py missing at $REPO_ROOT. Aborting."
  fi
  ok "training/run.py present"

  # 8. AWARE_TRAINER_ENABLED not already on
  if [ "${AWARE_TRAINER_ENABLED:-0}" = "1" ]; then
    warn "AWARE_TRAINER_ENABLED=1 already set in env. The docker compose --profile training up will use it as-is."
  fi

  ok "preflight PASS"
}

# ─── Step 1: Deploy Modal app ────────────────────────────────────────
deploy_modal() {
  step "Step 1/4: deploying trainer image to Modal ($MODAL_PROFILE workspace)"
  cd "$REPO_ROOT"
  if ! MODAL_PROFILE="$MODAL_PROFILE" modal deploy training/app.py 2>&1 | tail -30; then
    fail "modal deploy failed. See output above. Common causes: bad token, GPU quota exceeded, image build error."
  fi
  ok "Modal app 'aware-trainer' deployed (target: training/app.py)"
}

# ─── Step 2: Start trainer container ──────────────────────────────────
boot_trainer() {
  step "Step 2/4: booting trainer container with AZR-corpus emission enabled"
  cd "$REPO_ROOT"

  # Export the AZR corpus path so the trainer picks it up. The container
  # writes the corpus here as it iterates on training runs.
  export AWARE_TRAINER_ENABLED=1
  export AWARE_TRAINER_AZR_CORPUS_PATH="$AZR_CORPUS_PATH"
  export AWARE_TRAINER_MIN_PAIRS_PER_RUN="${AWARE_TRAINER_MIN_PAIRS_PER_RUN:-1}"

  log "  AWARE_TRAINER_ENABLED=$AWARE_TRAINER_ENABLED"
  log "  AWARE_TRAINER_AZR_CORPUS_PATH=$AWARE_TRAINER_AZR_CORPUS_PATH"
  log "  AWARE_TRAINER_MIN_PAIRS_PER_RUN=$AWARE_TRAINER_MIN_PAIRS_PER_RUN"

  if ! docker compose -f docker-compose.coordinator.yml -p aware-2 --profile training up -d trainer 2>&1 | tail -10; then
    fail "docker compose up trainer failed. Check: docker compose -p aware-2 logs trainer"
  fi
  ok "trainer container started"
}

# ─── Step 3: Wait for run completion ──────────────────────────────────
wait_for_run() {
  step "Step 3/4: waiting for training run to complete (timeout: ${TIMEOUT_MIN} min)"
  local deadline=$((SECONDS + TIMEOUT_MIN * 60))
  local last_status=""

  # Use docker exec to query the postgres container (psql not on host PATH).
  while [ "$SECONDS" -lt "$deadline" ]; do
    last_status=$(docker exec -e PGPASSWORD="$PGPASSWORD_VALUE" aware-2-postgres \
      psql -U "$DB_USER" -d "$DB_NAME" -tAc \
      "SELECT COALESCE(status, 'none') FROM aware_training_runs ORDER BY started_at DESC LIMIT 1" 2>/dev/null || echo "query-failed")
    case "$last_status" in
      completed|success|succeeded)
        ok "training run completed (status: $last_status)"
        docker exec -e PGPASSWORD="$PGPASSWORD_VALUE" aware-2-postgres \
          psql -U "$DB_USER" -d "$DB_NAME" \
          -c "SELECT run_id, status, n_pairs, started_at, completed_at FROM aware_training_runs ORDER BY started_at DESC LIMIT 1"
        return 0
        ;;
      failed|error)
        fail "training run FAILED (status: $last_status). Check trainer logs: docker compose -f docker-compose.coordinator.yml -p aware-2 logs trainer"
        ;;
      running|pending|started)
        log "  $(date +%H:%M:%S) status=$last_status, polling again in ${POLL_SEC}s"
        sleep "$POLL_SEC"
        ;;
      none|"")
        log "  $(date +%H:%M:%S) no run yet (status=$last_status), polling again in ${POLL_SEC}s"
        sleep "$POLL_SEC"
        ;;
      query-failed)
        warn "  $(date +%H:%M:%S) DB query failed, retrying in ${POLL_SEC}s"
        sleep "$POLL_SEC"
        ;;
      *)
        log "  $(date +%H:%M:%S) unknown status '$last_status', polling again in ${POLL_SEC}s"
        sleep "$POLL_SEC"
        ;;
    esac
  done
  fail "timed out after ${TIMEOUT_MIN} min waiting for training run to complete. Last status: $last_status"
}

verify_azr() {
  step "Step 4/4: verifying AZR corpus ingestion"
  local row_count
  local passed_count

  row_count=$(docker exec -e PGPASSWORD="$PGPASSWORD_VALUE" aware-2-postgres \
    psql -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT COUNT(*) FROM aware_azr_results" 2>/dev/null || echo "0")
  passed_count=$(docker exec -e PGPASSWORD="$PGPASSWORD_VALUE" aware-2-postgres \
    psql -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT COUNT(*) FROM aware_azr_results WHERE passed=true" 2>/dev/null || echo "0")

  log "  aware_azr_results rows: $row_count  (passed: $passed_count)"

  if [ "${row_count:-0}" -lt 1 ]; then
    fail "No rows in aware_azr_results. The trainer's AZR corpus emission is broken. Check trainer logs."
  fi
  if [ "${passed_count:-0}" -lt 1 ]; then
    warn "No passing rows in aware_azr_results. The trainer ran but produced only failing AZR results."
    warn "This is unexpected for trained-model. Investigate: docker compose -f docker-compose.coordinator.yml -p aware-2 logs trainer"
  fi
  ok "AZR corpus verified: $row_count rows, $passed_count passed"

  step "NEXT STEP: run scripts/eval-delta.sh to compute the +3pp target"
  log "  ./scripts/eval-delta.sh"
}

# ─── Main ────────────────────────────────────────────────────────────
preflight

if [ "$PREFLIGHT_ONLY" -eq 1 ]; then
  exit 0
fi

if [ "$DEPLOY" -eq 1 ]; then
  deploy_modal
else
  log "(skipping modal deploy per --no-deploy)"
fi

boot_trainer
wait_for_run
verify_azr

ok "Phase 4 D5 runbook complete. Run scripts/eval-delta.sh next."
