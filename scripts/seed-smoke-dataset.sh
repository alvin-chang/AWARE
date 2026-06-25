#!/usr/bin/env bash
# scripts/seed-smoke-dataset.sh — One-command smoke-test data setup.
#
# Why this script exists:
#   In the v2 stack there is no real /coordinate traffic on a fresh
#   stack, so the trainer's _fetchUnconsumedPairPaths always returns
#   0 unconsumed pairs, and the trainer never submits a run to Modal.
#   The smoke test (Phase 4 D5 verification) needs at least
#   `AWARE_TRAINER_MIN_PAIRS_PER_RUN` (default 100, but the smoke run
#   uses 1) preference pairs to exist before the trainer will submit
#   a Modal job.
#
#   This script synthesizes N fake pairs and:
#     1. Writes a rl-pipeline-bridge-schema JSONL into the trainer container's
#        writable /opt/aware/data/preference-pairs/ directory (avoids
#        the virtiofs/docker-cp file-perm EACCES operator gotcha).
#     2. Inserts N matching rows into aware_conversations (ok=true,
#        pair_path=<the in-container path>, ts=NOW() so they pass
#        the trainer's "ts > last completed-run watermark" filter).
#
#   The trainer container reads the file from
#   /opt/aware/data/preference-pairs/<file>.jsonl directly — this is
#   the same path the trainer's own _packageDataset uses for its
#   datasetPath output (modulo the subdir). No docker cp, no bind
#   mount hacks, no chown-after-the-fact.
#
# This addresses the two operator-side gotchas from the smoke-test
# bug ledger (bugs #6 + #8 in redacted-internal-doc):
#   - #6: the rl-pipeline-bridge schema mismatch (problem/reasoning not
#     prompt/text). The synthetic records here use the correct
#     schema, verified against rl-pipeline/src/dpo-format.js:28-36.
#   - #8: the docker cp file-perm EACCES issue when injecting a
#     file from the host into a Colima/virtiofs-backed named
#     volume. We go in-container via docker exec instead, so the
#     file is created as the trainer's uid from the start.
#
# Usage:
#   ./scripts/seed-smoke-dataset.sh                 # seed 5 pairs (default)
#   ./scripts/seed-smoke-dataset.sh --count=20     # seed 20 pairs
#   ./scripts/seed-smoke-dataset.sh --unseed       # remove all smoke rows
#   ./scripts/seed-smoke-dataset.sh --label=alpha   # custom label
#                                                  # (default: smoke)
#
# Env vars (all optional, with defaults):
#   AWARE_DB_PWD   default: dev-only-pwd  (mirrors scripts/run-phase4-d5.sh)
#
# Re-runnable: each invocation writes a fresh file (smoke-<epoch>.jsonl)
# and inserts N new aware_conversations rows with request_ids generated
# from the epoch. Use --unseed to clean up at the end of a smoke cycle.

set -euo pipefail

# ─── Defaults ──────────────────────────────────────────────────────────
COUNT=5
LABEL="smoke"
UNSEED=0
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DB_HOST="${AWARE_DB_HOST:-127.0.0.1}"
DB_PORT="${AWARE_DB_PORT:-18432}"
DB_NAME="${AWARE_DB_NAME:-aware2}"
DB_USER="${AWARE_DB_USER:-aware}"

# ─── Arg parse ─────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --count=*) COUNT="${arg#*=}" ;;
    --label=*) LABEL="${arg#*=}" ;;
    --unseed)  UNSEED=1 ;;
    -h|--help)
      sed -n '2,49p' "$0"
      exit 0
      ;;
    *)
      echo "unknown arg: $arg" >&2
      exit 64
      ;;
  esac
done

# Reject non-numeric COUNT early so the SQL doesn't blow up later.
if ! [[ "$COUNT" =~ ^[0-9]+$ ]] || [ "$COUNT" -lt 1 ]; then
  echo "seed: --count must be a positive integer, got '$COUNT'" >&2
  exit 64
fi

# ─── Color helpers ─────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YEL=$'\033[33m'
  C_BLU=$'\033[34m'; C_RST=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_YEL=""; C_BLU=""; C_RST=""
