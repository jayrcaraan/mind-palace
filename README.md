<p align="center">
  <img src="./assets/banner.png" alt="Mind Palace" width="100%" />
</p>

<p align="center">
  <b>Unified cognitive memory &amp; knowledge management for humans and AI agents.</b><br/>
  Hybrid search · Knowledge graph · Agent memory · Observable ingestion
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-0.1.0-4f46e5" />
  <img alt="python" src="https://img.shields.io/badge/python-3.11-3776AB" />
  <img alt="react" src="https://img.shields.io/badge/react-19-61DAFB" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-22c55e" />
</p>

---

## What is Mind Palace?

Mind Palace is a self-hostable memory layer. It stores your notes, documents and
agent-generated memories as richly-linked **objects**, organizes them into
**collections**, connects them through a **knowledge graph**, and retrieves them
with **hybrid search** (full-text + semantic vectors, graph-boosted and reranked).

It's built for two kinds of users at once:

- **You** — a fast, polished web app (light/dark, mobile-friendly, installable PWA)
  to capture, browse and search everything you know.
- **Your AI agents** — a REST API and an **MCP server** (26 tools) so assistants can
  read, write, and *propose* changes that you approve before they land.

---

## Highlights

| | |
|---|---|
| 🔎 **Hybrid search** | Full-text (`tsvector`) + dense vectors (pgvector HNSW) fused with Reciprocal Rank Fusion, +15% graph boost, cross-encoder rerank. |
| 🕸️ **Knowledge graph** | Apache AGE (openCypher). Objects, entities & collections become a navigable graph; auto-links by shared entities. |
| 🧠 **Three memory types** | `user_memory`, `agent_memory`, `kb_entry` — each with its own specialized tree+table workspace. |
| 🏷️ **User-entered entities** | First-class entities (person / place / org / concept …) with autocomplete; feed graph + search. |
| ✅ **Capability-scoped agents** | Capabilities are the whole access model; anything outside an agent's scope auto-becomes a proposal you approve/reject. |
| 📡 **Observable ingestion** | Step-level pipeline (parse → vision → embed → ner → autolink → index) with full execution history on the Tasks page. |
| ⚡ **Optimize & reindex** | Re-run phase-2 enrichment on any entry; rebuild shared-entity edges (additive or full), Obsidian-style. |
| ⏳ **Importance decay** | A daily pass gently decays the importance of idle items (pinned exempt) — your graph stays weighted by what matters. |
| 🎛️ **3 deployment modes** | From a laptop (no GPU) to an advanced box (vision parsing + LLM NER). |
| 🧰 **MCP server** | 26 tools (memory, graph, collections, proposals, KB) over Streamable HTTP. |

---

## Preview

<table>
  <tr>
    <td width="50%"><img src="./assets/screenshots/dashboard.png" alt="Dashboard" /><p align="center"><sub>Dashboard</sub></p></td>
    <td width="50%"><img src="./assets/screenshots/graph.png" alt="Knowledge graph" /><p align="center"><sub>Knowledge graph</sub></p></td>
  </tr>
  <tr>
    <td width="50%"><img src="./assets/screenshots/knowledge-base.png" alt="Knowledge base entry" /><p align="center"><sub>Knowledge base entry</sub></p></td>
    <td width="50%"><img src="./assets/screenshots/tasks.png" alt="Tasks" /><p align="center"><sub>Observable task pipeline</sub></p></td>
  </tr>
</table>

<p align="center">
  <img src="./assets/screenshots/create-agent.gif" alt="Creating an agent" width="70%" /><br/>
  <sub>Creating an MCP agent</sub>
</p>

---

## Architecture

```mermaid
flowchart TD
    SPA["React 19 SPA · light/dark · mobile · PWA"] -->|REST /api/v1| API
    AGENTS["AI agents"] -->|MCP · Streamable HTTP /mcp/| API

    subgraph API["FastAPI (async)"]
        ROUTES["collections · objects · search · ingest · entities<br/>links · proposals · agents · tasks · graph · health"]
        WORKER["background worker + scheduler<br/>(supervised, auto-restart)"]
    end

    API --> PG[("PostgreSQL · FTS")]
    API --> VEC[("pgvector · embeddings")]
    API --> AGE[("Apache AGE · graph")]
    WORKER -->|embed · vision · LLM| INF["Inference (OpenAI-API)<br/>Ollama / OpenAI / …"]
```

**Stack:** FastAPI · SQLAlchemy (async, asyncpg) · PostgreSQL 16 + pgvector + Apache AGE ·
any OpenAI-compatible inference provider (Ollama, OpenAI, …) · React 19 · TypeScript · Vite · TanStack Query · D3.

---

## Deployment modes

Pick the mode that matches your hardware via `DEPLOYMENT_MODE`.

| Mode | Ingestion | Embeddings | Image parsing | Entity extraction | Runs on |
|------|-----------|------------|---------------|-------------------|---------|
| **`light`** | async worker | none | attach only | regex / client-supplied | any laptop, no GPU |
| **`standard`** | async worker | `nomic-embed-text` | attach only | client-supplied | laptop + local/remote models |
| **`advanced`** | async worker | `nomic-embed-text` | `gemma4:e4b` vision | LLM NER (`gemma4:e4b`) | bigger machine |

`light` and `standard` are designed to run comfortably on a personal laptop.

---

## Quick start

### Docker Compose (recommended)

