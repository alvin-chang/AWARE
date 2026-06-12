# AWARE 2.0 — Architecture Deep Dive

This document is the **dev-side companion** to `docs/adr/ADR-020.md`
(the architectural decision record). It explains how the v2 code is
actually organized, the data flow between stages, and the lifecycle of
a single `/coordinate` request from inbound to training.

For the operator-side onboarding, see [README.md](../../README.md).
For the "what is AWARE" question, see the v1 brief in
[docs/EVOLUTION-BRIEF.md](../EVOLUTION-BRIEF.md).

---

## The 5-stage pipeline

```
┌──────────────────────────────────────────────────────────────────────┐
│  STAGE 1: Coordinator  src/coordinator/                              │
│  ─────────────────────                                               │
│  Receives /coordinate from the gateway. Picks a tier (online →      │
│  hybrid → offline) and routes the call. Budget watchdog vetoes      │
│  over-budget requests. Result is returned to the gateway.           │
│                                                                      │
│  Key files:                                                          │
│    index.js              — entry point (coordinate + buildDefaultRouter)
│    http-server.js        — startServer(opts) → returns an http.Server
│    model-router.js       — 3-tier routing logic (makeModelRouter)
│    heavyskill-integration.js — AZR + DPO pair collection (awareHeavyThink)
│                                                                      │
│  Outbound:  aware_conversations rows (via db/logger.js)              │
└──────────┬───────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  STAGE 2: Conversation Logger  src/db/logger.js                     │
│  ─────────────────────────────────────────────                       │
│  Every /coordinate call appends a row to aware_conversations with   │
│  problem, response, model_used, cost_total_usd, ok, error, etc.     │
│  When the model returns a paired response (chosen + rejected),     │
│  the row carries a pair_path pointing at the JSONL file in          │
│  <host-config>/metaclaw/preference-pairs/.                            │
│                                                                      │
│  Key functions:                                                      │
│    logConversation(args)              — async, awaited              │
│    logConversationFireAndForget(args) — fire-and-forget for hot path│
│                                                                      │
│  Outbound: aware_conversations rows (Postgres)                      │
└──────────┬───────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  STAGE 3: PRM Score Cache  src/db/prm-cache.js                      │
│  ──────────────────────────────────────────                          │
│  Before the coordinator calls the PRM judge on a problem, the      │
│  cache is consulted. Cache key is a content hash of the problem +  │
│  reasoning + task_type + context + prm_model. On hit, the LLM call  │
│  is short-circuited; on miss, the LLM is called and the score is   │
│  cached for AWARE_PRM_CACHE_TTL_DAYS (default 30).                  │
│                                                                      │
│  Key functions:                                                      │
│    buildCacheKey({problem, reasoning, task_type, context, prm_model})│
│    getCachedScore(cacheKey) / putCachedScore(cacheKey, score)        │
│    getCacheStats() — for /version and operator debugging            │
│                                                                      │
│  Outbound: aware_prm_cache rows (Postgres)                          │
└──────────┬───────────────────────────────────────────────────────────┘
           │
           │  (Stages 4 + 5 are the training loop, behind --profile training)
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  STAGE 4: AZR Self-Play  src/coordinator/heavyskill-integration.js │
│  ──────────────────────                                              │
│  Operator-action: `MODAL_PROFILE=goodciso modal deploy training/run.py`│
│  Runs the AZR task proposer / solver on Modal A100. The proposer   │
│  generates new tasks, the solver attempts them, and the PRM judge   │
│  rates both attempts. Pairs become preference data.                 │
│                                                                      │
│  (Code for Stage 4 lives in the heavy-think sibling repo:           │
│   ~/src/heavy-think/. The AWARE-side glue is in                    │
│   src/coordinator/heavyskill-integration.js via awareHeavyThink.)  │
└──────────┬───────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  STAGE 5: DPO Trainer  src/trainer/                                 │
│  ──────────────────                                                  │
│  The TrainerPoller (src/trainer/index.js) wakes up every            │
│  AWARE_TRAINER_POLL_INTERVAL_SEC seconds. It:                       │
│    1. SELECTs unconsumed pair_path values from aware_conversations  │
│    2. Groups by file, reads unique JSONL files                      │
│    3. Dedups by _content_hash                                        │
│    4. Runs filterOutcomePairs(records, {rule, minGap, allowedTypes})│
│    5. Calls toDpoDataset(kept, ...) from heavy-think to build the   │
│       DPO dataset rows                                              │
│    6. Writes output JSONL to the trainer data volume                │
│    7. Calls modalClient.submit({runId, datasetPath, config})        │
│    8. Modal runs the QLoRA job on trained-model, writes weights to      │
│       AWARE_TRAINER_WEIGHTS_DIR/active on completion               │
│                                                                      │
│  Outcome filter:                                                     │
│    src/trainer/outcome-filter.js                                    │
│      filterOutcomePairs(records, {                                 │
│        rule: 'noop' | 'min_score_gap' | 'tag_match',                │
│        minGap: 0.05,                                                │
│        allowedTaskTypes: 'arithmetic,code,reasoning',               │
│      }) → {kept, dropped, stats}                                    │
│                                                                      │
│  Modal client:                                                       │
│    src/trainer/modal-client.js                                      │
│      makeModalClient({tokenId, tokenSecret, appName, functionName})│
│        .submit({runId, datasetPath, config})                        │
│        .cancel(runId)                                               │
│        .status(modalJobId)                                          │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Data flow for a single `/coordinate` request

1. Telegram (or A2A, or curl) POSTs to `http://gateway:18080/coordinate`
   with `{problem, task_type, context}`.
