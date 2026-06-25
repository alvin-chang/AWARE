# AWARE 2.0 Production Rollout Plan

**Status:** Active (added 2026-06-25, C-step finding #20)
**Owner:** Operator (Alvin) + Forge (execution)
**Related:** v2.5.0 release, `docker-compose.coordinator.yml`, `scripts/bring-up-coordinator.sh`

## Why

Sentinel C-step audit (2026-06-25) closed every code-fixable finding, but
flagged three operator-owned items for production cutover:

- **#18** — runtime bring-up evidence (real `/coordinate` call end-to-end)
- **#19** — runtime bring-up evidence (decision-log HTTP query via gateway)
- **#20** — this document (production rollout plan covering CORS allowlist,
  secret rotation, kill-switch drill)

Items 18/19 require **runtime evidence** in staging before cutover. This
SOP is the production rollout plan (item 20) that operators follow during
cutover. Runtime evidence items are owned by Forge; see "Pre-cutover gates"
below for the handoff contract.

## Pre-cutover gates (Forge-owned evidence items 18/19)

Before running any production cutover, the operator must have on hand:

| Gate | Source | Required artifact |
|---|---|---|
| Real `/coordinate` HTTP call in staging with a live MiniMax key | Forge | Transcript of `curl -X POST /coordinate` request + 200 response + non-empty `attempts[]` array |
| Real `/api/audit/chain` HTTP query in staging | Forge | `GET /api/audit/chain` returning `200 OK` with `entries: [...]` |
| Decision-log hash-chain integrity verified post-call | Forge | `GET /api/audit/verify` returning `{ ok: true, valid: true }` |
| Audit retention dry-run in staging | Forge | `npm run audit:retention:cleanup -- --dry-run` exiting 0 |

The transcript is recorded in `evidence/v2.5.0-staging-bringup-<date>.md`
under the operator-controlled evidence directory. The transcript must
include the exact curl command, the raw response body, and a one-line
summary of what was verified.

If any of the four gates above is missing, **DO NOT proceed to cutover**.
The pre-cutover gates exist precisely because Sentinel's read-only
charter could not produce runtime evidence — that handoff to Forge is
load-bearing.

## Cutover sequence

### Stage 1 — Compose validation (offline, ~2 min)

```bash
cd <repo-root>   # the AWARE working tree
docker compose -f docker-compose.coordinator.yml --profile full config > /dev/null
echo "compose valid"
```

If this fails, do not proceed. Fix the compose file first.

### Stage 2 — Image build (~5-15 min first time)

```bash
DOCKER_BUILDKIT=1 docker compose \
  -f docker-compose.coordinator.yml -p aware-2 \
  --profile full build coordinator gateway
```

Verify the build output shows the expected `awareness-2-coordinator`
and `awareness-2-gateway` images. If the build fails on heavy-think
clone (ADR-042), confirm `HEAVY_THINK_TAG` in the build args resolves
to a tag that exists on the local Gitea (heavy-think side; not part of
v2.5.0 changes).

### Stage 3 — Service start + healthcheck (~2 min)

```bash
docker compose -f docker-compose.coordinator.yml -p aware-2 --profile full up -d \
  coordinator postgres redis gateway

# Wait for all four to report healthy
for c in aware-2-coordinator aware-2-postgres aware-2-redis aware-2-gateway; do
  status=$(docker inspect --format '{{.State.Health.Status}}' "$c" 2>/dev/null || echo "missing")
  echo "$c: $status"
done
```

All four must report `healthy` within the `AWARE_BRINGUP_HEALTH_TIMEOUT`
default of 120s. If healthchecks time out, see "Failure modes" below.

### Stage 4 — Smoke test (~30 sec)

```bash
# Coordinator identity
curl -sS http://127.0.0.1:18081/version
# Expected: {"version":"0.2.0-phase-1-router", ...}

# Health
curl -sS http://127.0.0.1:18081/health
# Expected: {"ok":true,"service":"aware-coordinator"}

# Gateway health (port 3000 by default; check your compose env)
curl -sS http://127.0.0.1:3000/health
# Expected: {"ok":true}
```

