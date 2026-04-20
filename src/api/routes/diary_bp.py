"""
src/api/routes/diary_bp.py — Diary REST API blueprint.

Auth: Bearer token in Authorization header (simple JWT validation).
      In production, share the secret with the Node.js gateway.
"""
import os
import sys
import time
import functools
from flask import Blueprint, request, jsonify, g

# ── Fix sys.path so absolute imports work ──────────────────────────────────────
# __file__ = .../src/api/routes/diary_bp.py
# Up 3 dirs = src/  (add it so 'from db.xxx' and 'from embeddings.xxx' resolve)
_PROJECT_SRC = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _PROJECT_SRC not in sys.path:
    sys.path.insert(0, _PROJECT_SRC)

from db.diary_store import DiaryStore

diary_bp = Blueprint("diary", __name__, url_prefix="/api/diary")

# ─── Auth decorator ────────────────────────────────────────────────────────────

def require_auth(f):
    """Validate Bearer JWT. Reads SECRET from DIARY_SECRET env."""
    secret = os.environ.get("DIARY_SECRET", "dev-secret-change-in-production")
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        from jwt import decode, PyJWTError
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return jsonify({"error": "Missing or invalid Authorization header"}), 401
        token = auth[7:]
        try:
            payload = decode(token, secret, algorithms=["HS256"])
            g.agent_id = payload.get("sub", payload.get("agent_id", "unknown"))
        except PyJWTError:
            return jsonify({"error": "Invalid or expired token"}), 401
        return f(*args, **kwargs)
    return wrapper


# ─── Embedding queue (lazy singleton) ────────────────────────────────────────

_embedding_queue = None

def get_embedding_queue():
    global _embedding_queue
    if _embedding_queue is None:
        from embeddings import EmbeddingQueue
        _embedding_queue = EmbeddingQueue(max_workers=2)
    return _embedding_queue


# ─── Store helper ─────────────────────────────────────────────────────────────

def get_store():
    if "store" not in g:
        g.store = DiaryStore()
    return g.store


# ─── Routes ───────────────────────────────────────────────────────────────────

@diary_bp.route("/entries", methods=["GET"])
@require_auth
def list_entries():
    """List diary entries, newest first."""
    store = get_store()
    agent_id = request.args.get("agent_id")
    limit = min(int(request.args.get("limit", 50)), 200)
    entries = store.list_entries(agent_id=agent_id, limit=limit)
    for e in entries:
        e.pop("embedding", None)
    return jsonify({"entries": entries, "total": len(entries)})


@diary_bp.route("/entries/<diary_id>", methods=["GET"])
@require_auth
def get_entry(diary_id):
    """Fetch a single diary entry by id."""
    store = get_store()
    entry = store.get_entry(diary_id)
    if not entry:
        return jsonify({"error": "Entry not found"}), 404
    entry.pop("embedding", None)
    return jsonify(entry)


@diary_bp.route("/entries", methods=["POST"])
@require_auth
def add_entry():
    """
    Create a new diary entry.

    Body: { "content": "...", "agent_id": "optional override" }
    Returns immediately; embedding is computed async in background.
    """
    data = request.get_json() or {}
    content = data.get("content", "").strip()
    if not content:
        return jsonify({"error": "content is required"}), 400

    agent_id = data.get("agent_id") or getattr(g, "agent_id", "unknown")
    store = get_store()
    entry_id = store.insert(agent_id=agent_id, content=content)

    # Kick off async embedding — don't block response
    try:
        queue = get_embedding_queue()
        queue.enqueue(entry_id, content)
    except Exception as e:
        print(f"[diary_bp] Failed to enqueue embedding for {entry_id}: {e}")

    return jsonify({
        "id": entry_id,
        "agent_id": agent_id,
        "content": content,
        "created_at": time.time(),
        "embedding_status": "queued",
    }), 201


@diary_bp.route("/entries/<diary_id>", methods=["DELETE"])
@require_auth
def delete_entry(diary_id):
    """Delete a diary entry by id."""
    store = get_store()
    deleted = store.delete_entry(diary_id)
    if not deleted:
        return jsonify({"error": "Entry not found"}), 404
    return jsonify({"deleted": diary_id})


# ─── Search ──────────────────────────────────────────────────────────────────

@diary_bp.route("/search/fuzzy", methods=["POST"])
@require_auth
def fuzzy_search():
    """BM25 keyword-only search via FTS5. Body: { "query": "...", "limit": 10 }"""
    data = request.get_json() or {}
    query = data.get("query", "").strip()
    if not query:
        return jsonify({"error": "query is required"}), 400
    limit = min(int(data.get("limit", 10)), 50)
    store = get_store()
    results = store.fuzzy_search(query, limit=limit)
    for r in results:
        r.pop("embedding", None)
    return jsonify({"results": results, "total": len(results)})


@diary_bp.route("/search/hybrid", methods=["POST"])
@require_auth
def hybrid_search():
    """Hybrid BM25 + semantic search with RRF fusion."""
    data = request.get_json() or {}
    query = data.get("query", "").strip()
    if not query:
        return jsonify({"error": "query is required"}), 400
    limit = min(int(data.get("limit", 10)), 50)

    from embeddings import HybridSearch, EmbeddingModel
    store = get_store()
    model = EmbeddingModel()
    search = HybridSearch(store, model)
    results = search.search(query, limit=limit)
    return jsonify({"results": results, "total": len(results)})


@diary_bp.route("/embed/status/<diary_id>", methods=["GET"])
@require_auth
def embed_status(diary_id):
    """Check if embedding has been computed for a given entry."""
    store = get_store()
    emb = store.get_embedding(diary_id)
    return jsonify({
        "diary_id": diary_id,
        "embedding_computed": emb is not None,
        "embedding_dim": 384 if emb else None,
    })
