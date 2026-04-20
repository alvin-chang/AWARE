"""
hybrid_search.py — Hybrid BM25 + cosine search with Reciprocal Rank Fusion.

Pipeline:
  1. BM25 keyword search via FTS5 (diary_store.fuzzy_search)
  2. Cosine semantic search over stored embeddings
  3. RRF merge of both ranked lists
"""
import numpy as np
from .embedding_model import EmbeddingModel


def reciprocal_rank_fusion(
    results_lists: list[list[tuple]], k: int = 60
) -> list[tuple[str, float]]:
    """
    RRF merge — combines ranked lists from different retrieval methods.

    Each list is a list of (score, doc_id, score) tuples ranked by relevance.
    Returns list of (doc_id, rrf_score) sorted descending.
    """
    scores: dict[str, float] = {}
    for results in results_lists:
        for rank, item in enumerate(results):
            doc_id = item[1]  # (_, doc_id, _)
            rrf = 1.0 / (k + rank + 1)
            scores[doc_id] = scores.get(doc_id, 0.0) + rrf
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)


class HybridSearch:
    """
    Hybrid search: BM25 (keyword) + cosine (semantic) + RRF merge.

    - BM25 from diary_store.fuzzy_search()
    - Cosine similarity from stored embeddings
    - RRF merges both ranked lists
    """

    def __init__(self, diary_store, embedding_model: EmbeddingModel):
        self.diary_store = diary_store
        self.model = embedding_model

    def search(self, query: str, limit: int = 10) -> list[dict]:
        # 1. BM25 results (from existing diary_store FTS5)
        bm25_results = self.diary_store.fuzzy_search(query, limit=limit)

        # 2. Semantic results (cosine similarity over all embeddings)
        query_emb = self.model.encode_single(query)
        all_entries = self.diary_store.get_all_entries()
        scored = []
        for entry in all_entries:
            raw = entry.get("embedding")
            if raw is not None:
                emb = np.frombuffer(raw, dtype=np.float32)
                if emb.shape[0] == EmbeddingModel.DIM:
                    score = self.model.cosine_similarity(query_emb, emb)
                    scored.append((score, entry["id"]))
        semantic_results = sorted(scored, key=lambda x: x[0], reverse=True)[:limit]

        # 3. Build ranked tuples for RRF
        # BM25: FTS5 returns negative BM25 score (lower = better); we use linspace for rank
        bm25_ranked: list[tuple] = [
            (s, r["id"], s)
            for r, s in zip(
                bm25_results,
                np.linspace(1.0, 0.1, len(bm25_results)) if bm25_results else [],
            )
        ]
        semantic_ranked: list[tuple] = [
            (score, doc_id, score) for score, doc_id in semantic_results
        ]

        merged = reciprocal_rank_fusion([bm25_ranked, semantic_ranked])

        # 4. Return full entries with merged RRF scores
        id_to_entry = {e["id"]: e for e in all_entries}
        results = []
        for doc_id, rrf_score in merged[:limit]:
            entry = id_to_entry.get(doc_id)
            if entry:
                entry_copy = dict(entry)
                # Remove raw embedding bytes before returning JSON
                entry_copy.pop("embedding", None)
                entry_copy["hybrid_score"] = rrf_score
                results.append(entry_copy)
        return results