fi
log()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$C_GREEN" "$C_RST" "$*"; }
warn() { printf '%s!%s %s\n' "$C_YEL" "$C_RST" "$*"; }
fail() { printf '%s✗%s %s\n' "$C_RED" "$C_RST" "$*" >&2; exit 1; }
step() { printf '\n%s==>%s %s\n' "$C_BLU" "$C_RST" "$*"; }

# ─── Password handling (mirror run-phase4-d5.sh) ──────────────────────
if [ -z "${AWARE_DB_PWD:-}" ]; then
  warn "AWARE_DB_PWD is not set; using compose file's dev-only default."
  AWARE_DB_PWD="dev-only-pwd"
fi
PGPASSWORD_VALUE="$AWARE_DB_PWD"
export PGPASSWORD="$PGPASSWORD_VALUE"
trap 'unset PGPASSWORD PGPASSWORD_VALUE' EXIT

# ─── Preflight ─────────────────────────────────────────────────────────
preflight() {
  step "Preflight: checking environment"
  if ! command -v docker >/dev/null 2>&1; then
    fail "docker not found."
  fi
  for c in aware-2-postgres aware-2-trainer; do
    if ! docker inspect --format '{{.State.Running}}' "$c" >/dev/null 2>&1; then
      fail "Container '$c' is not present. Bring up the v2 stack: scripts/aware-up"
    fi
  done
  # Trainer may be exited (not running) — that's fine for seeding, we
  # only need the volume to exist. The Postgres container MUST be
  # running because we INSERT into aware_conversations.
  if ! docker inspect --format '{{.State.Running}}' aware-2-postgres 2>/dev/null | grep -q true; then
    fail "Container 'aware-2-postgres' is not running. Bring up the v2 stack first."
  fi
  if ! docker exec -e PGPASSWORD="$PGPASSWORD_VALUE" aware-2-postgres \
       pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    fail "Postgres inside aware-2-postgres is not ready. Check: docker logs aware-2-postgres"
  fi
  for table in aware_conversations aware_training_runs; do
    if ! docker exec -e PGPASSWORD="$PGPASSWORD_VALUE" aware-2-postgres \
         psql -U "$DB_USER" -d "$DB_NAME" -tAc \
         "SELECT 1 FROM information_schema.tables WHERE table_name='$table'" 2>/dev/null \
         | grep -q 1; then
      fail "Required table '$table' missing. Run migrations: scripts/aware-up"
    fi
  done
  ok "postgres reachable, migrations present, both containers exist"
}

# ─── Unseed (cleanup) ──────────────────────────────────────────────────
unseed() {
  step "Unseeding: removing all rows where session_id LIKE 'seed-$LABEL-%'"
  local n
  n=$(docker exec -e PGPASSWORD="$PGPASSWORD_VALUE" aware-2-postgres \
       psql -U "$DB_USER" -d "$DB_NAME" -tAc \
       "SELECT COUNT(*) FROM aware_conversations WHERE session_id LIKE 'seed-$LABEL-%'" 2>/dev/null || echo 0)
  if [ "${n:-0}" = "0" ]; then
    ok "no seed rows to remove (label='$LABEL')"
    return 0
  fi
  docker exec -e PGPASSWORD="$PGPASSWORD_VALUE" aware-2-postgres \
    psql -U "$DB_USER" -d "$DB_NAME" -c \
    "DELETE FROM aware_conversations WHERE session_id LIKE 'seed-$LABEL-%'"
  ok "removed $n seed rows"
  # Don't try to remove the JSONL file from the trainer's volume here —
  # the trainer may not be running, and the file is harmless. The next
  # seed invocation writes a fresh file with a new timestamp.
}

