"""initial schema — full Mind Palace database

Creates extensions (pgvector, Apache AGE — gracefully skipped if unavailable),
enums, all tables, indexes, FTS, triggers and the knowledge graph. The canonical
DDL lives in ``backend/migrations/001_init.sql`` and is executed verbatim so there
is a single source of truth.

Revision ID: 0001
Revises:
Create Date: 2026-06-27
"""
from pathlib import Path
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

# backend/alembic/versions/0001_*.py  →  parents[2] == backend/
_SQL_PATH = Path(__file__).resolve().parents[2] / "migrations" / "001_init.sql"


def upgrade() -> None:
    sql = _SQL_PATH.read_text()
    # psycopg2 treats `%` as a parameter marker, so escape literal `%` (e.g. the
    # `%I` inside PL/pgSQL `format()` calls) to `%%`. The driver un-escapes it back
    # to `%` before sending to the server. Runs the whole multi-statement script
    # (incl. DO blocks / `$$` quoting) in one call.
    op.get_bind().exec_driver_sql(sql.replace("%", "%%"))


def downgrade() -> None:
    op.get_bind().exec_driver_sql(
        """
        DROP TABLE IF EXISTS ingestion_events, ingestion_tasks, object_chunks,
            object_entities, attachments, proposals, agent_permissions, entities,
            objects, collections, agents CASCADE;
        DROP TYPE IF EXISTS collection_scope, object_type, permission_level,
            agent_permission_level, proposal_type, proposal_status,
            ingestion_status, ingestion_step, step_status CASCADE;
        DO $$ BEGIN
            PERFORM ag_catalog.drop_graph('mind_palace_graph', true);
        EXCEPTION WHEN OTHERS THEN NULL; END $$;
        """
    )
