import uuid
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from mind_palace.database import get_db
from mind_palace.models.entity import Entity, ObjectEntity
from mind_palace.auth.middleware import AuthContext, get_auth

router = APIRouter(prefix="/api/v1/entities", tags=["entities"])


@router.get("")
async def list_entities(
    q: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    """List entities with usage counts — powers the entity autocomplete."""
    usage = func.count(ObjectEntity.object_id).label("usage")
    stmt = (
        select(Entity.id, Entity.name, Entity.type, usage)
        .outerjoin(ObjectEntity, ObjectEntity.entity_id == Entity.id)
        .group_by(Entity.id, Entity.name, Entity.type)
        .order_by(usage.desc(), Entity.name.asc())
        .limit(limit)
    )
    if q:
        stmt = stmt.where(func.lower(Entity.name).like(f"%{q.lower()}%"))

    rows = (await db.execute(stmt)).all()
    return [
        {"id": str(r.id), "name": r.name, "type": r.type, "usage": int(r.usage)}
        for r in rows
    ]