2. The gateway (`src/gateway/server.js`) authenticates the request,
   applies rate limiting (Redis), and proxies to
   `http://coordinator:18081/coordinate`.
3. The coordinator (`src/coordinator/index.js#coordinate`) does:
   - `budget.check()` — veto if over hard limit
   - `prmCache.getCachedScore()` — short-circuit on hit
   - `modelRouter.generate()` — fall through online → hybrid → offline
   - `prmCache.putCachedScore()` — cache the score on miss
   - `logConversation({problem, response, cost, ok, ...})` — fire-and-forget
   - Returns the response to the gateway
4. The gateway returns the response to the caller.
5. Background: the trainer poller wakes up, finds new preference pairs
   on disk, filters them, packages them, and submits a Modal job.

---

## Postgres schema

Five tables back the v2 pipeline:

| Table | Owner | Purpose |
|-------|-------|---------|
| `aware_conversations` | Stage 2 | Every /coordinate call, with cost, ok, error, pair_path |
| `aware_preference_pairs` | (legacy) | Old format — superseded by pair_path on aware_conversations |
| `aware_prm_cache` | Stage 3 | Content-hash-keyed PRM scores, 30-day TTL |
| `aware_runs` | (Phase 4) | Trainer run history (run_id, status, modal_job_id, weights_path) |
| `aware_training_runs` | (Phase 3) | Trainer config snapshots at submit time |

Migrations live in `db/migrations/`. The schema is owned by
`src/db/index.js#runMigrations` — the coordinator's startup script
applies them on boot. The `AWARE_DB_ENABLED=false` env var makes the
logger a no-op (useful for offline dev).

---

## The trainer lifecycle in detail

```
                                    poll
                            ┌─────────────────┐
                            ▼                 │
   ┌──────────────────┐  unconsumed pairs?   │
   │  IDLE / SLEEPING │ ───────────► yes ──► │ FETCH_PAIRS
   └──────────────────┘                     │
                                            ▼
                                    pair_path → JSONL files
                                            │
                                            ▼
                                    dedup by _content_hash
                                            │
                                            ▼
                                    filterOutcomePairs(...)
                                            │
                          ┌─────────────────┴────────────────┐
                          │ kept = 0?                       │ kept > 0?
                          ▼                                  ▼
                  ┌───────────────┐                  ┌───────────────┐
                  │  CANCELLED    │                  │  SUBMITTING   │
                  │  "no pairs    │                  │  toModal()    │
                  │  after filter"│                  └───────┬───────┘
                  └───────────────┘                          │
                                                             ▼
                                                  ┌──────────────────┐
                                                  │  RUNNING         │
                                                  │  (Modal A100)    │
                                                  │                  │
                                                  │  poll status     │
                                                  │  every 30s       │
                                                  └──────┬───────────┘
                                                  ┌───────┴────────┐
                                                  │                │
                                                  ▼                ▼
                                          ┌──────────────┐  ┌──────────────┐
                                          │  COMPLETED   │  │  FAILED      │
                                          │  → weights   │  │  → error     │
                                          │    at active/│  │    in runs   │
                                          └──────────────┘  └──────────────┘
```

