"""
embedding_model.py — Local sentence-transformer embedding model.

Uses all-MiniLM-L6-v2 (384-dim) running on CPU.
No external API required — fully air-gapped compatible.
"""
import numpy as np
from sentence_transformers import SentenceTransformer


class EmbeddingModel:
    """Local embedding model using all-MiniLM-L6-v2."""

    MODEL_NAME = "all-MiniLM-L6-v2"
    DIM = 384  # output dimension

    def __init__(self, device: str = "cpu"):
        self.model = SentenceTransformer(self.MODEL_NAME, device=device)

    def encode(self, texts: list[str]) -> list[np.ndarray]:
        """Encode a batch of texts. Returns list of DIM-dimensional float32 vectors."""
        if not texts:
            return []
        embeddings = self.model.encode(
            texts,
            convert_to_numpy=True,
            show_progress_bar=False,
            batch_size=32,
        )
        return [emb.astype(np.float32) for emb in embeddings]

    def encode_single(self, text: str) -> np.ndarray:
        """Convenience wrapper for a single text."""
        return self.encode([text])[0]

    @staticmethod
    def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        """Numerically stable cosine similarity."""
        return float(
            np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8)
        )
