# Contributing to Mind Palace

Thanks for your interest in improving Mind Palace! This guide gets you set up.

## Development setup

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# Point at a Postgres with pgvector (+ Apache AGE for graph features)
export DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/mindpalace
export DATABASE_URL_SYNC=postgresql+psycopg2://user:pass@localhost:5432/mindpalace

alembic upgrade head          # create the schema
uvicorn mind_palace.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev                   # Vite dev server, proxies /api → :8000
```

## Project conventions

- **Backend** — FastAPI + async SQLAlchemy. Keep request handlers thin; put logic in
  `services/`. Graph and search operations run in isolated DB sessions on purpose
  (see `docs/ARCHITECTURE.md`) — preserve that when touching them.
- **Frontend** — React + TypeScript. The design system lives in `src/styles/tokens.css`
  and `src/components/ui`; reuse those primitives instead of ad-hoc styles. Run
  `npx tsc --noEmit` before opening a PR.
- **Migrations** — schema changes go through Alembic (`alembic revision -m "..."`).
  The DDL source of truth is `backend/migrations/001_init.sql`, executed by the
  initial migration.

## Database extensions

- **pgvector** is required for semantic search (standard/advanced modes).
- **Apache AGE** powers the knowledge graph. Both degrade gracefully if missing —
  the app still runs (FTS-only, no graph) so contributors without AGE can develop.

## Pull requests

1. Fork & branch from `main`.
2. Keep changes focused; update docs when behavior changes.
3. Ensure `tsc --noEmit` passes and the backend imports cleanly.
4. Describe the change and how you tested it.

## Deployment modes

When adding features that depend on embeddings, vision, or NER, gate them on
`settings.mode_level` (1 = light, 2 = standard, 3 = advanced) so the app keeps working
in **light** mode on any laptop.
