import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mind_palace.database import get_db
from mind_palace.models.object import MPObject
from mind_palace.models.collection import Collection
from mind_palace.schemas.object import LinkCreate
from mind_palace.auth.middleware import AuthContext, get_auth, assert_collection_access, assert_can_link, privacy_filter_clause
from mind_palace.services import graph_svc

router = APIRouter(prefix="/api/v1/objects", tags=["links"])

VALID_TYPES = {"PART_OF", "THREAD", "RELATES_TO", "REFERENCES", "MENTIONS", "ASSOCIATED_WITH"}


@router.get("/{object_id}/links")
async def get_neighbors(
    object_id: uuid.UUID,
    relationship_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    result = await db.execute(select(MPObject).where(MPObject.id == object_id))
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404)

    rel_types = None
    if relationship_type:
        rel = relationship_type.upper().replace(" ", "_")
        if rel not in VALID_TYPES:
            raise HTTPException(status_code=400, detail=f"Invalid relationship type: {relationship_type}")
        rel_types = [rel]

    raw = await graph_svc.get_neighbors(db, object_id, rel_types)

    # Parse neighbor IDs out of agtype values and resolve to full objects
    neighbor_ids = []
    for row in raw:
        nid = str(row.get("neighbor_id", "")).strip('"')
        if not nid:
            continue
        try:
            neighbor_ids.append(uuid.UUID(nid))
        except ValueError:
            continue

    from mind_palace.api.objects import _enrich_object
    objects = []
    if neighbor_ids:
        res = await db.execute(select(MPObject).where(MPObject.id.in_(neighbor_ids)))
        for o in res.scalars().all():
            objects.append(await _enrich_object(o, db))

    return {"neighbors": objects, "count": len(objects)}


@router.post("/{object_id}/links", status_code=201)
async def create_link(
    object_id: uuid.UUID,
    body: LinkCreate,
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    # Verify both objects exist and caller has access
    for oid in [object_id, body.target_id]:
        result = await db.execute(select(MPObject).where(MPObject.id == oid))
        obj = result.scalar_one_or_none()
        if not obj:
            raise HTTPException(status_code=404, detail=f"Object {oid} not found")

        coll_result = await db.execute(select(Collection).where(Collection.id == obj.collection_id))
        coll = coll_result.scalar_one_or_none()
        await assert_collection_access(coll, auth, db)

    # Out-of-scope agent (no link capability) → propose the connection instead.
    if not auth.can_link:
        from mind_palace.models.proposal import Proposal, ProposalType, ProposalStatus
        p = Proposal(
            proposal_type=ProposalType.create_connection, proposer_id=auth.agent_id,
            target_object_id=object_id, proposed_data={
                "source_id": str(object_id), "target_id": str(body.target_id),
                "relationship_type": body.link_type,
            }, status=ProposalStatus.pending,
        )
        db.add(p)
        await db.commit()
        await db.refresh(p)
        return JSONResponse(status_code=202, content={
            "proposed": True, "proposal_id": str(p.id), "status": "pending",
            "message": "Outside this agent's link scope — submitted as a proposal for your review.",
        })

    await graph_svc.create_edge(db, object_id, body.target_id, body.link_type)
    await db.commit()
    return {"linked": True, "source": str(object_id), "target": str(body.target_id), "type": body.link_type}


@router.delete("/{object_id}/links/{target_id}", status_code=200)
async def delete_link(
    object_id: uuid.UUID,
    target_id: uuid.UUID,
    link_type: str = Query(default="related_to"),
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    assert_can_link(auth)
    rel = link_type.upper().replace(" ", "_")
    if rel not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid relationship type: {link_type}")

    await graph_svc.delete_edge(db, object_id, target_id, rel)
    await db.commit()
    return {"deleted": True}


@router.delete("/{object_id}/links", status_code=200)
async def clear_links(
    object_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    """Cascade-remove every edge touching this object (keeps the object itself)."""
    assert_can_link(auth)
    result = await db.execute(select(MPObject).where(MPObject.id == object_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404)
    removed = await graph_svc.clear_object_edges(db, object_id)
    return {"cleared": True, "edges_removed": removed}