# ─── Synthesize one rl-pipeline-bridge record ──────────────────────────────────
# The schema (verified against rl-pipeline/src/dpo-format.js:28-36) is:
#   { ts, problem, task_type, chosen: { reasoning, prm_score },
#     rejected: { reasoning, prm_score }, all_attempts: [...],
#     verification: {...}, cost: {...}, _content_hash: "..." }
# _content_hash is computed from sha256(problem + "\0" + rejected + "\0" + chosen),
# matching rl-pipeline/src/preference-pair.js:hashContent.
synth_record() {
  local i="$1"
  local epoch_ms="$2"
  local problem
  local chosen_reasoning
  local rejected_reasoning
  local chosen_score
  local rejected_score
  local task_type
  local content_hash

  # Use a stable, identifiable task_type so the runbook's
  # outcome filter (config.trainer.filterRule) can include or
  # exclude these records via tag_match.
  task_type="seed-${LABEL}-math"

  # Vary the problem text by index. Keep it short (the trainer
  # truncates refined_trace to 8000 chars, so long problems are fine
  # but verbose ones are wasteful). A real problem statement works
  # better than a placeholder for downstream debugging.
  problem="[seed ${LABEL} #${i}] What is ${i} + ${i}? (Synthetic smoke pair generated $(date -u +%Y-%m-%dT%H:%M:%SZ))"

  # Score gap deliberately > minScoreGap (0.05) so toDpoDataset does
  # not drop the record. chos:en.prm_score=0.9, rejected.prm_score=0.3
  # → gap = 0.6.
  chosen_reasoning="Step 1: Identify the addends (${i} and ${i}). Step 2: Apply the addition operation. Step 3: Compute the sum. Answer: $((2 * i)). Verification: 2*${i} = $((2 * i)) (checked by multiplication, which is the inverse of addition). This reasoning was selected because it explicitly states the verification step, demonstrating correctness via the inverse operation."
  rejected_reasoning="The answer is 42. (This reasoning was selected as the rejected baseline — it gives a wrong answer with no justification, demonstrating the kind of low-PRM-score output a real preference pair would contrast against.)"
  chosen_score="0.9"
  rejected_score="0.3"

  # Content hash matches rl-pipeline's hashContent():
  #   sha256(problem + "\0" + rejected + "\0" + chosen), 16 hex chars
  content_hash=$(printf '%s\0%s\0%s' "$problem" "$rejected_reasoning" "$chosen_reasoning" \
    | shasum -a 256 | awk '{print substr($1, 1, 16)}')

  # Emit one rl-pipeline-bridge-schema JSONL line.
  printf '{"ts":"%s","problem":%s,"task_type":"%s","chosen":{"reasoning":%s,"prm_score":%s},"rejected":{"reasoning":%s,"prm_score":%s},"all_attempts":[{"reasoning":%s,"prm_score":%s,"selected":false},{"reasoning":%s,"prm_score":%s,"selected":true}],"verification":{"method":"none","passed":true,"duration_ms":0},"cost":{"attempts_usd":0.0,"refinement_usd":0.0,"judge_usd":0.0},"_content_hash":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" \
    "$(printf '%s' "$problem" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
    "$task_type" \
    "$(printf '%s' "$chosen_reasoning" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
    "$chosen_score" \
    "$(printf '%s' "$rejected_reasoning" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
    "$rejected_score" \
    "$(printf '%s' "$chosen_reasoning" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
    "$chosen_score" \
    "$(printf '%s' "$rejected_reasoning" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
    "$rejected_score" \
    "$content_hash"
}

# ─── Main ──────────────────────────────────────────────────────────────
preflight

if [ "$UNSEED" -eq 1 ]; then
  unseed
  ok "unseed complete"
  exit 0
fi

step "Seeding $COUNT synthetic preference pairs (label='$LABEL')"

# Capture epoch milliseconds portably. macOS/BSD `date` does not
# support `%N` (GNU extension), so we chain two `date` calls and
# combine them with leading-zero padding. Works on macOS bash 3.2
# and Linux bash 4+/5+.
EPOCH_S=$(date +%s)
EPOCH_NS=$(date +%N 2>/dev/null || echo "000000000")
EPOCH_MS="${EPOCH_S}$(printf '%03d' $((10#${EPOCH_NS:0:3})))"
FILE_NAME="${LABEL}-${EPOCH_MS}.jsonl"
# /opt/aware/data is the trainer container's writable named volume
# (aware-2-trainer-data:/opt/aware/data in docker-compose.coordinator.yml).
# Storing the file under preference-pairs/ inside that volume keeps it
# namespaced from the trainer's own dataset staging dir.
IN_CONTAINER_DIR="/opt/aware/data/preference-pairs"
IN_CONTAINER_PATH="${IN_CONTAINER_DIR}/${FILE_NAME}"