### Stage 5 — Runtime evidence gates (Forge's domain)

Run the four gates from "Pre-cutover gates" above. Save transcripts to
`evidence/v2.5.0-staging-bringup-<date>.md`. If any gate fails, the
rollout is paused until Forge investigates.

## CORS allowlist (cutover hardening)

The v2 gateway's CORS posture is **allowlist-based, not wildcard**:

| Environment | Default `AWARE_GATEWAY_ALLOWED_ORIGINS` |
|---|---|
| Local dev | `http://localhost:3001` |
| Staging | `https://staging-aware.example.com` |
| Production | `https://app.example.com,https://admin.example.com` |

Set via environment in `docker-compose.coordinator.yml`'s `gateway` service
or via the operator's secrets manager. The gateway refuses requests from
origins not in the allowlist (with `optionsSuccessStatus: 200` for
preflight). **No production deployment should rely on the default
localhost origin** — that is a development-only fallback.

To rotate the allowlist after cutover (e.g., adding a new admin domain):

```bash
# 1. Update the compose env or secrets manager entry
# 2. Restart the gateway
docker compose -f docker-compose.coordinator.yml -p aware-2 restart gateway
# 3. Verify
curl -sS -H "Origin: https://new-admin.example.com" \
  -H "Access-Control-Request-Method: POST" \
  -X OPTIONS http://127.0.0.1:3000/api/audit/chain -i
# Expected: Access-Control-Allow-Origin: https://new-admin.example.com
```

## Secret rotation (cutover hardening)

AWARE v2.5.0 requires the following secrets. None are committed to the
repo; all are read from environment at runtime.

| Secret | Rotation cadence | Owner | Failure mode on absence |
|---|---|---|---|
| `AWARE_COORDINATOR_TOKEN` | Every 90 days | Operator | Coordinator refuses `/coordinate` (fail-closed) |
| `AWARE_POSTGRES_PASSWORD` | Every 180 days | Operator | Postgres won't start; coordinator can't connect |
| `MINIMAX_API_KEY` | Per provider policy | Operator | Coordinator runs offline-only (mode=offline); no online reasoning |
| `AWARE_AUDIT_RETENTION_DAYS` | Per compliance policy | Operator | Default 2555 (7 years) if unset |

**Rotation procedure:**

1. Generate the new value via the canonical secret manager (e.g., `openssl rand -hex 32` for tokens, password manager for DB credentials).
2. Update the operator's secrets store at `~/.<host-secret-dir>/ACTIVE-CREDENTIALS.env` (path is operator-dependent).
3. Restart affected services:

   ```bash
   # Coordinator (token + LLM key)
   docker compose -f docker-compose.coordinator.yml -p aware-2 restart coordinator

   # Postgres (password — requires migration; coordinate with DBA)
   # See ADR-022 follow-up for the password-rotation playbook
   ```

4. Verify the new secret is in effect:

   ```bash
   # Coordinator token test
   NEW_TOKEN=$(grep AWARE_COORDINATOR_TOKEN ~/.<host-secret-dir>/ACTIVE-CREDENTIALS.env | cut -d= -f2)
   curl -sS -X POST http://127.0.0.1:18081/coordinate \
     -H "Authorization: Bearer $NEW_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"problem": "rotation-test", "task_type": "simple", "K": 1}'
   # Expected: 200 OK with non-empty envelope
   ```

5. **Revoke the old secret** in the secret store. Do not keep a grace
   period — AWARE's coordinator auth is fail-closed, so a leaked old
   token stops working immediately on rotation.

## Kill-switch drill (cutover hardening)

In a real incident, you may need to immediately stop AWARE from accepting
new `/coordinate` requests without taking the database down. The
kill-switch is the gateway service — stopping the gateway stops all
inbound reasoning traffic at the HTTP layer, while the coordinator and
postgres remain available for forensics.

