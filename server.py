"""Film2Vec local web server.

    uvicorn server:app --reload
then open http://127.0.0.1:8000
"""
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from projection import EMBEDDINGS_PATH, load_or_build_projection

ROOT = Path(__file__).parent

embeddings = np.load(EMBEDDINGS_PATH).astype(np.float32)
# Normalise once so cosine similarity is a single matrix-vector product.
embeddings /= np.linalg.norm(embeddings, axis=1, keepdims=True)
metadata = pd.read_parquet(ROOT / "movie_metadata.parquet").reset_index(drop=True)
coords = load_or_build_projection(embeddings)

assert len(embeddings) == len(metadata) == len(coords), "embeddings/metadata row mismatch"

# Built once at startup; the frontend fetches it in a single request.
FILMS = [
    {
        "i": i,
        "id": int(row.id),
        "title": row.title,
        "genres": row.genres,
        "year": str(getattr(row, "release_date", "") or "")[:4],
        "vote": round(float(row.vote_average), 2),
        "xyz": [round(float(c), 4) for c in coords[i]],
    }
    for i, row in enumerate(metadata.itertuples())
]

app = FastAPI(title="Film2Vec")


@app.middleware("http")
async def no_cache(request, call_next):
    # Make the browser revalidate static files so edits show up on a normal reload.
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/api/films")
def films():
    return FILMS


@app.get("/api/similar/{i}")
def similar(i: int, k: int = 5, least: bool = False):
    """Top-k films by cosine similarity to film i (or bottom-k if least=True)."""
    if not 0 <= i < len(embeddings):
        raise HTTPException(404, "Unknown film index")
    scores = embeddings @ embeddings[i]
    rank = scores.copy() if least else -scores  # ascending rank = best first
    rank[i] = np.inf  # exclude the query film itself
    k = min(k, len(scores) - 1)
    top = np.argpartition(rank, k)[:k]
    top = top[np.argsort(rank[top])]
    return [{**FILMS[j], "score": round(float(scores[j]), 4)} for j in top]


app.mount("/", StaticFiles(directory=ROOT / "static", html=True), name="static")
