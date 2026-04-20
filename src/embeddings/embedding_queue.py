"""
embedding_queue.py — Async background queue for embedding computation.

Producer (API handler) calls enqueue(diary_id, text).
Consumer thread computes embedding and persists to DB.
Non-blocking: write API returns immediately.
"""
import queue
import threading
import numpy as np
from concurrent.futures import ThreadPoolExecutor

from .embedding_model import EmbeddingModel


class EmbeddingQueue:
    """
    Background queue that computes embeddings asynchronously.

    Producers (API handlers) enqueue (diary_id, text).
    Consumer computes embedding and stores in DB.
    """

    def __init__(self, max_workers: int = 2):
        self.model = EmbeddingModel()
        self._queue: queue.Queue = queue.Queue()
        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        self._running = True
        self._thread = threading.Thread(target=self._consume, daemon=True)
        self._thread.start()

    def enqueue(self, diary_id: str, text: str):
        """Enqueue a diary entry for embedding computation. Non-blocking."""
        self._queue.put((diary_id, text))

    def _consume(self):
        """Consumer loop — runs in daemon thread."""
        while self._running:
            try:
                diary_id, text = self._queue.get(timeout=1)
                emb = self.model.encode_single(text)
                self._store_embedding(diary_id, emb)
                self._queue.task_done()
            except queue.Empty:
                continue
            except Exception as e:
                print(f"[EmbeddingQueue] Error for {diary_id}: {e}")

    def _store_embedding(self, diary_id: str, emb: np.ndarray):
        """Persist embedding bytes to the diary store."""
        import os, sys
        _src = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if _src not in sys.path:
            sys.path.insert(0, _src)
        from db.diary_store import DiaryStore
        store = DiaryStore()
        try:
            store.update_embedding(diary_id, emb.tobytes())
        finally:
            store.close()

    def queue_size(self) -> int:
        return self._queue.qsize()

    def shutdown(self):
        """Gracefully stop the consumer thread."""
        self._running = False
        self._executor.shutdown(wait=True)