**Drill procedure (run quarterly):**

1. **Pre-drill:** Verify the gateway is healthy and accepting traffic.

   ```bash
   curl -sS http://127.0.0.1:3000/health
   ```

2. **Trigger the kill-switch:**

   ```bash
   docker compose -f docker-compose.coordinator.yml -p aware-2 stop gateway
   ```

3. **Verify the kill:**

   ```bash
   # Should fail with connection refused or 502
   curl -sS -m 5 http://127.0.0.1:3000/api/audit/chain -i
   # Expected: connection refused (gateway container is stopped)

   # Coordinator should STILL be reachable (kill-switch isolates at gateway)
   curl -sS -m 5 http://127.0.0.1:18081/health
   # Expected: 200 OK
   ```

4. **Restore:**

   ```bash
   docker compose -f docker-compose.coordinator.yml -p aware-2 start gateway
   curl -sS http://127.0.0.1:3000/health
   # Expected: 200 OK
   ```

5. **Document the drill:**

   ```bash
   echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) — kill-switch drill completed. Total down-time: ~30s." \
     >> evidence/kill-switch-drills.log
   ```

The drill verifies: (a) the gateway is genuinely the only path for
inbound reasoning traffic, (b) the coordinator and database remain
available for incident response, (c) the restore procedure is documented
and rehearsed.

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `docker compose config` fails | Compose file syntax error | Run `docker compose config` for line-numbered error; fix and re-validate |
| Image build fails on heavy-think clone | `HEAVY_THINK_TAG` doesn't exist on local Gitea | Pull the heavy-think tag from origin, push to local Gitea, or update `HEAVY_THINK_TAG` in compose args |
| Coordinator healthcheck times out | Missing `AWARE_COORDINATOR_TOKEN` env var | Coordinator boots fail-closed in production; set the env var per `bring-up-coordinator.sh` bridging logic |
| Postgres won't start | Missing `AWARE_POSTGRES_PASSWORD` | Set the env var; postgres requires the password at init time, so wiping the volume may be needed |
| Gateway CORS rejects all requests | `AWARE_GATEWAY_ALLOWED_ORIGINS` not set or wrong | Set the env var to your real origin(s); restart gateway |
| `/api/audit/chain` returns 500 | `AUDIT_DIR` not writable | Confirm the `aware-2-audit-data` volume is mounted RW on the coordinator; check permissions on `/data/audit` inside the container |

## What this SOP does NOT cover

- **Capacity planning** (covered by `docs/sop/sop-phase-4-completion.json`)
- **DPO data flywheel** (covered by `docs/sop/sop-phase-4-dpo-dataset-pipeline.json`)
- **Self-play / AZR training** (covered by `docs/sop/sop-phase-3-azr-self-play.json`)
- **Modal ephemerality for trainer profile** (covered in ADR-040 / MODAL.md)

These are orthogonal to the cutover sequence.

## Operator checklist (cutover day)

Print this out and tick boxes:

- [ ] Stage 1: `docker compose config` exits 0
- [ ] Stage 2: Both images built; image SHAs recorded
- [ ] Stage 3: All four services `healthy`
- [ ] Stage 4: Smoke tests all return expected values
- [ ] Stage 5: All four Forge-owned runtime evidence gates passed; transcripts in `evidence/v2.5.0-staging-bringup-<date>.md`
- [ ] CORS allowlist set to production origins; verified via OPTIONS preflight
- [ ] Secret rotation cadence confirmed in ops calendar
- [ ] Kill-switch drill completed; entry in `evidence/kill-switch-drills.log`
- [ ] Compose file diff vs `main` reviewed for any untracked local overrides
- [ ] Rollback plan: `git checkout v2.4.0 && docker compose -f docker-compose.coordinator.yml -p aware-2 --profile full up -d`

If any box is unchecked at end-of-day, the cutover is paused until the
operator and Forge resolve the gap. There is no "rush it" override.
