# Film2Vec

Explore ~6,000 top-rated films as an interactive 3D map, where films about similar things sit close together. Search for any film to see its 5 most (or least) similar matches.

Each film's genres, keywords and overview (from [TMDb](https://www.themoviedb.org/)) are embedded with the [`all-mpnet-base-v2`](https://huggingface.co/sentence-transformers/all-mpnet-base-v2) sentence-transformer into 768-D vectors. Similarity is exact cosine similarity, and the 3D map is a [UMAP](https://umap-learn.readthedocs.io/) projection rendered with Three.js.

## Run it

The precomputed data is included, so no API key is needed to run the site.

```bash
git clone https://github.com/DickonC/film2vec.git
cd film2vec
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn server:app
```

Then open http://127.0.0.1:8000.

## Rebuild the data (optional)

`Film2Vec.ipynb` fetches films from TMDb and regenerates the embeddings. It needs a TMDb API read access token in a `.env` file:

```
TMDB_API_KEY=your_token_here
```

## Project layout

| File | Purpose |
|---|---|
| `Film2Vec.ipynb` | Fetch from TMDb, embed, save data files |
| `movie_embeddings.npy` / `movie_metadata.parquet` | Embeddings and matching film metadata |
| `projection.py` / `movie_umap3d.npy` | UMAP 3D projection and its cache |
| `server.py` | FastAPI backend + static file server |
| `static/` | Frontend (Three.js, Fuse.js) |

See [Film2VecExplained.md](Film2VecExplained.md) for a deeper write-up of the pipeline and design choices.

---

This product uses the TMDb API but is not endorsed or certified by TMDb.
