# Film2Vec

## Project Overview
Film2Vec is a film discovery website built on vector embeddings. Each film's description is turned into a 768-dimensional vector by a sentence-embedding model, so films about similar things end up close together in vector space. The site shows the whole collection as an interactive 3D map, and lets you search for a film to find the 5 most similar (or least similar) films, ranked by cosine similarity.

Current dataset: **5,963 films** from TMDb's top-rated list (300 pages × 20 films, de-duplicated, films without an overview removed).

## Pipeline

```
TMDb API ──► Film2Vec.ipynb ──► movie_embeddings.npy  (5963 × 768, float32, unit length)
                │               movie_metadata.parquet (id, title, genres, keywords, ...)
                │
                └─ text per film: "Genres: … Keywords: … Overview: …"
                   embedded with all-mpnet-base-v2

movie_embeddings.npy ──► projection.py (UMAP 768-D → 3-D, mean-centred, scaled)
                          └─► movie_umap3d.npy (5963 × 3, cached)

server.py (FastAPI) loads all three files once at startup
   ├─ GET /api/films              → titles, metadata, 3-D coordinates
   ├─ GET /api/similar/{i}?k=5    → top-k by cosine similarity (768-D)
   ├─ GET /api/similar/{i}?least=true → bottom-k (least similar)
   └─ serves static/ (index.html, app.js, style.css)

Browser (Three.js + Fuse.js)
   ├─ 3-D point cloud, hover for title / genres / rating, click to select
   └─ "find me a film like…" fuzzy search → shows top 5 + highlights them in 3-D
```

### 1. Data collection — `Film2Vec.ipynb`
| Step | Detail |
|---|---|
| Source | TMDb API, `/movie/top_rated` (20 films per page, `PAGES = 300`; TMDb allows up to 500 pages) |
| Details | `/movie/{id}?append_to_response=keywords`, which fetches the details and keywords in one request |
| Speed | 10 parallel requests via `ThreadPoolExecutor`, with retry/backoff on rate limits (429). About 1–2 minutes for 6,000 films |
| Fields saved | `id`, `title`, `tagline`, `genres`, `keywords`, `overview`, `release_date`, `vote_average` |
| Cleaning | Duplicate IDs removed; films with an empty overview dropped |

### 2. Embedding
| | |
|---|---|
| Model | [`all-mpnet-base-v2`](https://huggingface.co/sentence-transformers/all-mpnet-base-v2) (sentence-transformers) |
| Dimensions | **768** |
| Normalisation | Unit length (`normalize_embeddings=True`), so cosine similarity = dot product |
| Text embedded | `"Genres: {genres}. Keywords: {keywords}. Overview: {overview}"` |

**What gets embedded matters more than the model.** Earlier versions embedded the title and tagline too, which caused bad matches:
- **Titles** made films match on shared words: *The Good, the Bad and the Ugly* matched *The Bad Guys* and *Big Bad Wolves*. About 49% of films had a title-word match in their top 5, against a 2% random baseline.
- **Taglines** are wordplay that the model reads literally. *Inception*'s "Your mind is the scene of the crime" made its nearest match the courtroom drama *The Collini Case*.
- **Keywords** from TMDb (e.g. *dream, subconscious, heist*) fill in what short overviews leave out. 97.7% of films have them. *Inception*'s top 5 is now *Trance, A Scanner Darkly, The Hidden, Dream Scenario, Relay*.

The first version used `all-MiniLM-L6-v2` (384-D) on title + tagline + genres + overview.

### 3. 3D mapping — `projection.py`
| | |
|---|---|
| Method | [UMAP](https://umap-learn.readthedocs.io/) (`umap-learn`) |
| Reduction | 768-D → 3-D |
| Parameters | `metric="cosine"`, `n_neighbors=10`, `min_dist=0.0`, `random_state=42` |
| Post-processing | **Mean-centred** (subtract the mean so the cloud sits at the origin), then **uniformly scaled** to an RMS radius of 1, so the view is the same size however many films there are. Uniform scaling keeps relative distances unchanged |
| Caching | Saved to `movie_umap3d.npy`. The server rebuilds it automatically if the embeddings file is newer or the film count changes (about 20–30 s for 6,000 films) |

**Limitation:** squashing 768 dimensions into 3 always loses information. On average, only about **30%** of a film's true top 5 (by cosine) are among its 5 nearest points in 3D. That is far above random (under 1%), but it means the map shows the overall shape of the collection and the ranked list shows exact similarity. The UI draws lines from the selected film to its matches so you can see where they really are.

### 4. Similarity search — `server.py`
- **Backend:** FastAPI + uvicorn. All data is loaded into memory once at startup.
- **Similarity:** the embeddings are re-normalised at startup. Similarity is computed as `embeddings @ embeddings[i]`, and the best k are found with `np.argpartition`. This takes about 1 ms for 10,000 films, and is a full exact scan with no approximation.
- **Least similar:** the same scores, ranked in ascending order.
- **Scaling:** a full scan is fine up to roughly 100k films. Beyond that, an approximate nearest-neighbour index such as FAISS would be the next step.

### 5. Frontend — `static/`
| Part | Library | Notes |
|---|---|---|
| 3D view | [Three.js](https://threejs.org/) 0.160 | All films are drawn as a single `THREE.Points` object (one draw call) with a custom shader for soft round points. Point size shrinks automatically as the number of films grows |
| Navigation | `OrbitControls` | Drag to orbit, scroll to zoom toward the cursor, right-drag to pan, slow auto-rotate while idle |
| Axes | `LineSegments` + `CSS2DRenderer` labels | x / y / z with tick marks. UMAP axes have no inherent meaning; they are a spatial reference only |
| Hover | `Raycaster` | Tooltip with title (year), genres and rating |
| Search | [Fuse.js](https://fusejs.io/) 7 | Fuzzy title matching as you type. Keyboard navigation with ↑ ↓ Enter |
| Results | `/api/similar` | Top 5 with scores. The selected film and its matches are highlighted, the other films dimmed, lines drawn to the matches, and the camera flies to the selection |
| Modes | | **most similar / least similar** toggle |
| Back | | "← back to all films" button, clicking empty space, or Esc |

## Running it

```bash
# 1. (Optional) refresh the data: run Film2Vec.ipynb in Jupyter (conda base env)
# 2. Start the site
source .venv/bin/activate          # contains requirements.txt
uvicorn server:app --reload
# open http://127.0.0.1:8000
```

## Files
| File | Purpose |
|---|---|
| `Film2Vec.ipynb` | Fetch from TMDb → build text → embed → save |
| `movie_embeddings.npy` | 5963 × 768 embedding matrix |
| `movie_metadata.parquet` | Film metadata, same row order as the embeddings |
| `projection.py` | UMAP → 3D, mean-centring and scaling, caching |
| `movie_umap3d.npy` | Cached 3D coordinates |
| `server.py` | FastAPI API + static file server |
| `static/` | `index.html`, `app.js`, `style.css` |
| `requirements.txt` | Python dependencies for the server |

**Important:** the embeddings and metadata files are matched by row number, so they must always be written together, as the notebook does.