# 1. Build the JSONL content on the host (so we can validate it),
#    then push it into the trainer container via stdin + tee.
TMPFILE=$(mktemp -t aware-seed-XXXXXX.jsonl)
trap 'rm -f "$TMPFILE"; unset PGPASSWORD PGPASSWORD_VALUE' EXIT
for ((i = 1; i <= COUNT; i++)); do
  synth_record "$i" "$EPOCH_MS" >> "$TMPFILE"
done

# Sanity-check the file: must be N non-empty lines, each parseable JSON.
LINE_COUNT=$(wc -l < "$TMPFILE" | tr -d ' ')
if [ "${LINE_COUNT:-0}" != "$COUNT" ]; then
  fail "expected $COUNT lines in temp file, got ${LINE_COUNT:-?}"
fi
if ! python3 -c "
import json, sys
ok = 0
with open('$TMPFILE') as f:
  for ln, line in enumerate(f, 1):
    line = line.strip()
    if not line: continue
    r = json.loads(line)
    assert r.get('problem'), f'line {ln}: missing problem'
    assert r.get('chosen', {}).get('reasoning'), f'line {ln}: missing chosen.reasoning'
    assert r.get('rejected', {}).get('reasoning'), f'line {ln}: missing rejected.reasoning'
    assert r.get('_content_hash'), f'line {ln}: missing _content_hash'
    ok += 1
assert ok == $COUNT, f'expected $COUNT valid records, got {ok}'
print(f'validated $COUNT rl-pipeline-bridge-schema records')
"; then
  fail "JSONL validation failed; aborting before writing to the trainer container"
fi
ok "JSONL validated: $LINE_COUNT rl-pipeline-bridge-schema records"

# 2. Push the JSONL into the trainer's named volume at IN_CONTAINER_PATH.
#
#    The trick: docker cp + chmod-after-the-fact doesn't work under
#    Colima/virtiofs because `docker cp` creates the file with the
#    host's umask (typically 0600) and the host's uid (505), not
#    the container's active uid. The trainer (running as `aware`,
#    uid 100:101) then gets EACCES on read. This is bug #8 in
#    redacted-internal-doc.
#
#    The fix: don't docker cp. Instead, spin up a one-shot
#    container with the same volume mount, write the file with
#    `cat > FILE` as the container's `aware` user, and let docker
#    compose auto-rm the container. The named volume retains the
#    file, owned by `aware`, mode 0644.
#
#    `docker compose run --rm` is the right primitive here:
#      - It uses the same trainer service definition from the
#        compose file (image, env, volumes, user).
#      - --rm removes the container after the command exits.
#      - The named volume `aware-2-trainer-data` persists
#        independently of any container's lifecycle.
#      - The one-shot container exits 0 after `cat` finishes.
#
#    AWARE_TRAINER_ENABLED=0 is set so the trainer's poller logic
#    doesn't try to start (it would just print "kill switch off"
#    and exit, which is fine, but starting it for a seed is
#    wasteful). The `sh -c "..."` runs as the user defined in the
#    compose file (USER: aware in Dockerfile.coordinator).
#
#    cat with stdin redirect: `cat > FILE` reads stdin and writes
#    to FILE. Pass the host's JSONL via stdin (`< $TMPFILE`).
#    Ensure the parent directory exists first (`mkdir -p`).
RUN_CMD="mkdir -p '$(dirname "$IN_CONTAINER_PATH")' && cat > '$IN_CONTAINER_PATH' && chmod 0644 '$IN_CONTAINER_PATH' && wc -c < '$IN_CONTAINER_PATH' | tr -d ' '"
if ! AWARE_TRAINER_ENABLED=0 docker compose -f docker-compose.coordinator.yml -p aware-2 \
     --profile training run --rm -T trainer sh -c "$RUN_CMD" \
     < "$TMPFILE" 2>&1; then
  fail "docker compose run --rm trainer (writing JSONL into the volume) failed"
fi
ok "JSONL written to trainer volume: ${IN_CONTAINER_PATH}"

