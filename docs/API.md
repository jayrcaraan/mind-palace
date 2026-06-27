# REST API Reference

Base path: `/api/v1`. All responses are JSON. Errors use
`{ "detail": "...", "request_id": "..." }`. Every response carries an
`X-Request-ID` and `X-Response-Time` header.

## Authentication

| Caller | How |
|---|---|
| **Human** | No `Authorization` header → treated as the admin user (`ADMIN_USER_ID`). Gate the app at your reverse proxy for production. |
| **Agent** | `Authorization: Bearer mp_agt_…` — token issued by `POST /agents`. Agents are subject to the privacy filter and permission level. |

Agents only ever see `user_memory`, `kb_entry`, and **their own** `agent_memory`.

---

## Collections

| Method | Path | Notes |
|---|---|---|
| `GET` | `/collections?scope=&flat=` | `flat=false` → nested tree with `object_count`; `scope` = `user`/`agent`/`kb` |
| `POST` | `/collections` | `{name, description?, scope, parent_collection_id?}` — agents may only create `scope=agent` |
| `PUT` | `/collections/{id}` | `{name?, description?, parent_collection_id?}` |
| `DELETE` | `/collections/{id}?cascade=` | `409` if non-empty and `cascade=false` |

## Objects

The core unit. `object_type` ∈ `user_memory` · `agent_memory` · `kb_entry`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/objects` | filters: `object_type`, `collection_id` (`none` = uncategorized), `contributor_id`, `q` (FTS), `is_pinned`, `sort=<field>:<asc\|desc>`, `page`, `page_size` |
| `POST` | `/objects` | `{object_type, subject?, content?, collection_id?, tags?, entities?, importance?, is_pinned?}` |
| `GET` | `/objects/{id}` | full object incl. `entities`, `tags`, `attachments`, `chunk_count` |
| `PUT` | `/objects/{id}` | partial update; `entities`/`tags` are full-replacement sets. Setting `importance` resets its decay clock |
| `POST` | `/objects/{id}/optimize` | re-run phase-2 enrichment (embed → ner → autolink → index) → `202` + `task_id` |
| `DELETE` | `/objects/{id}` | deletes the object **and cascades** its graph vertex + all edges |

Sortable fields: `updated_at`, `created_at`, `subject`, `importance`, `last_accessed_at`.

## Links (knowledge graph edges)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/objects/{id}/links?relationship_type=` | neighbors resolved to full objects |
| `POST` | `/objects/{id}/links` | `{target_id, link_type?}` — `link_type` ∈ RELATES_TO/REFERENCES/MENTIONS/PART_OF/THREAD |
| `DELETE` | `/objects/{id}/links/{target_id}?link_type=` | |

## Entities

| Method | Path | Notes |
|---|---|---|
| `GET` | `/entities?q=&limit=` | entities with usage counts (powers autocomplete) |

Entities are created/updated through an object's `entities` field; they auto-link
shared objects in the graph and enrich search.

## Search

| Method | Path | Notes |
|---|---|---|
| `GET` | `/search?q=&limit=&graph_boost=&object_types=&collection_ids=&entity_ids=` | hybrid FTS + vector + graph boost + rerank. **All filters (collection / entity / type / privacy) apply to both the FTS *and* vector paths.** `collection_ids` / `entity_ids` are comma-separated UUIDs. An **empty `q` with any filter set browses** those items (ranked importance→recency). `graph_boost` (0–1, default 0.15) tunes the graph-connection weight (`0` disables). Returns `score`, `snippet`, `entities`, `importance` |

## Ingestion

| Method | Path | Notes |
|---|---|---|
| `POST` | `/ingest` | multipart `file`, `object_type`, `collection_id?`, `subject?`, `importance?`. Fire-and-forget → `202` + `task_id`. **SHA-256 dedup**: an identical file already ingested returns `{status:"duplicate", object_id}` instead of creating a copy. Embedded images (PDF/docx/pptx/xlsx) are extracted as attachments and rendered inline on the entry; non-image files stay as downloadable attachments |

Track progress via the **Tasks** endpoints (`/tasks`, `/tasks/{id}`, `/tasks/stats`) — see below.

