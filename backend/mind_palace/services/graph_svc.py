"""Apache AGE graph operations.

Every graph operation runs in its OWN isolated database session. AGE requires
`SET search_path = ag_catalog, ...` per-connection, and a failed Cypher call
aborts the surrounding transaction. Isolating graph work guarantees it can
never poison the caller's entity-write transaction — graph features degrade
gracefully to no-ops if AGE is unavailable.
"""
import uuid
import logging
from typing import Optional
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from mind_palace.config import settings
from mind_palace.database import AsyncSessionLocal

log = logging.getLogger(__name__)

GRAPH = settings.age_graph_name


async def _run(query: str, params: dict | None = None, commit: bool = True) -> list[dict]:
    """Run a Cypher query in a fresh, isolated session. Returns rows as dicts.

    Uses the raw driver (`exec_driver_sql`) rather than `text()` so SQLAlchemy
    does NOT mistake openCypher's colons (`:Object`, `:ASSOCIATED_WITH`, …) for
    bind parameters — that silently broke MATCH/RETURN queries.
    """
    try:
        async with AsyncSessionLocal() as db:
            conn = await db.connection()
            await conn.exec_driver_sql("LOAD 'age'")
            await conn.exec_driver_sql('SET search_path = ag_catalog, "$user", public')
            result = await conn.exec_driver_sql(query)
            rows = result.fetchall()
            data = [dict(r._mapping) for r in rows]
            if commit:
                await db.commit()
            return data
    except Exception as e:
        log.debug("graph op skipped (AGE unavailable or query error): %s", e)
        return []


# Accept `db` for call-site compatibility; graph work uses its own session.
# NOTE: this AGE build does not support `MERGE ... ON CREATE SET`. We use
# `MERGE` followed by an unconditional `SET` (idempotent) instead.
async def ensure_object_vertex(db: AsyncSession, object_id: uuid.UUID, obj_type: str, contributor_id: str) -> None:
    await _run(f"""
        SELECT * FROM cypher('{GRAPH}', $$
            MERGE (o:Object {{id: '{object_id}'}})
            SET o.type = '{obj_type}', o.contributor_id = '{contributor_id}'
            RETURN o
        $$) AS (o agtype)
    """)


async def ensure_collection_vertex(db: AsyncSession, collection_id: uuid.UUID, name: str) -> None:
    await _run(f"""
        SELECT * FROM cypher('{GRAPH}', $$
            MERGE (c:Collection {{id: '{collection_id}'}})
            SET c.name = '{name.replace("'", "''")}'
            RETURN c
        $$) AS (c agtype)
    """)


async def ensure_entity_vertex(db: AsyncSession, entity_id: uuid.UUID, name: str, entity_type: str) -> None:
    await _run(f"""
        SELECT * FROM cypher('{GRAPH}', $$
            MERGE (e:Entity {{id: '{entity_id}'}})
            SET e.name = '{name.replace("'", "''")}', e.type = '{entity_type}'
            RETURN e
        $$) AS (e agtype)
    """)


async def link_object_to_entity(db: AsyncSession, object_id: uuid.UUID, entity_id: uuid.UUID) -> None:
    # NB: AGE requires the RETURN columns to match the `AS (...)` declaration,
    # so name the merged relationship and return it.
    await _run(f"""
        SELECT * FROM cypher('{GRAPH}', $$
            MATCH (o:Object {{id: '{object_id}'}}), (e:Entity {{id: '{entity_id}'}})
            MERGE (o)-[r:ASSOCIATED_WITH]->(e)
            RETURN r
        $$) AS (r agtype)
    """)


async def link_object_to_collection(db: AsyncSession, object_id: uuid.UUID, collection_id: uuid.UUID) -> None:
    await _run(f"""
        SELECT * FROM cypher('{GRAPH}', $$
            MATCH (c:Collection {{id: '{collection_id}'}}), (o:Object {{id: '{object_id}'}})
            MERGE (c)-[r:CONTAINS]->(o)
            RETURN r
        $$) AS (r agtype)
    """)


async def _ensure_vertex_exists(object_id: uuid.UUID) -> None:
    """MERGE a bare Object vertex without overwriting existing properties."""
    await _run(f"""
        SELECT * FROM cypher('{GRAPH}', $$
            MERGE (o:Object {{id: '{object_id}'}})
            RETURN o
        $$) AS (o agtype)
    """)