# 3. Insert N aware_conversations rows pointing to the in-container
#    path. session_id is namespaced with 'seed-<label>-' so the
#    --unseed command can clean up after a smoke cycle.
# Build a multi-VALUES INSERT, one row per JSONL line. Each text
# value is wrapped in Postgres `$$...$$` dollar-quoting so the
# problem/task_type strings don't need to be SQL-escaped (they can
# contain single quotes, double quotes, backslashes, etc. without
# any further processing on the shell side). The only constraint
# is that the content doesn't contain `$$` — safe for our seed
# problem text and task_type.
VALUES_SQL=""
for ((i = 0; i < COUNT; i++)); do
  # Pull the i-th line (0-indexed) and extract the fields.
  line=$(sed -n "$((i + 1))p" "$TMPFILE")
  # python emits the literal field value (no JSON quoting); we wrap
  # in $$...$$ in the SQL below.
  problem=$(printf '%s' "$line" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["problem"])')
  task_type=$(printf '%s' "$line" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["task_type"])')
  if [ -z "$VALUES_SQL" ]; then
    VALUES_SQL="(gen_random_uuid(), NOW() - interval '$i milliseconds', \$\$$problem\$\$::text, \$\$$task_type\$\$::text, 1, 'seed', true, 0.9, 0.0, 'seed trace', '$IN_CONTAINER_PATH', 'seed-$LABEL-$EPOCH_MS', 'seed-script', 100)"
  else
    VALUES_SQL="$VALUES_SQL, (gen_random_uuid(), NOW() - interval '$i milliseconds', \$\$$problem\$\$::text, \$\$$task_type\$\$::text, 1, 'seed', true, 0.9, 0.0, 'seed trace', '$IN_CONTAINER_PATH', 'seed-$LABEL-$EPOCH_MS', 'seed-script', 100)"
  fi
done

INSERT_SQL="INSERT INTO aware_conversations
  (request_id, ts, problem, task_type, k, backend_used, ok,
   confidence, cost_total_usd, refined_trace, pair_path,
   session_id, agent_id, duration_ms)
VALUES $VALUES_SQL;"

# `docker exec` does not pass stdin by default; pipe via -i (keep
# stdin open) so the heredoc reaches psql.
if ! docker exec -i -e PGPASSWORD="$PGPASSWORD_VALUE" aware-2-postgres \
     psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<< "$INSERT_SQL" 2>&1; then
  fail "INSERT into aware_conversations failed. See psql output above."
fi
ok "INSERTed $COUNT rows into aware_conversations (session_id='seed-$LABEL-$EPOCH_MS')"

# 4. Verify the seed worked.
INSERTED=$(docker exec -e PGPASSWORD="$PGPASSWORD_VALUE" aware-2-postgres \
  psql -U "$DB_USER" -d "$DB_NAME" -tAc \
  "SELECT COUNT(*) FROM aware_conversations WHERE session_id = 'seed-$LABEL-$EPOCH_MS'" 2>/dev/null || echo 0)
if [ "${INSERTED:-0}" != "$COUNT" ]; then
  fail "post-insert verification failed: expected $COUNT rows, found ${INSERTED:-?}"
fi

# Confirm the trainer's view of the file is correct: must be
# mode 0644 and non-empty. Use a one-shot `docker compose run --rm`
# so this works whether or not the trainer service is currently
# running (e.g. between smoke cycles).
FILE_STAT=$(AWARE_TRAINER_ENABLED=0 docker compose -f docker-compose.coordinator.yml -p aware-2 \
  --profile training run --rm -T trainer stat -c '%s %a' "$IN_CONTAINER_PATH" 2>/dev/null || echo "0 000")
FILE_SIZE=$(echo "$FILE_STAT" | awk '{print $1}')
FILE_MODE=$(echo "$FILE_STAT" | awk '{print $2}')
if [ "${FILE_SIZE:-0}" -lt 100 ]; then
  fail "post-write verification failed: $IN_CONTAINER_PATH is ${FILE_SIZE:-?} bytes (expected > 100)"
fi
if [ "${FILE_MODE:-000}" != "644" ]; then
  fail "post-write verification failed: $IN_CONTAINER_PATH has mode ${FILE_MODE:-?}, expected 644 (bug #8)"
fi

step "Seed complete"
log "  trainer-side file: ${IN_CONTAINER_PATH} (${FILE_SIZE} bytes)"
log "  db rows: ${COUNT} (session_id='seed-$LABEL-$EPOCH_MS')"
log ""
log "NEXT: run ./scripts/run-phase4-d5.sh to submit a Modal DPO run."
log "      when the smoke cycle is done, run:"
log "        ./scripts/seed-smoke-dataset.sh --unseed --label=$LABEL"
log "      to remove the seeded rows."