```bash
git clone <repo> mind-palace && cd mind-palace
cp .env.example .env            # then edit POSTGRES_PASSWORD etc.
docker compose up -d --build
# → app on http://localhost:8000
```

A single image builds the frontend, serves it, and runs database migrations
(`alembic upgrade head`) on startup — so `docker compose up --build` from a clean
checkout brings up the whole product. Postgres (pgvector) comes up alongside.

#### What "running locally" looks like

Everything lives on your machine — open `http://localhost:8000` and you have the full
app (UI + API + MCP). No cloud, no account. The one app container talks to a local
Postgres; inference is optional and only needed for `standard`/`advanced` modes (point
it at a local Ollama, or skip it entirely in `light` mode).

```mermaid
flowchart LR
    B["🧑 Browser<br/>localhost:8000"] --> APP
    AG["🤖 Local AI agent<br/>MCP → localhost:8000/mcp/"] --> APP
    subgraph LOCAL["your machine (docker compose)"]
        APP["mind-palace<br/>UI + API + worker + MCP"]
        APP --> DB[("Postgres<br/>pgvector + AGE")]
        APP -. "optional (standard/advanced)" .-> OLL["Ollama<br/>localhost:11434"]
    end
```

- **`light` mode** (default in `.env.example`) needs **no models and no GPU** — it runs
  anywhere Docker does. Full-text search, the knowledge graph, collections, agents and
  proposals all work; only semantic vector search and LLM features are off.
- Want semantic search locally? Set `DEPLOYMENT_MODE=standard` and point
  `INFERENCE_BASE_URL` at a local Ollama (`http://host.docker.internal:11434/v1`) with
  `ollama pull nomic-embed-text`.
- Prefer running the pieces directly (hot-reload) instead of Docker? See **Local dev** below.

### Local dev

```bash
# backend
cd backend
uv pip install -e ".[dev]"
export DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/mindpalace
export DATABASE_URL_SYNC=postgresql+psycopg2://user:pass@localhost:5432/mindpalace
alembic upgrade head                       # create / update the schema
uvicorn mind_palace.main:app --reload

# frontend (separate shell)
cd frontend
npm install
npm run dev            # Vite dev server proxies /api → :8000
```

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for the full production guide
(reverse proxy, health checks, deployment modes, inference providers).

---

## Configuration

All config is environment-driven (`backend/.env` or container env). Key variables:

| Variable | Default | Purpose |
|---|---|---|
| `ENVIRONMENT` | `production` | `production` hides stack traces & API docs |
| `ENABLE_DOCS` | `false` | expose `/docs` & `/openapi.json` |
| `DEPLOYMENT_MODE` | `standard` | `light` / `standard` / `advanced` (see table above) |
| `DATABASE_URL` | — | `postgresql+asyncpg://…` |
| `INFERENCE_BASE_URL` | `http://localhost:11434/v1` | OpenAI-compatible endpoint (shared default) |
| `EMBEDDING_MODEL` / `LLM_MODEL` / `OCR_MODEL` | — | per-provider model names (each overridable with its own base_url/api_key) |
| `BLOB_STORAGE_PATH` | `/data/blobs` | uploaded file storage |
| `CORS_ORIGINS` | `["http://localhost:3000"]` | JSON array of allowed origins |
| `ADMIN_USER_ID` | `0000…0001` | identity for un-tokened (human) requests |

Full list: **[backend/mind_palace/config.py](backend/mind_palace/config.py)** and
**[.env.example](.env.example)**.

---

## API & MCP

- **REST** — `/api/v1/{collections,objects,links,ingest,proposals,search,agents,entities,tasks,graph}`.
  See **[docs/API.md](docs/API.md)**.
- **MCP** — 26 tools over Streamable HTTP at `/mcp/` (config shown on the Agents page).
  See **[docs/MCP.md](docs/MCP.md)**.
- **Health** — `/live` (liveness), `/ready` (readiness, 503 if DB down),
  `/api/v1/health` (full: db + inference providers + mode).

---

## Project layout

```
mind-palace/
├── assets/                  # banner & brand
├── backend/
│   ├── mind_palace/
│   │   ├── api/             # REST routers
│   │   ├── models/          # SQLAlchemy models
│   │   ├── schemas/         # Pydantic schemas
│   │   ├── services/        # markitdown, inference, graph, search
│   │   ├── worker/          # supervised pipeline + daily scheduler
│   │   ├── mcp/             # MCP server over HTTP (26 tools)
│   │   ├── middleware.py    # request logging + security headers
│   │   ├── config.py        # settings
│   │   └── main.py          # app, health, lifespan
│   ├── alembic/             # migrations (single initial revision)
│   ├── migrations/001_init.sql   # canonical DDL (run by the migration)
│   ├── entrypoint.sh        # alembic upgrade head → uvicorn
│   └── Dockerfile           # multi-stage (builds SPA), non-root, healthcheck
├── frontend/
│   ├── src/
│   │   ├── components/      # ui kit, treetable, layout, modals
│   │   ├── pages/           # dashboard, memory, kb, agents, search…
│   │   └── lib/             # api, theme, hooks
│   └── public/              # PWA manifest + icons
├── docker-compose.yml
└── .env.example
```

---

## Documentation

- **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — production deployment, deployment modes, reverse proxy, backups
- **[docs/API.md](docs/API.md)** — REST endpoint reference
- **[docs/MCP.md](docs/MCP.md)** — MCP tools & agent integration
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — data model, search pipeline, graph