async def create_edge(db: AsyncSession, source_id: uuid.UUID, target_id: uuid.UUID, edge_type: str) -> None:
    valid_types = {"PART_OF", "THREAD", "RELATES_TO", "REFERENCES", "MENTIONS", "ASSOCIATED_WITH"}
    edge = edge_type.upper().replace(" ", "_")
    if edge not in valid_types:
        edge = "RELATES_TO"
    # Ensure both vertices exist so the edge can be created (no property overwrite)
    await _ensure_vertex_exists(source_id)
    await _ensure_vertex_exists(target_id)
    await _run(f"""
        SELECT * FROM cypher('{GRAPH}', $$
            MATCH (a:Object {{id: '{source_id}'}}), (b:Object {{id: '{target_id}'}})
            MERGE (a)-[r:{edge}]->(b)
            RETURN r
        $$) AS (r agtype)
    """)


async def delete_edge(db: AsyncSession, source_id: uuid.UUID, target_id: uuid.UUID, edge_type: str) -> None:
    edge = edge_type.upper().replace(" ", "_")
    await _run(f"""
        SELECT * FROM cypher('{GRAPH}', $$
            MATCH (a:Object {{id: '{source_id}'}})-[r:{edge}]-(b:Object {{id: '{target_id}'}})
            DELETE r
            RETURN 1
        $$) AS (deleted agtype)
    """)


async def get_neighbors(db: AsyncSession, object_id: uuid.UUID, relationship_types: Optional[list[str]] = None) -> list[dict]:
    if relationship_types:
        match_pattern = f"-[r:{'|'.join(relationship_types)}]-"
    else:
        match_pattern = "-[r]-"
    return await _run(f"""
        SELECT * FROM cypher('{GRAPH}', $$
            MATCH (a:Object {{id: '{object_id}'}}){match_pattern}(b:Object)
            RETURN b.id AS neighbor_id, type(r) AS relationship
        $$) AS (neighbor_id agtype, relationship agtype)
    """, commit=False)


async def get_all_object_edges(db: AsyncSession) -> list[dict]:
    """Return every object→object relationship for the graph view.

    Each row is `{source, target, relationship}` (string ids + edge type).
    """
    rows = await _run(f"""
        SELECT * FROM cypher('{GRAPH}', $$
            MATCH (a:Object)-[r]->(b:Object)
            RETURN a.id AS source_id, b.id AS target_id, type(r) AS relationship
        $$) AS (source_id agtype, target_id agtype, relationship agtype)
    """, commit=False)
    out = []
    for r in rows:
        src = str(r.get("source_id", "")).strip('"')
        dst = str(r.get("target_id", "")).strip('"')
        rel = str(r.get("relationship", "")).strip('"')
        if src and dst:
            out.append({"source": src, "target": dst, "relationship": rel})
    return out


async def detach_delete_object(db: AsyncSession, object_id: uuid.UUID) -> int:
    """Remove an object's vertex AND every edge touching it (cascade on delete)."""
    rows = await _run(f"""
        SELECT * FROM cypher('{GRAPH}', $$
            MATCH (o:Object {{id: '{object_id}'}})
            DETACH DELETE o
            RETURN 1
        $$) AS (deleted agtype)
    """)
    return len(rows)


async def clear_object_edges(db: AsyncSession, object_id: uuid.UUID) -> int:
    """Remove all edges touching an object's vertex but keep the vertex itself."""
    rows = await _run(f"""
        SELECT * FROM cypher('{GRAPH}', $$
            MATCH (o:Object {{id: '{object_id}'}})-[r]-()
            DELETE r
            RETURN 1
        $$) AS (deleted agtype)
    """)
    return len(rows)


async def clear_all_relates_to(db: AsyncSession) -> int:
    """Delete every auto-generated RELATES_TO edge (for a full reindex)."""
    rows = await _run(f"""
        SELECT * FROM cypher('{GRAPH}', $$
            MATCH ()-[r:RELATES_TO]->()
            DELETE r
            RETURN 1
        $$) AS (deleted agtype)
    """)
    return len(rows)


async def auto_link_by_shared_entities(db: AsyncSession, object_id: uuid.UUID, entity_ids: list[uuid.UUID]) -> list[str]:
    """Create RELATES_TO edges to objects sharing entities. Returns the list of
    target object ids that were linked (for execution history)."""
    if not entity_ids:
        return []
    entity_list = ", ".join(f"'{eid}'" for eid in entity_ids)
    rows = await _run(f"""
        SELECT * FROM cypher('{GRAPH}', $$
            MATCH (new:Object {{id: '{object_id}'}}),
                  (e:Entity)<-[:ASSOCIATED_WITH]-(existing:Object)
            WHERE e.id IN [{entity_list}]
              AND existing.id <> '{object_id}'
            MERGE (new)-[:RELATES_TO]->(existing)
            RETURN DISTINCT existing.id AS linked_id
        $$) AS (linked_id agtype)
    """)
    out = []
    for r in rows:
        v = str(r.get("linked_id", "")).strip('"')
        if v:
            out.append(v)
    return out
