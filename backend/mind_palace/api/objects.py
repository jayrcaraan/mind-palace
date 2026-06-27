import uuid
import math
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import select, func, and_, text, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from mind_palace.config import settings
from mind_palace.database import get_db
from mind_palace.models.object import MPObject, ObjectType
from mind_palace.models.collection import Collection
from mind_palace.models.entity import Entity, ObjectEntity
from mind_palace.models.proposal import Proposal, ProposalType, ProposalStatus
from mind_palace.schemas.object import ObjectCreate, ObjectUpdate, ObjectResponse, ObjectListResponse
from mind_palace.auth.middleware import (
    AuthContext, get_auth, assert_collection_access, agent_can_write_target, privacy_filter_clause,
)
from mind_palace.services import graph_svc

router = APIRouter(prefix="/api/v1/objects", tags=["objects"])


async def _propose(db, auth, proposal_type, collection_id, target_object_id, data) -> JSONResponse:
    """An out-of-scope agent write becomes a proposal awaiting human review."""
    p = Proposal(
        proposal_type=proposal_type, proposer_id=auth.agent_id,
        collection_id=collection_id, target_object_id=target_object_id,
        proposed_data=data, status=ProposalStatus.pending,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return JSONResponse(status_code=202, content={
        "proposed": True, "proposal_id": str(p.id), "status": "pending",
        "message": "Outside this agent's write scope — submitted as a proposal for your review.",
    })


def _tags_from_obj(obj: MPObject) -> list[str]:
    meta = obj.metadata_ or {}
    return meta.get("tags", [])


async def _enrich_object(obj: MPObject, db: AsyncSession) -> ObjectResponse:
    from mind_palace.models.chunk import ObjectChunk
    from mind_palace.models.attachment import Attachment
    from mind_palace.schemas.object import AttachmentResponse, EntityRef

    chunk_count = (
        await db.execute(select(func.count(ObjectChunk.id)).where(ObjectChunk.object_id == obj.id))
    ).scalar() or 0

    attachments = (
        await db.execute(select(Attachment).where(Attachment.object_id == obj.id))
    ).scalars().all()

    att_responses = [
        AttachmentResponse(
            id=a.id, filename=a.filename, mime_type=a.mime_type,
            size_bytes=a.size_bytes, parsed_content=a.parsed_content,
            blob_path=a.blob_path, created_at=a.created_at,
        )
        for a in attachments
    ]

    # Linked entities
    ent_rows = (await db.execute(
        select(Entity).join(ObjectEntity, ObjectEntity.entity_id == Entity.id)
        .where(ObjectEntity.object_id == obj.id)
        .order_by(Entity.name)
    )).scalars().all()
    entities = [EntityRef(id=e.id, name=e.name, type=e.type) for e in ent_rows]

    coll = None
    if obj.collection_id:
        coll = (await db.execute(select(Collection).where(Collection.id == obj.collection_id))).scalar_one_or_none()

    return ObjectResponse(
        id=obj.id,
        type=obj.type,
        subject=obj.subject,
        content=obj.content,
        collection_id=obj.collection_id,
        collection_name=coll.name if coll else None,
        contributor_id=obj.contributor_id,
        approved_at=obj.approved_at,
        status=obj.status,
        metadata=obj.metadata_,
        importance=obj.importance,
        is_pinned=obj.is_pinned,
        language=obj.language,
        tags=_tags_from_obj(obj),
        entities=entities,
        created_at=obj.created_at,
        updated_at=obj.updated_at,
        last_accessed_at=obj.last_accessed_at,
        chunk_count=chunk_count,
        attachments=att_responses,
    )


async def _set_object_entities(db: AsyncSession, obj_id: uuid.UUID, entities: list, contributor_id: str) -> None:
    """Replace an object's entity links with the supplied set, creating entities as needed."""
    # Clear existing links
    existing = (await db.execute(select(ObjectEntity).where(ObjectEntity.object_id == obj_id))).scalars().all()
    for link in existing:
        await db.delete(link)
    await db.flush()

    seen = set()
    new_entity_ids = []
    for ent in entities:
        name = (ent.name or "").strip()
        etype = (ent.type or "concept").strip() or "concept"
        if not name or (name.lower(), etype.lower()) in seen:
            continue
        seen.add((name.lower(), etype.lower()))
        entity = (await db.execute(
            select(Entity).where(func.lower(Entity.name) == name.lower(), func.lower(Entity.type) == etype.lower())
        )).scalar_one_or_none()
        if not entity:
            entity = Entity(name=name, type=etype)
            db.add(entity)
            await db.flush()
        db.add(ObjectEntity(object_id=obj_id, entity_id=entity.id))
        new_entity_ids.append((entity.id, name, etype))
    await db.flush()
    return new_entity_ids


_SORT_FIELDS = {
    "updated_at": MPObject.updated_at,
    "created_at": MPObject.created_at,
    "subject": MPObject.subject,
    "importance": MPObject.importance,
    "last_accessed_at": MPObject.last_accessed_at,
}


@router.get("", response_model=ObjectListResponse)
async def list_objects(
    object_type: Optional[ObjectType] = Query(default=None, alias="object_type"),
    type: Optional[ObjectType] = Query(default=None),  # backward compat alias
    collection_id: Optional[str] = None,           # UUID, or "none" for uncategorized
    contributor_id: Optional[str] = None,          # filter agent-memory by author
    q: Optional[str] = None,
    is_pinned: Optional[bool] = None,
    sort: str = Query(default="updated_at:desc"),  # "<field>:<asc|desc>"
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    effective_type = object_type or type
    conditions = []

    priv_filter = privacy_filter_clause(auth)
    if priv_filter is not None:
        conditions.append(priv_filter)

    if effective_type:
        conditions.append(MPObject.type == effective_type)
    if collection_id == "none":
        conditions.append(MPObject.collection_id.is_(None))
    elif collection_id:
        try:
            conditions.append(MPObject.collection_id == uuid.UUID(collection_id))
        except ValueError:
            pass
    if contributor_id:
        conditions.append(MPObject.contributor_id == contributor_id)
    if is_pinned is not None:
        conditions.append(MPObject.is_pinned == is_pinned)

    # Parse sort
    field_name, _, direction = sort.partition(":")
    sort_col = _SORT_FIELDS.get(field_name, MPObject.updated_at)
    order = sort_col.asc() if direction == "asc" else sort_col.desc()

    if q:
        conditions.append(text("content_fts @@ plainto_tsquery('english', :q)"))
        where = and_(*conditions) if conditions else True
        total = (await db.execute(select(func.count(MPObject.id)).where(where), {"q": q})).scalar() or 0
        result = await db.execute(
            select(MPObject).where(where).order_by(order)
            .limit(page_size).offset((page - 1) * page_size),
            {"q": q},
        )
    else:
        where = and_(*conditions) if conditions else True
        total = (await db.execute(select(func.count(MPObject.id)).where(where))).scalar() or 0
        result = await db.execute(
            select(MPObject).where(where).order_by(order)
            .limit(page_size).offset((page - 1) * page_size),
        )

    items = result.scalars().all()
    enriched = [await _enrich_object(obj, db) for obj in items]
    return ObjectListResponse(
        items=enriched, total=total, page=page,
        page_size=page_size, pages=max(1, math.ceil(total / page_size))
    )


@router.post("", response_model=ObjectResponse, status_code=201)
async def create_object(
    body: ObjectCreate,
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    obj_type = body.object_type or ObjectType.user_memory
    collection = None

    if body.collection_id:
        coll_result = await db.execute(select(Collection).where(Collection.id == body.collection_id))
        collection = coll_result.scalar_one_or_none()
        if not collection:
            raise HTTPException(status_code=404, detail="Collection not found")
        await assert_collection_access(collection, auth, db)

    # Out-of-scope agent → propose instead of writing directly.
    if not agent_can_write_target(auth, collection, obj_type):
        ptype = ProposalType.add_document if obj_type == ObjectType.kb_entry else ProposalType.add_user_memory
        return await _propose(db, auth, ptype, body.collection_id, None, {
            "subject": body.subject, "content": body.content, "object_type": obj_type.value,
            "tags": body.tags, "importance": body.importance,
            "collection_id": str(body.collection_id) if body.collection_id else None,
        })

    meta = dict(body.metadata or {})
    if body.tags:
        meta["tags"] = body.tags

    obj = MPObject(
        type=obj_type,
        subject=body.subject or "",
        content=body.content or "",
        collection_id=body.collection_id,
        contributor_id=auth.agent_id or str(auth.user_id),
        metadata_=meta,
        importance=body.importance,
        is_pinned=body.is_pinned,
        language=body.language,
    )
    db.add(obj)
    await db.flush()

    # Store client-supplied entities up front (so search works immediately)
    await _set_object_entities(db, obj.id, body.entities, obj.contributor_id)

    # Ensure the collection vertex exists (cheap, best-effort)
    if body.collection_id and collection:
        await graph_svc.ensure_collection_vertex(db, body.collection_id, collection.name)

    # Enqueue a tracked background task: embed (standard+), ner (advanced),
    # autolink (knowledge-graph edges), index. Observable on the Tasks page.
    from mind_palace.models.ingestion_task import IngestionTask
    task = IngestionTask(object_id=obj.id, task_type="memory", mode_level=settings.mode_level)
    db.add(task)
    obj_id = obj.id
    await db.commit()

    refreshed = await db.execute(select(MPObject).where(MPObject.id == obj_id))
    return await _enrich_object(refreshed.scalar_one(), db)


@router.get("/{object_id}", response_model=ObjectResponse)
async def get_object(
    object_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    result = await db.execute(select(MPObject).where(MPObject.id == object_id))
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404)

    priv = privacy_filter_clause(auth)
    if priv is not None:
        check = await db.execute(select(MPObject.id).where(MPObject.id == object_id).where(priv))
        if not check.scalar_one_or_none():
            raise HTTPException(status_code=403)

    await db.execute(
        text("UPDATE objects SET last_accessed_at = NOW() WHERE id = :id"),
        {"id": object_id}
    )
    await db.commit()
    return await _enrich_object(obj, db)


@router.put("/{object_id}", response_model=ObjectResponse)
async def update_object(
    object_id: uuid.UUID,
    body: ObjectUpdate,
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    result = await db.execute(select(MPObject).where(MPObject.id == object_id))
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404)

    coll = None
    if obj.collection_id:
        coll = (await db.execute(select(Collection).where(Collection.id == obj.collection_id))).scalar_one_or_none()

    # Out-of-scope agent edit → propose instead of mutating directly.
    if not agent_can_write_target(auth, coll, obj.type):
        return await _propose(db, auth, ProposalType.edit_user_memory, obj.collection_id, obj.id, {
            "subject": body.subject if body.subject is not None else obj.subject,
            "proposed_content": body.content if body.content is not None else obj.content,
        })

    if body.subject is not None:
        obj.subject = body.subject
    if body.content is not None:
        obj.content = body.content
    if body.collection_id is not None:
        obj.collection_id = body.collection_id
    if body.importance is not None:
        from datetime import datetime, timezone
        obj.importance = body.importance
        obj.importance_updated_at = datetime.now(timezone.utc)  # reset decay clock
    if body.is_pinned is not None:
        obj.is_pinned = body.is_pinned
    if body.tags is not None:
        meta = dict(obj.metadata_ or {})
        meta["tags"] = body.tags
        obj.metadata_ = meta
    if body.metadata is not None:
        obj.metadata_ = body.metadata

    entity_ids = None
    if body.entities is not None:
        entity_ids = await _set_object_entities(db, obj.id, body.entities, obj.contributor_id)

    obj_id = obj.id
    obj_type_val = obj.type.value
    contributor = obj.contributor_id
    await db.commit()

    # Sync entity vertices/edges into the graph (best effort, isolated sessions)
    if entity_ids is not None:
        await graph_svc.ensure_object_vertex(db, obj_id, obj_type_val, contributor)
        for eid, name, etype in entity_ids:
            await graph_svc.ensure_entity_vertex(db, eid, name, etype)
            await graph_svc.link_object_to_entity(db, obj_id, eid)
        if entity_ids:
            await graph_svc.auto_link_by_shared_entities(db, obj_id, [eid for eid, _, _ in entity_ids])

    refreshed = await db.execute(select(MPObject).where(MPObject.id == obj_id))
    return await _enrich_object(refreshed.scalar_one(), db)


@router.post("/{object_id}/optimize", status_code=202)
async def optimize_object(
    object_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    """Re-run phase-2 enrichment (embed → NER → autolink → index) for one object.

    Useful to upgrade an entry created in light mode or before models were online,
    without re-uploading. Tracked on the Tasks page as an `optimize` task.
    """
    obj = (await db.execute(select(MPObject).where(MPObject.id == object_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404)
    if obj.collection_id:
        coll = (await db.execute(select(Collection).where(Collection.id == obj.collection_id))).scalar_one_or_none()
        await assert_collection_access(coll, auth, db)  # read access; re-enrichment is non-destructive

    from mind_palace.models.ingestion_task import IngestionTask
    task = IngestionTask(object_id=object_id, task_type="optimize", mode_level=settings.mode_level)
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return {"task_id": str(task.id), "object_id": str(object_id), "status": "queued",
            "message": "Optimization queued"}


@router.delete("/{object_id}", status_code=200)
async def delete_object(
    object_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    result = await db.execute(select(MPObject).where(MPObject.id == object_id))
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404)

    coll = None
    if obj.collection_id:
        coll = (await db.execute(select(Collection).where(Collection.id == obj.collection_id))).scalar_one_or_none()

    # Out-of-scope agent delete → propose instead of removing directly.
    if not agent_can_write_target(auth, coll, obj.type):
        return await _propose(db, auth, ProposalType.delete_item, obj.collection_id, obj.id, {
            "subject": obj.subject,
        })

    obj_id = obj.id
    # Remove the object's ingestion tasks (+ their events cascade) so the Tasks
    # page isn't left with orphaned "document"/"memory" rows pointing at nothing.
    from mind_palace.models.ingestion_task import IngestionTask
    await db.execute(sa_delete(IngestionTask).where(IngestionTask.object_id == obj_id))
    await db.delete(obj)
    await db.commit()
    # Cascade: remove the object's graph vertex and every edge touching it so no
    # orphaned edges linger in the knowledge graph. Best-effort, isolated session.
    await graph_svc.detach_delete_object(db, obj_id)
    return {"deleted": True}