The states map directly to `aware_runs.status` values: `idle`,
`fetching`, `submitting`, `running`, `completed`, `failed`, `cancelled`.

The trainer's process model is a single Node process polling Postgres
on a fixed interval. There is no message queue, no in-memory state
shared between the coordinator and the trainer. The trainer can be
restarted at any time; the next tick picks up where the last left off
because all state is in Postgres.

---

## Configuration

`src/config/index.cjs` is the single source of truth. Every env var is
a lazy getter that re-reads `process.env` on every access. This means:

- Tests can override env between requests without import-cache gymnastics
- The gateway's per-request `COORDINATOR_URL` pattern keeps working
- The kill switch takes effect immediately

**Validation** (`config.validate()`) runs at the top of the coordinator's
startup. Hard failures (mode=online without key, port collision) throw;
soft warnings (mode=offline without OLLAMA_URL) are collected by
`config.warnings()` and surfaced via `/version` and `npm run config:show`.

**Redaction** (`SECRET_NAMES`) covers `minimaxKey`, `password`,
`modalTokenId`, `modalTokenSecret`. The `config.snapshot()` output
shows these as `<redacted length=N>` so logs are safe to share.

---

## The Modal integration

`src/trainer/modal-client.js` is the bridge to Modal. It uses the real
`modal@0.8.0` JS SDK — not a hand-rolled HTTP client. The shape:

```js
const client = new ModalClient();      // picks up <redacted-credential-name>/_SECRET from env
const fn = await client.functions.fromName('aware-trainer', 'train');
const call = await fn.spawn([runId, datasetPath, config]);
const result = await call.get({timeoutMs: 18_000_000});  // 5 hours
```

**Important** (smoke 8e enforces this): there is no
`modal.Function.from_training_script` — both the JS and Python SDKs
require `modal deploy <script>` to be run once, registering the App on
Modal's side. The trainer's `submit()` does NOT do this; the operator
runs `MODAL_PROFILE=goodciso modal deploy training/run.py` once at
install time.

The Modal `App` is defined in `training/run.py`:

```python
import modal

app = modal.App("aware-trainer")

@app.function(
    name="train",
    image=...,
    gpu="A100-80GB",
    volumes={"/root/aware-data": _volume},
    timeout=18_000,
    cpu=8,
    memory=32_768,
)
def train(run_id, dataset_path, config_json):
    ...
```

`@app.function()` registers the function for `fromName()` to find.
Without the deploy, `fromName` throws "function not found."

---

## Why heavy-think is a sibling repo

`~/src/heavy-think/` is its own repo with its own version control,
test suite, and release cadence. AWARE depends on it via a file path
(`AWARE_HEAVY_THINK_PATH`, default `~/src/heavy-think/src/index.js`).
This decoupling lets heavy-think iterate independently of AWARE's v2
release schedule.

**Trade-offs:**

- ✅ Heavy-think can release breaking changes without bumping AWARE
- ✅ AWARE can pin a specific heavy-think commit by path
- ❌ No automated way to know when heavy-think has breaking changes
- ❌ Tests that touch heavy-think integration require the sibling repo
  to be checked out at the right path

For the AZR self-play and DPO dataset packaging, this is fine — both
are well-defined interfaces. For a future "shared package manager" move
(npm workspaces, git submodules, etc.), see the open question in
`<internal-doc>` under "What's designed but not built."

---

## Open questions / future work

The Phase 4 + 5 remaining work is tracked in [<internal-doc>](../../<internal-doc>).
The three open architectural decisions for Phase 4:

- **(A)** Outcome filter join key: tag-based / embedding-similarity / two-track
- **(X)** Eval integration shape: in-process / HTTP
- **(Y)** Baseline for benchmark delta: trained-model base / no-DPO-trained control

These are surfaced in the Phase 4 first-slice SOP and picked by the
operator at deploy time, not code time. The current code defaults to
"noop" / "not yet wired" / "trained-model base" — the safest no-decision
defaults.