In **light/standard** mode images are **not** OCR'd — they're kept as attachments so
nothing is lost. Agents can pull and parse them themselves.

## Attachments

| Method | Path | Notes |
|---|---|---|
| `GET` | `/attachments/{id}` | metadata (filename, mime, size, `parsed_content`, `content_url`) |
| `GET` | `/attachments/{id}/content` | raw bytes (inline) — used by the UI to render/download |
| `GET` | `/attachments/{id}/data` | base64 JSON `{filename, mime_type, data}` — for agents to reconstruct & parse (≤20 MB) |

Access follows the parent object's read permission (privacy filter applies to agents).

## Tasks (background processing)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/tasks?status=&task_type=&archived=&page=&page_size=` | list (excludes archived by default). `task_type` ∈ document·memory·optimize·reindex·proactive_link·decay |
| `GET` | `/tasks/{id}` | full event timeline + `params`, `progress_percentage`, `archived_at` |
| `GET` | `/tasks/stats` | counts by status + total edges created |
| `POST` | `/tasks/{id}/archive` | toggle archived state |

Completed/failed tasks auto-archive after 7 days; archive manually anytime.

## Graph

| Method | Path | Notes |
|---|---|---|
| `GET` | `/graph?include_entities=` | full graph: object **and** entity nodes + all edges (object→object `RELATES_TO`, object→entity `ASSOCIATED_WITH`) |
| `GET` | `/graph/edges` | object→object edges only (compact) |
| `POST` | `/graph/reindex?mode=additive\|full` | rebuild shared-entity edges → `202` + `task_id`. `additive` = create missing; `full` = wipe & rebuild |
| `GET` | `/objects/{id}/links` | neighbors (graph-resolved) |
| `POST` | `/objects/{id}/links` | `{target_id, link_type?}` — create an edge (needs `link_nodes`; else proposes) |
| `DELETE` | `/objects/{id}/links/{target_id}?link_type=` | remove one edge |
| `DELETE` | `/objects/{id}/links` | **cascade** — remove every edge touching this object (keeps the object) |

## Proposals (agent → human approval)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/proposals?status=` | `pending`/`approved`/`rejected`; agents see only their own. Each item includes a human `title` + `target_subject` (never a bare UUID) |
| `GET` | `/proposals/{id}` | single proposal (powers the shareable `/proposals/:id` detail page) |
| `POST` | `/proposals` | `{proposal_type, collection_id?, target_object_id?, data}` |
| `DELETE` | `/proposals/{id}` | withdraw a pending proposal (agents: own only) |
| `POST` | `/proposals/{id}/approve` | human only; commits the change |
| `POST` | `/proposals/{id}/reject` | human only |

Proposal types: `add_user_memory`, `edit_user_memory`, `delete_item`,
`add_document`, `create_connection`.

## Agents

| Method | Path | Notes |
|---|---|---|
| `GET` | `/agents` | human only |
| `POST` | `/agents` | `{name, description?, capabilities?}` → returns the bearer token **once** |
| `PATCH` | `/agents/{id}` | update `name`/`description`/`capabilities` |
| `DELETE` | `/agents/{id}?purge=` | revoke. **By default also purges the agent's private data** — its `agent_memory`, agent-scoped collections, pending proposals, and graph vertices (shared `user_memory`/`kb_entry` it wrote is kept). `?purge=false` revokes without deleting |

**Capabilities are the only access model** (there's no separate permission level):
`read_memory`, `read_kb`, `link_nodes`, `write_memory`, `write_kb`.

**Propose-on-out-of-scope:** when an agent attempts a write it lacks the capability for
(create/edit/delete a memory or KB doc, or create a link without `link_nodes`), the API
does **not** 403 — it records the change as a **proposal** and returns `202 {proposed:true,
proposal_id}` for the human to approve. Agents with the matching write capability commit
directly.

## Health & ops

| Method | Path | Notes |
|---|---|---|
| `GET` | `/live` | liveness — process up |
| `GET` | `/ready` | readiness — `503` if DB unreachable |
| `GET` | `/api/v1/health` | full: status, version, db, inference providers, mode |
| `GET` | `/api/v1/config` | active mode + model names |
