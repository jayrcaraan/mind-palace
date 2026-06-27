"""Hybrid search: FTS + vector (RRF) + graph boost.

Each retrieval stage runs in its OWN isolated session so a failure in one
(e.g. pgvector cast error, AGE unavailable) can never poison the others or
the final object fetch. Stages degrade gracefully to empty results.
"""
import uuid
import logging
from typing import Optional
from sqlalchemy import text, select, func, and_, literal_column
from sqlalchemy.ext.asyncio import AsyncSession

from mind_palace.config import settings
from mind_palace.models.object import MPObject, ObjectType
from mind_palace.models.entity import ObjectEntity
from mind_palace.database import AsyncSessionLocal
from mind_palace.auth.middleware import AuthContext, privacy_filter_clause

log = logging.getLogger(__name__)


def _scope_conditions(auth, collection_ids, object_types, entity_ids) -> list:
    """The structured filters shared by FTS, vector, and browse — so every path
    honours collection / type / entity / privacy identically."""
    conds = []
    priv = privacy_filter_clause(auth)
    if priv is not None:
        conds.append(priv)
    if collection_ids:
        conds.append(MPObject.collection_id.in_(collection_ids))
    if object_types:
        conds.append(MPObject.type.in_(object_types))
    if entity_ids:
        conds.append(MPObject.id.in_(
            select(ObjectEntity.object_id).where(ObjectEntity.entity_id.in_(entity_ids))
        ))
    return conds


async def hybrid_search(
    db: AsyncSession,
    auth: AuthContext,
    query: str,
    limit: int = 10,
    collection_ids: Optional[list[uuid.UUID]] = None,
    object_types: Optional[list[ObjectType]] = None,
    entity_ids: Optional[list[uuid.UUID]] = None,
    graph_boost: float = 0.15,
) -> list[dict]:
    if not (query or "").strip():
        # No text → browse: list objects matching the filters (collection / entity / type).
        boosted = await _browse(auth, limit, collection_ids, object_types, entity_ids)
    else:
        fts_results = await _fts_search(auth, query, limit * 2, collection_ids, object_types, entity_ids)
        vec_results = await _vector_search(auth, query, limit * 2, collection_ids, object_types, entity_ids)
        merged = _rrf_merge(fts_results, vec_results, k=60)
        boosted = await _graph_boost(merged, boost=graph_boost) if graph_boost > 0 else merged

    top = sorted(boosted, key=lambda x: x["score"], reverse=True)[:limit]
    object_ids = [uuid.UUID(r["object_id"]) for r in top]
    if not object_ids:
        return []

    result = await db.execute(select(MPObject).where(MPObject.id.in_(object_ids)))
    objects_map = {str(o.id): o for o in result.scalars().all()}

    try:
        await db.execute(
            text("UPDATE objects SET last_accessed_at = NOW() WHERE id = ANY(:ids)"),
            {"ids": object_ids},
        )
        await db.commit()
    except Exception:
        await db.rollback()

    output = []
    for r in top:
        obj = objects_map.get(str(r["object_id"]))
        if obj:
            output.append({
                "object": obj,
                "score": r["score"],
                "snippet": r.get("snippet"),
                "source": r.get("source", "fts"),
            })
    return output


async def _browse(
    auth: AuthContext, limit: int,
    collection_ids: Optional[list[uuid.UUID]], object_types: Optional[list[ObjectType]],
    entity_ids: Optional[list[uuid.UUID]],
) -> list[dict]:
    """No query text — list objects matching the filters, ranked importance→recency."""
    try:
        async with AsyncSessionLocal() as db:
            conds = _scope_conditions(auth, collection_ids, object_types, entity_ids)
            q = (
                select(MPObject.id)
                .where(and_(*conds) if conds else True)
                .order_by(MPObject.importance.desc(), MPObject.updated_at.desc())
                .limit(limit)
            )
            rows = (await db.execute(q)).all()
            n = len(rows)
            return [{"object_id": str(r[0]), "score": 1.0 - i / (n + 1), "snippet": None, "source": "browse"}
                    for i, r in enumerate(rows)]
    except Exception as e:
        log.warning("browse failed: %s", e)
        return []


