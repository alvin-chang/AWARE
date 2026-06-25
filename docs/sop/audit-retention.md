# Audit Retention Policy

**Status:** Active (added 2026-06-25, C-step finding #17 / AR-HIGH-002)
**Owner:** Operator
**Related:** ADR-018 (decision-chain traceability), `src/audit/decision-logger.js`, `src/db/logger.js`, `scripts/audit-retention-cleanup.js`

## Why

AWARE's compliance posture advertises DORA Art.26 / SOC2 CC7.2 / ISO 27001
A.12.4.1 compatibility. Each of those standards requires incident logging
with a documented retention window. Prior to this SOP, AWARE wrote to:

- `decision-chain.jsonl` (filesystem, `/data/audit/`)
- Postgres `aware_conversations` table

…indefinitely, with no automated cleanup. This violates the retention
requirement implicit in those compliance claims and risks unbounded disk
growth in long-lived deployments.

## Policy

| Surface | Default retention | Configurable via |
|---|---|---|
| `decision-chain.jsonl` (hash-chained audit) | 2555 days (7 years) | `AWARE_AUDIT_RETENTION_DAYS` |
| `aware_conversations` (Postgres) | 2555 days (7 years) | `AWARE_AUDIT_RETENTION_DAYS` |

**Why 7 years (DORA Art.26 baseline):** DORA Art.26 requires ICT-related
incident records to be retained for the duration deemed appropriate by
the competent authority. The financial-services industry has converged
on 5-7 years. We default to 7 years (the upper bound) because:

1. Under-retention is a compliance failure; over-retention is recoverable.
2. The JSONL chain is append-only and tamper-evident, so the cost of
   retaining a record is small relative to the cost of losing an audit
   trail.

Operators can override per-deployment by setting `AWARE_AUDIT_RETENTION_DAYS`
to the regulatory minimum that applies to their jurisdiction.

## Cleanup mechanism

The `scripts/audit-retention-cleanup.js` script is the canonical
cleanup mechanism. It is **idempotent** — running it twice on the same
day with the same retention window deletes no additional records.

### What it does

**1. JSONL chain (`/data/audit/decision-chain.jsonl`):**

- Reads all records in the live chain.
- For records older than the retention window:
  - Appends them to `/data/audit/archive/decision-chain-YYYY-MM-DD.jsonl`
    (one file per cleanup day, append-mode).
  - Removes them from the live chain.
- Recomputes the hash chain for the kept records, starting from the
  genesis hash. The chain link between the last-archived and first-kept
  record is intentionally broken — the archive file IS the old chain.
  This preserves the tamper-evidence property of the kept chain (it
  starts from a known genesis hash) without retaining stale records.

**2. Postgres `aware_conversations`:**

- `DELETE FROM aware_conversations WHERE created_at < $1` where
  `$1 = now() - AWARE_AUDIT_RETENTION_DAYS`.
- Skipped (no-op) when `AWARE_DB_ENABLED=0` or env vars are unset.

### What it does NOT do

- It does **not** rotate the index file (`decision-chain.idx`) — the
  index is rebuilt on next coordinator boot from the chain itself.
- It does **not** call `pg_dump` or any backup mechanism. Operators
  who need archival backups of the chain should run their own
  Postgres / filesystem backup tooling alongside this script.
- It does **not** delete records inside the retention window, even if
  they're known-bad (that's a security concern handled by ADR-018's
  separate revocation flow, which is out of scope here).

### Running it

```bash
# Default (7-year retention):
node scripts/audit-retention-cleanup.js

# Override retention:
AWARE_AUDIT_RETENTION_DAYS=90 node scripts/audit-retention-cleanup.js

# Skip Postgres cleanup (chain-only):
AWARE_DB_ENABLED=0 node scripts/audit-retention-cleanup.js
```

### Cron

Install a daily schedule. The script is idempotent, so running it more
often than once a day is harmless but wasteful. Recommended:

```cron
# /etc/cron.d/aware-audit-retention (operator-specific install path)
0 3 * * * cd /opt/aware && node scripts/audit-retention-cleanup.js >> /var/log/aware-audit-retention.log 2>&1
```

The default 03:00 UTC slot matches the existing `revenue-ops-grant-radar`
and `mirofish-reaper-daily` cron jobs that already run at 03:00 — it
spreads load across the early-morning window.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Cleanup ran (with or without deletions) |
| 2 | `AWARE_AUDIT_RETENTION_DAYS` was non-numeric or non-positive |

Exit code 2 indicates a config error and should page the operator.
Exit code 0 with `deleted=0 archived=0` is the steady-state behavior
when the audit log has nothing older than the retention window.

## Verification

After running the script, verify the chain is intact:

```bash
# The gateway exposes /api/audit/verify (C-step finding #16):
curl -sS http://127.0.0.1:18080/api/audit/verify | jq .

# Expected response shape:
# {
#   "success": true,
#   "verified": true,
#   "verifiedAt": "2026-06-25T..."
# }
```

If `verified: false`, the chain has been tampered with. Investigate
before re-running cleanup.

## Compliance claim support

When making any DORA/SOC2/ISO 27001 claim about AWARE:

> "Audit records are retained for `AWARE_AUDIT_RETENTION_DAYS` days
> (default 7 years). The retention policy is implemented by
> `scripts/audit-retention-cleanup.js`, run daily via cron, with
> archived records stored in `/data/audit/archive/`."

If the operator's deployment uses a different retention value, that
value (not the default) should appear in the claim.

## Operator-owned (not code-fixable)

The following items require operator action and cannot be implemented
in code:

- **Crontab installation.** The script is in the repo but the cron
  entry must be installed on each deployment host.
- **Backup strategy.** Archive files in `/data/audit/archive/` are not
  backed up by AWARE itself; operators should configure their own
  off-host backup for that directory.
- **Compliance audit evidence.** When auditors ask for proof of
  retention, the script's stdout log + the archive directory's
  filesystem mtimes are the primary evidence. Configure log shipping
  if your auditor wants the script output retained for the same
  retention window as the records themselves.
