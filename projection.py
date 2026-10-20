"""Project the 384-D film embeddings down to 3-D with UMAP for visualisation.

Run directly to (re)build the cached projection:
    python projection.py
"""
from pathlib import Path

import numpy as np

ROOT = Path(__file__).parent
EMBEDDINGS_PATH = ROOT / "movie_embeddings.npy"
PROJECTION_PATH = ROOT / "movie_umap3d.npy"


def build_projection(embeddings: np.ndarray, seed: int = 42) -> np.ndarray:
    import umap  # imported lazily: slow to load and only needed when rebuilding

    n = len(embeddings)
    reducer = umap.UMAP(
        n_components=3,
        # Small neighbourhood + tightly packed points keeps each film's nearest
        # neighbours closer together in 3-D, at some cost to global layout.
        n_neighbors=min(10, n - 1),
        min_dist=0.0,
        metric="cosine",
        random_state=seed,
    )
    coords = reducer.fit_transform(embeddings)

    # Mean-centre so the cloud sits around the origin, then scale uniformly
    # (RMS radius = 1) so the view is the same size however many films exist.
    coords = coords - coords.mean(axis=0)
    coords = coords / np.sqrt((coords**2).sum(axis=1).mean())
    return coords.astype(np.float32)


def load_or_build_projection(embeddings: np.ndarray) -> np.ndarray:
    """Return the cached projection, rebuilding it if missing or stale."""
    if PROJECTION_PATH.exists():
        coords = np.load(PROJECTION_PATH)
        stale = PROJECTION_PATH.stat().st_mtime < EMBEDDINGS_PATH.stat().st_mtime
        if len(coords) == len(embeddings) and not stale:
            return coords
    coords = build_projection(embeddings)
    np.save(PROJECTION_PATH, coords)
    return coords


if __name__ == "__main__":
    emb = np.load(EMBEDDINGS_PATH)
    coords = build_projection(emb)
    np.save(PROJECTION_PATH, coords)
    print(f"Saved {coords.shape} projection to {PROJECTION_PATH.name}")
