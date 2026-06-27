import uuid
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mind_palace.config import settings
from mind_palace.database import get_db
from mind_palace.models.object import MPObject
from mind_palace.models.entity import Entity, ObjectEntity
from mind_palace.models.ingestion_task import IngestionTask
from mind_palace.auth.middleware import AuthContext, get_auth, privacy_filter_clause
from mind_palace.services import graph_svc

router = APIRouter(prefix="/api/v1/graph", tags=["graph"])


@router.get("")
async def get_graph(
    include_entities: bool = Query(default=True),
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    """Full graph for visualisation: object + entity nodes, and all edges.

    Object→object RELATES_TO edges come from the knowledge graph (Apache AGE);
    object→entity ASSOCIATED_WITH edges are read straight from the relational
    `object_entities` table so entities always render even if AGE is unavailable.
    """
    conds = []
    priv = privacy_filter_clause(auth)
    if priv is not None:
        conds.append(priv)
    where = conds if conds else [True]

    objs = (await db.execute(
        select(MPObject.id, MPObject.subject, MPObject.type, MPObject.importance).where(*where)
    )).all()
    object_ids = {str(o.id) for o in objs}
    nodes = [
        {"id": str(o.id), "label": o.subject or o.type.value,
         "type": o.type.value, "importance": o.importance}
        for o in objs
    ]

    edges = []
    # object → object (shared-entity links)
    for e in await graph_svc.get_all_object_edges(db):
        if e["source"] in object_ids and e["target"] in object_ids:
            edges.append({"source": e["source"], "target": e["target"],
                          "relationship": e["relationship"], "kind": "object"})

    if include_entities:
        # entity → object associations from the relational table (visible objects only)
        rows = (await db.execute(
            select(ObjectEntity.object_id, ObjectEntity.entity_id, Entity.name, Entity.type)
            .join(Entity, Entity.id == ObjectEntity.entity_id)
        )).all()
        seen_entities = {}
        for object_id, entity_id, name, etype in rows:
            if str(object_id) not in object_ids:
                continue
            eid = f"entity:{entity_id}"
            if eid not in seen_entities:
                seen_entities[eid] = {"id": eid, "label": name, "type": "entity", "entity_type": etype}
            edges.append({"source": str(object_id), "target": eid,
                          "relationship": "ASSOCIATED_WITH", "kind": "entity"})
        nodes.extend(seen_entities.values())

    return {"nodes": nodes, "edges": edges, "counts": {"nodes": len(nodes), "edges": len(edges)}}


@router.get("/edges")
async def list_edges(
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    """Object→object relationships only (compact)."""
    edges = await graph_svc.get_all_object_edges(db)
    return {"edges": edges, "count": len(edges)}


@router.post("/reindex", status_code=202)
async def reindex_graph(
    mode: str = Query(default="additive", pattern="^(additive|full)$"),
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    """Rebuild shared-entity RELATES_TO edges across the whole graph.

    - **additive** — only create missing edges (fast, incremental)
    - **full**     — wipe RELATES_TO edges and rebuild from scratch (reindex)

    Runs as a tracked task on the Tasks page.
    """
    task = IngestionTask(task_type="reindex", object_id=None,
                         mode_level=settings.mode_level, params={"mode": mode})
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return {"task_id": str(task.id), "mode": mode, "status": "queued",
            "message": f"Graph {mode} reindex queued"}
