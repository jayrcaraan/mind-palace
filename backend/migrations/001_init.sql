-- Mind Palace v2 — Initial Schema
-- Run once against a fresh database.

-- ─────────────────────────────────────────
-- Extensions
-- ─────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- pgvector (Profiles 2 & 3 only — safe to run on all, no-ops if already installed)
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "vector";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvector not available — embedding search disabled (Profile 1 mode)';
END
$$;

-- Apache AGE
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "age";
    LOAD 'age';
    SET search_path = ag_catalog, "$user", public;
    PERFORM create_graph('mind_palace_graph');
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Apache AGE not available — graph features disabled';
END
$$;
-- Reset search_path so subsequent tables go into public schema
SET search_path = public;

-- ─────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────
DO $$ BEGIN CREATE TYPE collection_scope AS ENUM ('user', 'agent', 'kb'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE object_type AS ENUM ('user_memory', 'agent_memory', 'kb_entry'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE permission_level AS ENUM ('none', 'read', 'write'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE agent_permission_level AS ENUM ('none', 'read', 'write'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE proposal_type AS ENUM ('add_user_memory', 'edit_user_memory', 'delete_item', 'add_document', 'create_connection'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE proposal_status AS ENUM ('pending', 'approved', 'rejected'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE ingestion_status AS ENUM ('queued', 'running', 'completed', 'failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE ingestion_step AS ENUM ('parse', 'vision', 'embed', 'ner', 'autolink', 'index', 'decay'); EXCEPTION WHEN duplicate_object THEN null; END $$;
-- Ensure newer step values exist even if the enum predates them
DO $$ BEGIN ALTER TYPE ingestion_step ADD VALUE IF NOT EXISTS 'autolink' BEFORE 'index'; EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN ALTER TYPE ingestion_step ADD VALUE IF NOT EXISTS 'decay'; EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN CREATE TYPE step_status AS ENUM ('pending', 'running', 'completed', 'skipped', 'failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agents (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name             VARCHAR(255) NOT NULL,
    description      TEXT,
    token_hash       VARCHAR(255) NOT NULL UNIQUE,
    capabilities     TEXT[] DEFAULT '{}',
    owner_id         UUID NOT NULL,
    permission_level agent_permission_level NOT NULL DEFAULT 'read',
    revoked          BOOLEAN DEFAULT FALSE,
    last_used_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agents_token_hash ON agents(token_hash);
CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner_id);

CREATE TABLE IF NOT EXISTS collections (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                 VARCHAR(255) NOT NULL,
    description          TEXT,
    scope                collection_scope NOT NULL DEFAULT 'user',
    owner_id             UUID NOT NULL,
    agent_id             VARCHAR(255),
    parent_collection_id UUID REFERENCES collections(id) ON DELETE SET NULL,
    metadata             JSONB DEFAULT '{}',
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_agent_scope CHECK (
        (scope = 'agent' AND agent_id IS NOT NULL) OR
        (scope != 'agent' AND agent_id IS NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_collections_parent ON collections(parent_collection_id);
CREATE INDEX IF NOT EXISTS idx_collections_owner  ON collections(owner_id);
CREATE INDEX IF NOT EXISTS idx_collections_scope  ON collections(scope);
CREATE INDEX IF NOT EXISTS idx_collections_agent  ON collections(agent_id) WHERE agent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS objects (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type             object_type NOT NULL,
    subject          VARCHAR(512) NOT NULL,
    content          TEXT NOT NULL,
    collection_id    UUID REFERENCES collections(id) ON DELETE RESTRICT,
    contributor_id   VARCHAR(255) NOT NULL,
    approved_at      TIMESTAMPTZ,
    raw_file_path    VARCHAR(2048),
    status           ingestion_status NOT NULL DEFAULT 'completed',
    metadata         JSONB DEFAULT '{}',
    importance       SMALLINT DEFAULT 1 CHECK (importance BETWEEN 1 AND 5),
    importance_updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_pinned        BOOLEAN DEFAULT FALSE,
    language         VARCHAR(32) DEFAULT 'en',
    content_fts      TSVECTOR GENERATED ALWAYS AS (
                         to_tsvector('english', coalesce(subject, '') || ' ' || content)
                     ) STORED,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_objects_type        ON objects(type);
CREATE INDEX IF NOT EXISTS idx_objects_collection  ON objects(collection_id);
CREATE INDEX IF NOT EXISTS idx_objects_contributor ON objects(contributor_id);
CREATE INDEX IF NOT EXISTS idx_objects_metadata    ON objects USING gin(metadata);
CREATE INDEX IF NOT EXISTS idx_objects_fts         ON objects USING gin(content_fts);

CREATE TABLE IF NOT EXISTS entities (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       VARCHAR(255) NOT NULL,
    type       VARCHAR(100) NOT NULL,
    metadata   JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_entity_name_type UNIQUE (name, type)
);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);

CREATE TABLE IF NOT EXISTS object_entities (
    object_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
    entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    PRIMARY KEY (object_id, entity_id)
);

CREATE TABLE IF NOT EXISTS attachments (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id      UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
    filename       VARCHAR(512) NOT NULL,
    mime_type      VARCHAR(255) NOT NULL,
    size_bytes     BIGINT NOT NULL,
    parsed_content TEXT,
    blob_path      VARCHAR(2048) NOT NULL,
    metadata       JSONB DEFAULT '{}',
    created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_attachments_object ON attachments(object_id);

-- Vector dimension default 768 (nomic-embed-text)
-- Change to 1024 if using mxbai-embed-large
DO $$
BEGIN
    CREATE TABLE IF NOT EXISTS object_chunks (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        object_id   UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
        chunk_index INT NOT NULL,
        content     TEXT NOT NULL,
        embedding   VECTOR(768),
        metadata    JSONB DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_object    ON object_chunks(object_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON object_chunks
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
EXCEPTION WHEN OTHERS THEN
    -- pgvector unavailable; create without vector column
    CREATE TABLE IF NOT EXISTS object_chunks (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        object_id   UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
        chunk_index INT NOT NULL,
        content     TEXT NOT NULL,
        embedding   JSONB,
        metadata    JSONB DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_object ON object_chunks(object_id);
END
$$;

CREATE TABLE IF NOT EXISTS agent_permissions (
    agent_id         VARCHAR(255) NOT NULL,
    collection_id    UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    permission_level permission_level NOT NULL DEFAULT 'read',
    PRIMARY KEY (agent_id, collection_id)
);

CREATE TABLE IF NOT EXISTS proposals (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_type    proposal_type NOT NULL,
    status           proposal_status NOT NULL DEFAULT 'pending',
    proposer_id      VARCHAR(255) NOT NULL,
    collection_id    UUID REFERENCES collections(id) ON DELETE SET NULL,
    target_object_id UUID REFERENCES objects(id) ON DELETE SET NULL,
    proposed_data    JSONB NOT NULL,
    reviewer_note    TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_proposals_status  ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_agent   ON proposals(proposer_id);
CREATE INDEX IF NOT EXISTS idx_proposals_created ON proposals(created_at DESC);

CREATE TABLE IF NOT EXISTS ingestion_tasks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id           UUID REFERENCES objects(id) ON DELETE SET NULL,
    task_type           VARCHAR(32) NOT NULL DEFAULT 'document',
    params              JSONB DEFAULT '{}',
    mode_level          SMALLINT NOT NULL DEFAULT 2 CHECK (mode_level IN (1, 2, 3)),
    status              ingestion_status NOT NULL DEFAULT 'queued',
    current_step        ingestion_step,
    progress_percentage SMALLINT DEFAULT 0,
    error_message       TEXT,
    archived_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ingestion_status ON ingestion_tasks(status);
CREATE INDEX IF NOT EXISTS idx_ingestion_object ON ingestion_tasks(object_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_archived ON ingestion_tasks(archived_at);

CREATE TABLE IF NOT EXISTS ingestion_events (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id  UUID NOT NULL REFERENCES ingestion_tasks(id) ON DELETE CASCADE,
    step     ingestion_step NOT NULL,
    status   step_status NOT NULL,
    detail   TEXT,
    metadata JSONB DEFAULT '{}',
    ts       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_task_ts ON ingestion_events(task_id, ts);

-- ─────────────────────────────────────────
-- Updated_at trigger
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    -- Allow bulk maintenance (e.g. importance decay) to update rows without
    -- bumping updated_at: SET LOCAL mp.skip_touch = 'on' in that transaction.
    IF current_setting('mp.skip_touch', true) = 'on' THEN
        RETURN NEW;
    END IF;
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN SELECT unnest(ARRAY['collections','objects','ingestion_tasks']) LOOP
        EXECUTE format('
            DROP TRIGGER IF EXISTS trg_updated_at ON %I;
            CREATE TRIGGER trg_updated_at
            BEFORE UPDATE ON %I
            FOR EACH ROW EXECUTE FUNCTION update_updated_at();
        ', t, t);
    END LOOP;
END
$$;
