# 🏛️ Mind Palace

> **A self-hosted memory layer for you and your AI agents.**

**MIT licensed. Self-hosted. Runs on one Docker Compose command.**

---

## Why Mind Palace?

Your AI agents are getting smarter. Your knowledge is still scattered.

Inspired by Sherlock Holmes and his [mind palace](https://en.wikipedia.org/wiki/Method_of_loci) — a vivid mental space where every fact has a place and everything connects — this is that, but for the age of AI.

- 🔒 **Agent isolation by design** — each agent's token is cryptographically bound to its identity. Wrong token + wrong ID = loud 403, not a silent bad write
- 📥 **Proposal inbox** — agents suggest changes to your shared knowledge; you approve, reject, or edit before anything lands
- 📄 **Documents become knowledge** — upload a file, get full-text search in seconds; images described by a vision model, entities extracted and linked in the graph automatically
- 🔍 **Three-way hybrid search** — full-text + vector similarity + graph traversal, fused in one query
- 🏠 **Yours, entirely** — self-hosted, MIT licensed, runs on one `docker compose up`. Point it at any OpenAI-compatible endpoint — Ollama, OpenAI, or anything else

---

## What it stores

Everything is a **Node**. Nodes have a `content_type`:

| Type | Description |
|---|---|
| `memory` | A discrete piece of knowledge — a fact, preference, or observation |
| `document` | A full document ingested from a file upload or agent push |
| `chunk` | A fragment of a document (child of a `document` node, auto-created on ingest) |
| `note` | Free-form writing by the user |
| `entity` | A named entity extracted from a document — person, place, organisation, concept, or technology |

Nodes live in one of three **scopes**, which determine who can read and write them:

| Scope | Written by | Read by | Notes |
|---|---|---|---|
| `agent` | Only the owning agent | Only the owning agent | Structurally isolated — other agents cannot see these nodes even if they know the ID |
| `user` | User only | All agents + user | Agents reach this scope through the proposal flow |
| `kb` | User, or agents with `kb_writer` | All agents + user | The shared knowledge base; trusted agents can write directly |

Nodes connect via typed **Edges** (`PART_OF`, `RELATES_TO`, `REFERENCES`, `MENTIONS`, `THREAD`), mirrored into Apache AGE for graph traversal.

---

## Architecture at a Glance

```mermaid
graph TB
    subgraph Human["👤 Human Interface"]
        SPA["React SPA\n(Browser)"]
    end

    subgraph Agents["🤖 AI Agents"]
        AGT1["Agent A\n(e.g. Claude)"]
        AGT2["Agent B\n(e.g. Custom)"]
    end

    subgraph API["FastAPI Server"]
        REST["REST API\n/api/v1/..."]
        MCP["MCP Server\n/mcp/v1"]
        AUTH["Auth Layer\nLocal / OIDC / Agent Token"]
        SCHED["APScheduler\nBackground Jobs"]
    end

    subgraph Store["Single Postgres 16"]
        PG["Relational\nTables"]
        VEC["pgvector\nHNSW Index"]
        FTS["tsvector\nFull-Text Index"]
        GRAPH["Apache AGE\nGraph Layer"]
    end

    subgraph Inference["Inference (OpenAI-compatible)"]
        EMBED["Embedding Model\ne.g. nomic-embed-text"]
        LLM2["LLM / VLM\ne.g. gemma4:e4b"]
    end

    SPA -->|Cookie + CSRF| REST
    AGT1 -->|"Bearer token\n+ X-Agent-Id"| MCP
    AGT2 -->|"Bearer token\n+ X-Agent-Id"| MCP
    REST --> AUTH
    MCP --> AUTH
    AUTH --> PG
    PG --- VEC
    PG --- FTS
    PG --- GRAPH
    SCHED --> PG
    REST --> EMBED
    MCP --> EMBED
    REST --> LLM2
    MCP --> LLM2
```

---

## The Two Surfaces

Mind Palace exposes the same underlying data through two distinct surfaces, authenticated differently:

```mermaid
graph LR
    subgraph HumanSurface["Human Surface"]
        SPA2["SPA / Browser"]
        REST2["REST API"]
        SESS["Session Cookie\n(argon2id local or OIDC)"]
    end

    subgraph AgentSurface["Agent Surface"]
        CLINE["Claude / Cursor / Custom"]
        MCPS["MCP Server"]
        TOKEN["Bearer mp_agt_...\n+ X-Agent-Id header"]
    end

    subgraph Data["Mind Palace Data"]
        PRIV["agent scope\n(isolated per agent)"]
        USER["user scope\n(user-curated)"]
        KB["kb scope\n(knowledge base)"]
    end

    SPA2 --> REST2 --> SESS --> USER
    SPA2 --> REST2 --> SESS --> KB

    CLINE --> MCPS --> TOKEN --> PRIV
    CLINE --> MCPS --> TOKEN --> USER
    CLINE --> MCPS --> TOKEN --> KB
```

> The user never directly accesses `agent` scope nodes — those are private to each agent. Agents read `user` and `kb` freely but write to them only via proposals (or `kb_writer` capability).

---

## User Journey: Uploading a Document

When a user uploads a file through the SPA, it goes through a **two-phase pipeline**.

### Phase 1 — Synchronous: Naive Parsing (Near-Immediate)

Upload triggers an in-process **ingest queue worker** (N concurrent asyncio tasks). The file is converted to text using [MarkItDown](https://github.com/microsoft/markitdown) on a **per-page basis**, tracking image blocks as they appear — each image is saved as a separate attachment Node. A paragraph-aware chunker then breaks the text up so the document is FTS-searchable within seconds.

```mermaid
sequenceDiagram
    actor User
    participant SPA as React SPA
    participant API as FastAPI
    participant Q as Ingest Queue Worker
    participant FS as File Storage
    participant MD as MarkItDown
    participant NP as Naive Chunker
    participant DB as Postgres

    User->>SPA: Upload file (PDF, DOCX, PPTX, EML...)
    SPA->>API: POST /api/v1/documents/upload
    API->>FS: Save raw file to /data/files/{user_id}/{file_id}/
    API->>DB: INSERT parent node (document, embedding=NULL, indexing_state=queued)
    API->>Q: submit(job_id)
    API-->>SPA: 202 Accepted {node_id, job_id}

    Note over Q: asyncio worker picks up job<br/>(configurable concurrency)

    Q->>MD: extract(path, mime_type, on_page=progress_cb)
    Note over MD: Per-page extraction with SSE progress<br/>Image blocks → saved to disk<br/>  + attachment Node per image<br/>pypdf peeks page count upfront<br/>Fallback: UTF-8 plain read
    MD-->>Q: {pages[], text, page_count, has_images}

    Q->>NP: chunk_document(text, chunk_size_chars, overlap)
    Note over NP: Paragraph-aware fixed chunker<br/>Tracks which pages each chunk spans<br/>Records printed_page_label per chunk
    NP-->>Q: [Chunk(content, page_indices), ...]

    Q->>DB: BEGIN TRANSACTION
    Q->>DB: UPDATE parent node (content=full_text, metadata.has_images)
    Q->>DB: INSERT chunk nodes (embedding=NULL, metadata.raw_page_index)
    Q->>DB: INSERT PART_OF edges (chunk → parent) + AGE mirror
    Q->>DB: COMMIT — indexing_state = "chunked"

    Q-->>SPA: SSE "chunked · N chunks · text indexed"
    SPA-->>User: ✅ Indexed — enriching in background
```

### Phase 2 — Asynchronous: Deep Enrichment (Fired Immediately After Phase 1)

The moment Phase 1 commits, the ingest worker fires a non-blocking `asyncio.create_task`. Phase 2 is a **linear four-stage pipeline** that every document passes through in sequence.

```mermaid
sequenceDiagram
    participant W as Ingest Worker
    participant IP as ① Image Parsing
    participant SC as ② Semantic Chunking
    participant EMB as ③ Embedding
    participant EE as ④ Entity Extraction
    participant VLM as Vision Model
    participant LLM as LLM
    participant DB as Postgres
    participant AGE as Apache AGE

    W->>IP: asyncio.create_task [non-blocking, fires after Phase 1]

    Note over IP: Stage 1 — Image Parsing
    IP->>DB: SELECT attachment nodes WHERE source_document_id = doc_id
    loop For each image attachment (parallel, semaphore-limited)
        IP->>VLM: POST /chat/completions [image as data URI]
        Note over VLM: "Describe this image and<br/>extract all visible text.<br/>Return plain prose."
        VLM-->>IP: prose description
        IP->>DB: UPDATE attachment node SET content = description
    end
    IP->>DB: UPDATE parent content — replace <<attachment:UUID>><br/>tokens with "> [Image: description]"

    Note over SC: Stage 2 — Semantic Chunking
    SC->>SC: Versioned re-chunk on enriched text<br/>(STAGE v2 → SWAP active_version → GC v1)
    SC->>DB: INSERT new chunk nodes (section_version N+1) + PART_OF edges
    SC->>DB: UPDATE metadata.indexing_state = "chunked"

    Note over EMB: Stage 3 — Embedding
    EMB->>DB: SELECT chunk nodes (active_version) WHERE embedding IS NULL
    loop For each chunk + parent node
        EMB->>EMB: POST /embeddings → vector[768]
        EMB->>DB: UPDATE node SET embedding = vector
    end
    EMB->>DB: UPDATE metadata.indexing_state = "embedded"

    Note over EE: Stage 4 — Entity Extraction (LangGraph: extract → ground → link)
    EE->>DB: SELECT chunk nodes (active_version)
    loop [extract] — per chunk
        EE->>LLM: POST /chat/completions
        Note over LLM: "Extract named entities:<br/>people, places, orgs,<br/>concepts, technologies."
        LLM-->>EE: [{name, type}, ...]
    end
    loop [ground] — per entity candidate
        EE->>EMB: embed(entity_name) → vector[768]
        EE->>DB: SELECT nearest node (cosine distance)
        alt cosine similarity >= 0.85
            EE->>EE: link to existing node
        else new entity
            EE->>DB: INSERT entity node (scope=kb, content_type=entity)
        end
    end
    loop [link] — per grounded entity
        EE->>DB: INSERT RELATES_TO edge (doc → entity)<br/>ON CONFLICT DO NOTHING
        EE->>AGE: Cypher MERGE (doc)-[:RELATES_TO]→(entity)
    end
    EE->>DB: UPDATE metadata.indexing_state = "optimized"<br/>SET metadata.entity_extraction_at = now()
```

### Full Ingest Pipeline — Combined View

```mermaid
flowchart TD
    A["📄 File Upload\n(PDF, DOCX, PPTX, HTML, EML...)"] --> B

    subgraph Phase1["⚡ Phase 1 — Ingest Queue Worker (near-immediate)"]
        B["MarkItDown\nPer-page extraction + SSE progress\nImage blocks → attachment Nodes on disk"] --> C
        C["pypdf\nPage count pre-peeked\nPrinted page labels extracted"] --> D
        D["Paragraph-aware Chunker\nPage tracking per chunk"] --> E
        E["INSERT to Postgres\nParent + chunks + PART_OF edges\nembedding=NULL · indexing_state=chunked"]
    end

    E --> F["✅ Searchable via FTS immediately\nSSE: 'chunked · N chunks'"]

    subgraph Phase2["🔄 Phase 2 — asyncio.create_task (fires immediately after Phase 1)"]
        direction LR
        S1["① Image Parsing\nVision model describes\neach attachment image\n(parallel, semaphore-limited)"]
        --> S2["② Semantic Chunking\nRe-chunk on enriched text\nversioned STAGE → SWAP → GC"]
        --> S3["③ Embedding\nPOST /embeddings\nvector[768] per chunk + parent"]
        --> S4["④ Entity Extraction\nLangGraph: extract → ground → link\nRELATES_TO edges + AGE MERGE\nindexing_state = 'optimized'"]
    end

    F -.->|"asyncio.create_task\nnon-blocking"| S1

    subgraph Backfill["🔁 Safety Net — Embedding Backfill (periodic, every 5 min)"]
        K["SELECT nodes WHERE embedding IS NULL"] --> L
        L["POST /embeddings batch → vector[768]"] --> M["UPDATE SET embedding = vector"]
    end

    E -.->|"embedding=NULL\nif models offline at ingest time"| K
    S4 --> N["🔍 Fully searchable:\nFTS + ANN + Graph\nWith entity relationships in AGE"]

    style Phase1 fill:#1a1a2e,stroke:#4a9eff,color:#fff
    style Phase2 fill:#16213e,stroke:#f39c12,color:#fff
    style Backfill fill:#1a1a1a,stroke:#7f8c8d,color:#aaa
```

---

## Agent Journey: Reading & Writing Memory

Agents connect via the **Model Context Protocol (MCP)** — the standard for AI tool use. Each agent gets a unique opaque token and must identify itself on every request.

### Agent Authentication

```mermaid
sequenceDiagram
    actor Dev as Developer (SPA)
    participant SPA as React SPA
    participant API as FastAPI
    participant DB as Postgres
    participant Agent as AI Agent

    Dev->>SPA: Create new agent "Research Assistant"
    SPA->>API: POST /api/v1/agents {name, description, capabilities}
    API->>DB: INSERT agent (credential_hash=sha256(token), prefix=token[:14])
    DB-->>API: agent_id

    Note over API: Generate: mp_agt_<base32(32 random bytes)>
    API-->>SPA: {agent_id, plaintext_token}
    Note over SPA: ⚠️ Token shown ONCE in modal<br/>Never stored in plaintext
    SPA-->>Dev: Copy token to clipboard

    Dev->>Agent: Configure MCP client
    Note over Agent: mcpServers config:<br/>url: https://mp.example/mcp/v1<br/>Authorization: Bearer mp_agt_...<br/>X-Agent-Id: <uuid>

    Agent->>API: MCP tool call
    API->>DB: SELECT agent WHERE credential_hash=sha256(bearer)
    DB-->>API: agent row
    API->>API: assert agent.id == X-Agent-Id header
    Note over API: Mismatch → 403 (loud failure)<br/>Not a silent wrong-agent write
    API-->>Agent: ✅ Authorized {user, agent, db context}
```

### Agent Reading Memory

```mermaid
sequenceDiagram
    participant Agent as AI Agent
    participant MCP as MCP Server
    participant SS as Search Service
    participant DB as Postgres
    participant AGE as Apache AGE

    Agent->>MCP: search_memories(query="user's Python preferences", graph_boost=0.3)

    MCP->>DB: Embed query → vector via /embeddings
    DB-->>MCP: query_vector[768]

    MCP->>SS: hybrid_search(query, query_vector, user_id, agent_id)

    Note over SS: Visibility filter (CTE):<br/>• own agent scope<br/>• all user scope<br/>• all kb scope

    SS->>DB: FTS branch: WHERE fts_vector @@ plainto_tsquery(query)
    SS->>DB: ANN branch: ORDER BY embedding <=> query_vector
    SS->>DB: RRF fusion: SUM(1 / (60 + rank))
    DB-->>SS: top_50 candidates

    SS->>AGE: Cypher — find edges between candidates (depth=1)
    AGE-->>SS: connection pairs
    SS->>SS: graph_boost: score += 0.3 * (edge_count / max_edges)
    SS->>SS: Re-rank → top_10

    SS->>DB: Load visible edges for top_10 (relationship enrichment)
    DB-->>SS: edges[]

    SS-->>MCP: [{node, score, source_scores, relationships}]
    MCP-->>Agent: search results with graph context
```

### Agent Writing Private Memory

```mermaid
sequenceDiagram
    participant Agent as AI Agent
    participant MCP as MCP Server
    participant NS as Node Service
    participant DB as Postgres
    participant EMB as Embedding Model

    Agent->>MCP: store_memory(content="User prefers dark mode", tags=["preference", "ui"])

    MCP->>EMB: POST /embeddings [content]
    EMB-->>MCP: vector[768]

    MCP->>NS: create_node(scope=agent, content_type=memory, ...)
    NS->>DB: BEGIN TRANSACTION
    NS->>DB: INSERT node (scope=agent, agent_id=this_agent, embedding=vector)
    NS->>DB: COMMIT

    DB-->>NS: node_id
    NS-->>MCP: node
    MCP-->>Agent: {node_id, scope: "agent"}

    Note over Agent,DB: 🔒 Other agents cannot see this node<br/>Structurally isolated by agent_id
```

---

## The Proposal Flow

This is the heart of the trust model. Agents cannot modify `user` or `kb` scope memory directly — they **propose** changes, and the user reviews them in an inbox.

Agents can *read* all shared knowledge freely, but writing to it requires your sign-off — unless you've explicitly granted the agent the `kb_writer` capability.

### Proposal Lifecycle

```mermaid
stateDiagram-v2
    [*] --> pending: Agent calls propose_*()

    pending --> approved: User clicks "Approve"\nor "Edit & Approve"
    pending --> rejected: User clicks "Reject"
    pending --> rejected: Auto-expired\n(30 days TTL)

    approved --> [*]: Resulting node/edge\nwritten to shared scope
    rejected --> [*]: Staged file cleaned up\nNo node created

    note right of pending
        SPA shows:\n- Agent name\n- Proposal kind\n- Content preview\n- Agent's reason\n- Age / timestamp
    end note

    note right of approved
        For kb_document_create:\n- File moved from staging\n- Phase 1 ingest runs immediately\n- Phase 2 enrichment fires async
    end note
```

### Proposal Sequence: Agent Proposes, User Reviews

```mermaid
sequenceDiagram
    actor User
    participant SPA as React SPA
    participant API as FastAPI
    participant DB as Postgres
    participant Agent as AI Agent
    participant FS as File Staging

    Note over Agent: Agent discovers something<br/>worth adding to shared KB

    Agent->>API: propose_kb_document(file={filename, content_base64, mime_type}, reason="Found this relevant paper")
    API->>FS: Stage file at /data/staging/{proposal_id}/
    API->>DB: INSERT proposal (kind=kb_document_create, status=pending, staged_file_path=...)
    DB-->>API: proposal_id
    API-->>Agent: {proposal_id, status: "pending"}

    Note over SPA: 🔔 Badge shows pending count<br/>(TanStack Query polls every 30s)

    User->>SPA: Opens Proposals inbox
    SPA->>API: GET /api/v1/proposals?status=pending
    API->>DB: SELECT proposals WHERE user_id=... AND status=pending
    DB-->>API: [proposal rows with agent info]
    API-->>SPA: proposals[]

    User->>SPA: Reviews proposal — reads content, sees agent name + reason
    User->>SPA: Clicks "Approve"
    SPA->>API: POST /api/v1/proposals/{id}/approve
    API->>DB: UPDATE proposal SET status=approved, decided_at=now()

    API->>FS: Move staged file to /data/files/
    API->>DB: BEGIN TRANSACTION
    API->>DB: INSERT document node (scope=kb, indexing_state=queued)
    API->>DB: COMMIT
    Note over API: Phase 1 ingest worker picks up immediately<br/>Phase 2 enrichment fires after Phase 1 commits

    DB-->>API: node_id
    API-->>SPA: {status: "approved", node_id}
    SPA-->>User: ✅ Document added to KB
```

### Proposal Types

```mermaid
graph TD
    P["Agent Proposal\npropose_*() MCP tools"]

    P --> GM["propose_user_memory\n→ New fact/memory in user scope"]
    P --> GME["propose_user_memory_edit\n→ Diff to existing user node"]
    P --> GMD["propose_deletion\n→ Archive/delete a shared node"]
    P --> KBD["propose_kb_document\n→ Add document to KB\n(file or text content)"]
    P --> GE["propose_user_edge\n→ New relationship between\ntwo shared nodes"]

    GM --> REV{"User Reviews\nin SPA Inbox"}
    GME --> REV
    GMD --> REV
    KBD --> REV
    GE --> REV

    REV -->|Approve| WR["✅ Write to shared scope\n(atomic transaction)"]
    REV -->|"Edit &\nApprove"| ED["✏️ User edits content\nthen writes"]
    REV -->|Reject| RL["🗑️ Staged files cleaned\nNo write"]

    style P fill:#4a9eff,color:#000
    style REV fill:#f39c12,color:#000
    style WR fill:#2ecc71,color:#000
    style RL fill:#e74c3c,color:#fff
```

### Capability Fast-Track: `kb_writer`

For trusted agents (e.g., your personal automation bridge), you can grant the `kb_writer` capability, bypassing the proposal flow entirely for KB writes.

```mermaid
sequenceDiagram
    participant Agent as Agent (kb_writer)
    participant API as FastAPI
    participant Q as Ingest Queue Worker
    participant DB as Postgres

    Agent->>API: ingest_kb(file={...}, metadata={title: "..."})
    API->>API: Assert agent.capabilities contains "kb_writer"
    Note over API: No proposal created.<br/>Direct KB write.
    API->>DB: INSERT document node (scope=kb, indexing_state=queued)
    API->>Q: submit(job_id)
    API-->>Agent: {node_id, status: "ingested"}

    Note over Q: Phase 1 + Phase 2 pipeline runs<br/>identical to a user upload
```

---

## Hybrid Search

Every search in Mind Palace is a **three-way fusion**: full-text search, vector similarity, and optional graph traversal — fused via Reciprocal Rank Fusion (RRF).

```mermaid
flowchart LR
    Q["🔍 Query:\n'Python type hints best practices'"]

    Q --> FTS["Full-Text Search\nts_rank_cd(fts_vector,\nplainto_tsquery)"]
    Q --> EMB["Embed Query\n→ vector[768]"]
    EMB --> ANN["ANN Search\nHNSW index\nembedding <=> query_vec"]

    FTS --> RRF["Reciprocal Rank Fusion\nSUM(1 / (60 + rank))"]
    ANN --> RRF

    RRF --> GB{"graph_boost\n> 0?"}

    GB -->|Yes| GRAPH["Apache AGE\nCypher: find edges\nbetween candidates"]
    GRAPH --> BOOST["Score boost:\n+= graph_boost * (connections / max)"]
    BOOST --> FINAL["Re-rank → top_N"]

    GB -->|No| FINAL

    FINAL --> ENRICH["Load visible edges\nfor relationship context"]
    ENRICH --> RESULT["📋 Results:\n{node, score, relationships}"]

    style Q fill:#4a9eff,color:#000
    style RRF fill:#9b59b6,color:#fff
    style GRAPH fill:#e67e22,color:#fff
    style RESULT fill:#2ecc71,color:#000
```

The visibility predicate — scoped to `agent`, `user`, and `kb` — runs **before** any search branch. There is no code path that can return a node outside your permitted scope.

---

## Background Jobs

Mind Palace is designed to be **laptop-friendly** — it catches up missed jobs on next boot.

```mermaid
graph TB
    subgraph Scheduler["APScheduler (AsyncIOScheduler)"]
        J1["importance_decay\nCron: 0 4 * * *\n(daily at 4 AM)"]
        J2["embedding_backfill\nEvery 5 minutes"]
        J3["proposal_cleanup\nCron: 0 5 * * *\n(daily at 5 AM)"]
    end

    subgraph Catchup["Startup Catch-up (app_state table)"]
        CU["run_catchup_jobs()\nOn every server start"]
        CU --> CU1["Collapse N missed decay runs\ninto one multiplier\n(1 - rate)^days"]
        CU --> CU2["Run cleanup if\nlast run > 6h ago"]
    end

    J1 -->|"UPDATE importance = GREATEST(0.05, importance * 0.99)\nWHERE NOT pinned"| DB2[(Postgres)]
    J2 -->|"SELECT embedding IS NULL → embed batch → UPDATE"| DB2
    J3 -->|"Pending > 30d → auto-reject\nDecided > 180d → purge"| DB2

    Scheduler -.-> Catchup
```

---

## Data Model — Node Graph

```mermaid
erDiagram
    users {
        uuid id PK
        text username
        text password_hash
        text oidc_sub
        int session_epoch
    }

    agents {
        uuid id PK
        uuid user_id FK
        text name
        bytea credential_hash
        text credential_prefix
        jsonb capabilities
        timestamptz revoked_at
    }

    nodes {
        uuid id PK
        uuid user_id FK
        uuid agent_id FK
        scope_enum scope
        content_type_enum content_type
        text content
        jsonb metadata
        jsonb tags
        uuid parent_id FK
        int chunk_index
        float importance
        bool pinned
        bool archived
        regconfig language
        vector_768 embedding
        tsvector fts_vector
    }

    collections {
        uuid id PK
        uuid user_id FK
        uuid agent_id FK
        scope_enum scope
        text name
    }

    edges {
        uuid id PK
        uuid user_id FK
        uuid agent_id FK
        scope_enum scope
        uuid source_id FK
        uuid target_id FK
        relation_type_enum relation_type
    }

    proposals {
        uuid id PK
        uuid user_id FK
        uuid agent_id FK
        proposal_kind_enum kind
        proposal_status_enum status
        jsonb payload
        uuid target_node_id FK
        text staged_file_path
        text reason
        timestamptz decided_at
    }

    users ||--o{ agents : "owns"
    users ||--o{ nodes : "owns"
    users ||--o{ collections : "owns"
    users ||--o{ proposals : "receives"
    agents ||--o{ nodes : "creates"
    agents ||--o{ proposals : "submits"
    nodes ||--o{ nodes : "parent_id (chunks)"
    nodes ||--o{ edges : "source"
    nodes ||--o{ edges : "target"
    collections ||--o{ nodes : "groups"
```

---

## The MCP Tools Surface

28 tools exposed at `/mcp/v1`, grouped by access level:

**Read**
- `search_memories`
- `get_memory`
- `list_memories`
- `get_neighbors`
- `get_attachment`
- `list_attachments`

**Own Write** *(agent scope only)*
- `store_memory`
- `update_memory`
- `archive_memory`
- `delete_memory`
- `create_connection`
- `delete_connection`

**Collections**
- `create_collection`
- `list_collections`
- `update_collection`
- `delete_collection`

**Proposals** *(suggest changes to user/kb scope; user reviews in inbox)*
- `propose_user_memory`
- `propose_user_memory_edit`
- `propose_deletion`
- `propose_document`
- `propose_user_connection`
- `withdraw_proposal`

**KB Direct Write** *(requires `kb_writer` capability)*
- `publish_document`
- `get_publish_status`
- `update_document`
- `delete_document`

**Agent**
- `get_agent_info`

---

## Quickstart

### Prerequisites

- Docker with Compose
- 4 GB RAM (8 GB+ recommended if running a local model via Ollama)

### Run

```bash
git clone https://github.com/your-handle/mind-palace
cd mind-palace
cp .env.example .env
# Edit .env — set SESSION_SECRET to 32+ random bytes

make build   # builds mind-palace:local + mind-palace-db:local
make up      # docker compose up -d
open http://localhost:8340
```

On first open, you'll see a setup form to create your account. After that, create your first agent in the **Agents** section and copy the one-time token into your AI client's MCP configuration.

### MCP Client Configuration

```json
{
  "mcpServers": {
    "mind-palace": {
      "url": "http://localhost:8340/mcp/v1",
      "headers": {
        "Authorization": "Bearer mp_agt_YOUR_TOKEN_HERE",
        "X-Agent-Id": "YOUR_AGENT_UUID_HERE"
      }
    }
  }
}
```

### Inference Configuration

Mind Palace talks to any OpenAI-compatible endpoint. Point the `.env` at whatever you're running:

```env
# Ollama (local)
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=gemma4:e4b
LLM_API_KEY=ollama

LLM_EMBED_BASE_URL=http://localhost:11434/v1
LLM_EMBED_MODEL=nomic-embed-text
EMBEDDING_DIMENSIONS=768
```

```env
# OpenAI
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=sk-...

LLM_EMBED_BASE_URL=https://api.openai.com/v1
LLM_EMBED_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
```

For Ollama, install it separately from [ollama.com](https://ollama.com) and pull your models before starting Mind Palace.

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| API | FastAPI + Python 3.12 | Async-native, OpenAPI auto-docs |
| Runtime | `uv` (lockfile committed) | Fast, reproducible Docker builds |
| Database | Postgres 16 | One store: relational + vector + graph + FTS |
| Vector search | `pgvector` HNSW | No separate vector DB |
| Graph | Apache AGE | Cypher queries inside Postgres |
| Full-text | `tsvector` per-row | Multi-language, per-row regconfig |
| Migrations | Alembic | Forward-only, version-controlled |
| Document extraction | Microsoft MarkItDown | Handles PDF/DOCX/PPTX/HTML/Markdown |
| PDF metadata | `pypdf` | MIT-licensed (no PyMuPDF/AGPL) |
| Entity extraction | LangGraph | extract → ground → link pipeline |
| Scheduler | APScheduler | Laptop-friendly catch-up on restart |
| MCP | FastMCP | Standard AI tool protocol |
| Frontend | React 19 + Vite + TypeScript + Tailwind + Radix | Modern, accessible SPA |
| Tests | pytest + testcontainers + Playwright | Real Postgres in tests, no mocks |

---

## Security Model

### Agent Token Binding

Tokens are opaque (`mp_agt_<base32(32 bytes)>`). The server stores only `sha256(token)`. Every request must supply **both** `Authorization: Bearer <token>` AND `X-Agent-Id: <uuid>`. The server verifies the hash, then asserts the agent ID matches.

```
Wrong token scenario:
  Agent A token + Agent B's X-Agent-Id → 403 (loud failure)
  NOT: silent write to Agent B's memory
```

This is the core isolation guarantee. Structural, not conventional.

### Scope Enforcement

Every query includes a visibility predicate that runs before any FTS, ANN, or graph branch:

```sql
WHERE user_id = :user_id
  AND archived = false
  AND (
    scope IN ('user', 'kb')
    OR (scope = 'agent' AND agent_id = :agent_id)
  )
```

There is no code path that can return a node outside the requesting agent's permitted scope.

---

## License

MIT — see [LICENSE](LICENSE).

---

## Status

Mind Palace is under active development. The core knowledge model, MCP server, auth system, ingest pipeline, and hybrid search are implemented. The React SPA is being rebuilt against the new API.