async def _fts_search(
    auth: AuthContext, query: str, limit: int,
    collection_ids: Optional[list[uuid.UUID]], object_types: Optional[list[ObjectType]],
    entity_ids: Optional[list[uuid.UUID]] = None,
) -> list[dict]:
    """Full-text search using PostgreSQL tsvector (isolated session)."""
    try:
        async with AsyncSessionLocal() as db:
            conditions = [literal_column("content_fts").op("@@")(func.plainto_tsquery("english", query))]
            conditions += _scope_conditions(auth, collection_ids, object_types, entity_ids)

            q = (
                select(
                    MPObject.id,
                    func.ts_rank(literal_column("content_fts"), func.plainto_tsquery("english", query)).label("rank"),
                    func.ts_headline(
                        "english", MPObject.content, func.plainto_tsquery("english", query),
                        "MaxWords=30, MinWords=10, StartSel=<mark>, StopSel=</mark>",
                    ).label("snippet"),
                )
                .where(and_(*conditions))
                .order_by(text("rank DESC"))
                .limit(limit)
            )
            rows = (await db.execute(q)).all()
            return [{"object_id": str(r.id), "rank": float(r.rank), "snippet": r.snippet, "source": "fts"} for r in rows]
    except Exception as e:
        log.warning("FTS search failed: %s", e)
        return []


async def _vector_search(
    auth: AuthContext, query: str, limit: int,
    collection_ids: Optional[list[uuid.UUID]], object_types: Optional[list[ObjectType]],
    entity_ids: Optional[list[uuid.UUID]] = None,
) -> list[dict]:
    """Dense vector cosine search via pgvector — honours the SAME filters + privacy
    as FTS (previously it ignored them, leaking cross-collection results)."""
    if settings.mode_level == 1:
        return []
    try:
        from mind_palace.services.inference import embed
        query_vec = await embed(f"search_query: {query}")
    except Exception as e:
        log.debug("embedding unavailable: %s", e)
        return []

    try:
        from mind_palace.models.chunk import ObjectChunk
        async with AsyncSessionLocal() as db:
            # best (min) cosine distance per object
            sub = (
                select(
                    ObjectChunk.object_id.label("oid"),
                    func.min(ObjectChunk.embedding.cosine_distance(query_vec)).label("dist"),
                )
                .where(ObjectChunk.embedding.is_not(None))
                .group_by(ObjectChunk.object_id)
                .subquery()
            )
            conds = _scope_conditions(auth, collection_ids, object_types, entity_ids)
            q = (
                select(MPObject.id, sub.c.dist)
                .join(sub, sub.c.oid == MPObject.id)
                .where(and_(*conds) if conds else True)
                .order_by(sub.c.dist)
                .limit(limit)
            )
            rows = (await db.execute(q)).all()
            return [{"object_id": str(r[0]), "rank": float(1 - r[1]), "snippet": None, "source": "vec"} for r in rows]
    except Exception as e:
        log.debug("vector search skipped: %s", e)
        return []


def _rrf_merge(list_a: list[dict], list_b: list[dict], k: int = 60) -> list[dict]:
    """Reciprocal Rank Fusion of two ranked lists."""
    scores: dict[str, float] = {}
    meta: dict[str, dict] = {}
    for rank, item in enumerate(list_a, 1):
        oid = item["object_id"]
        scores[oid] = scores.get(oid, 0) + 1.0 / (k + rank)
        meta[oid] = item
    for rank, item in enumerate(list_b, 1):
        oid = item["object_id"]
        scores[oid] = scores.get(oid, 0) + 1.0 / (k + rank)
        meta.setdefault(oid, item)
    return [{**meta[oid], "score": score, "object_id": oid}
            for oid, score in sorted(scores.items(), key=lambda x: x[1], reverse=True)]


async def _graph_boost(results: list[dict], boost: float = 0.15) -> list[dict]:
    """Boost objects graph-linked to the top results (isolated session)."""
    if not results:
        return results
    top_ids = {r["object_id"] for r in results[:5]}
    if not top_ids:
        return results

    from mind_palace.services.graph_svc import _run
    id_list = "', '".join(top_ids)
    rows = await _run(f"""
        SELECT * FROM cypher('mind_palace_graph', $$
            MATCH (a:Object)-[r]-(b:Object)
            WHERE a.id IN ['{id_list}']
            RETURN b.id AS neighbor_id
        $$) AS (neighbor_id agtype)
    """, commit=False)
    if not rows:
        return results

    linked = {str(r.get("neighbor_id", "")).strip('"') for r in rows}
    out = []
    for item in results:
        oid = item["object_id"]
        if oid in linked and oid not in top_ids:
            item = {**item, "score": item["score"] * (1 + boost)}
        out.append(item)
    return out
