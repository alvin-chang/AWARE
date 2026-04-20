# PROJECT-STATE.md — AWARE-Evolution

## Phase Status

| Phase | Component | Status |
|-------|-----------|--------|
| Phase 1 | Diary FTS store (`db/diary_store.py`) | ✅ DONE |
| Phase 1 | Embedding pipeline (`embeddings/`) | ✅ DONE |
| Phase 1 | Diary API (`api/routes/diary_bp.py`) | ✅ DONE |
| Phase 2 | (not started) | ⬜ |

---

## Phase 1 — Semantic Embedding Pipeline (COMPLETED)

### What was built

**`src/db/diary_store.py`**
- SQLite-backed diary fragment store
- FTS5 virtual table with BM25 ranking (`diary_fts`)
- `embedding BLOB` column with idempotent migration
- `update_embedding(diary_id, embedding_bytes)` — persist pre-computed vectors
- `get_embedding(diary_id)` — retrieve raw bytes
- `get_all_entries()` — includes embedding bytes
- `fuzzy_search(query)` — BM25 full-text search with LIKE fallback
- `insert()`, `delete_entry()`, `list_entries()`

**`src/embeddings/embedding_model.py`**
- Local `all-MiniLM-L6-v2` model (384-dim, CPU, no GPU required)
- `encode(texts)` — batch encoding
- `encode_single(text)` — convenience single-text wrapper
- `cosine_similarity(a, b)` — stable cosine similarity

**`src/embeddings/embedding_queue.py`**
- Async background queue (daemon thread, producer/consumer pattern)
- `enqueue(diary_id, text)` — non-blocking, returns immediately
- Background thread computes embedding and persists to DB
- `shutdown()` — graceful stop
- Lazy singleton via `get_embedding_queue()`

**`src/embeddings/hybrid_search.py`**
- `HybridSearch.search(query, limit)` — BM25 + cosine + RRF merge
- `reciprocal_rank_fusion()` — RRF with k=60
- Returns entries with `hybrid_score` attached

**`src/api/__init__.py`**
- Flask app factory `create_app()`
- CORS enabled, `/health` route

**`src/api/routes/diary_bp.py`**
- JWT Bearer auth decorator (`require_auth`)
- `GET /api/diary/entries` — list entries
- `POST /api/diary/entries` — create entry + async embedding
- `GET /api/diary/entries/<id>` — single entry
- `DELETE /api/diary/entries/<id>` — delete
- `POST /api/diary/search/fuzzy` — BM25 keyword search
- `POST /api/diary/search/hybrid` — hybrid BM25+semantic search
- `GET /api/diary/embed/status/<id>` — embedding status

**`requirements.txt`**
- `flask`, `flask-cors`, `PyJWT`, `sentence-transformers>=2.2.0`, `numpy>=1.24.0`

### Running the diary service

```bash
cd ~/.openclaw/projects/AWARE-Evolution
pip install -r requirements.txt
DIARY_SECRET=<shared-secret> DIARY_DB_PATH=./data/diary.db python3 -m src.api
```

### API Port
Default: `5001` (configurable via `DIARY_PORT` env var).

---

## Notes

- All embeddings stored as 384-dim float32 blobs in SQLite
- Async queue is non-blocking: write API returns 201 immediately
- No external embedding API calls — fully air-gapped compatible
- RRF k=60 for fusion (industry standard)
