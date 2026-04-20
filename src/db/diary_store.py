"""
diary_store.py — SQLite-backed diary fragment store with FTS5 and embedding support.
"""
from __future__ import annotations
import sqlite3
import os
import uuid
import time
from pathlib import Path

DB_PATH = os.environ.get("DIARY_DB_PATH", str(Path(__file__).parent.parent.parent / "data" / "diary.db"))


class DiaryStore:
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        _dir = os.path.dirname(db_path)
        if _dir:
            os.makedirs(_dir, exist_ok=True)
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.init_db()

    def init_db(self):
        """Create tables and FTS index."""
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS diary_fragments (
                id          TEXT PRIMARY KEY,
                agent_id    TEXT NOT NULL,
                content     TEXT NOT NULL,
                embedding   BLOB,
                created_at  REAL NOT NULL
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS diary_fts
            USING fts5(content, content_rowid=rowid,
                       tokenize='porter unicode61');
        """)
        self.conn.commit()
        self._migrate_embedding()

    def _migrate_embedding(self):
        """Add embedding column if it doesn't exist (idempotent migration)."""
        cur = self.conn.execute(
            "SELECT COUNT(*) FROM pragma_table_info('diary_fragments') WHERE name='embedding'"
        ).fetchone()[0]
        if cur == 0:
            self.conn.execute("ALTER TABLE diary_fragments ADD COLUMN embedding BLOB")
            self.conn.commit()

    # ─── Write ───────────────────────────────────────────────────────────────

    def insert(self, agent_id: str, content: str) -> str:
        """Insert a new diary fragment. Returns the new id."""
        entry_id = str(uuid.uuid4())
        ts = time.time()
        self.conn.execute(
            "INSERT INTO diary_fragments (id, agent_id, content, created_at) VALUES (?,?,?,?)",
            (entry_id, agent_id, content, ts),
        )
        # Keep FTS in sync
        self.conn.execute(
            "INSERT INTO diary_fts(rowid, content) "
            "SELECT rowid, content FROM diary_fragments WHERE id=?",
            (entry_id,),
        )
        self.conn.commit()
        return entry_id

    def update_embedding(self, diary_id: str, embedding_bytes: bytes):
        """Store a pre-computed embedding for a diary fragment."""
        self.conn.execute(
            "UPDATE diary_fragments SET embedding=? WHERE id=?",
            (embedding_bytes, diary_id),
        )
        self.conn.commit()

    # ─── Read ─────────────────────────────────────────────────────────────────

    def get_entry(self, diary_id: str) -> dict | None:  # type: ignore[name-defined]
        row = self.conn.execute(
            "SELECT id, agent_id, content, embedding, created_at FROM diary_fragments WHERE id=?",
            (diary_id,),
        ).fetchone()
        return dict(row) if row else None

    def get_embedding(self, diary_id: str) -> bytes | None:  # type: ignore[name-defined]
        row = self.conn.execute(
            "SELECT embedding FROM diary_fragments WHERE id=?", (diary_id,)
        ).fetchone()
        return row[0] if row else None

    def get_all_entries(self) -> list[dict]:
        cur = self.conn.execute(
            "SELECT id, agent_id, content, embedding, created_at FROM diary_fragments"
        )
        return [dict(r) for r in cur.fetchall()]

    def list_entries(self, agent_id: str | None = None, limit: int = 50) -> list[dict]:  # type: ignore[name-defined]
        if agent_id:
            cur = self.conn.execute(
                "SELECT id, agent_id, content, created_at FROM diary_fragments "
                "WHERE agent_id=? ORDER BY created_at DESC LIMIT ?",
                (agent_id, limit),
            )
        else:
            cur = self.conn.execute(
                "SELECT id, agent_id, content, created_at FROM diary_fragments "
                "ORDER BY created_at DESC LIMIT ?",
                (limit,),
            )
        return [dict(r) for r in cur.fetchall()]

    def fuzzy_search(self, query: str, limit: int = 10) -> list[dict]:
        """BM25-ranked full-text search via FTS5."""
        try:
            cur = self.conn.execute(
                """
                SELECT df.id, df.agent_id, df.content, df.embedding, df.created_at,
                       bm25(diary_fts) AS score
                FROM diary_fts
                JOIN diary_fragments df ON diary_fts.rowid = df.rowid
                WHERE diary_fts MATCH ?
                ORDER BY score
                LIMIT ?
                """,
                (query, limit),
            )
            return [dict(r) for r in cur.fetchall()]
        except sqlite3.OperationalError:
            # FTS query parse error — fall back to LIKE
            cur = self.conn.execute(
                "SELECT id, agent_id, content, embedding, created_at FROM diary_fragments "
                "WHERE content LIKE ? ORDER BY created_at DESC LIMIT ?",
                (f"%{query}%", limit),
            )
            return [dict(r) for r in cur.fetchall()]

    def delete_entry(self, diary_id: str) -> bool:
        row = self.conn.execute(
            "SELECT rowid FROM diary_fragments WHERE id=?", (diary_id,)
        ).fetchone()
        if not row:
            return False
        self.conn.execute(
            "DELETE FROM diary_fts WHERE rowid=?", (row[0],)
        )
        self.conn.execute("DELETE FROM diary_fragments WHERE id=?", (diary_id,))
        self.conn.commit()
        return True

    def close(self):
        self.conn.close()
