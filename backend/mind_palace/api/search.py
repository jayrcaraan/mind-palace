import uuid
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from mind_palace.database import get_db
from mind_palace.models.object import ObjectType
from mind_palace.auth.middleware import AuthContext, get_auth
from mind_palace.services.search_svc import hybrid_search
from mind_palace.api.objects import _enrich_object

router = APIRouter(prefix="/api/v1/search", tags=["search"])


@router.get("")
async def search(
    q: str = Query(default="", description="search text; empty = browse the filters"),
    limit: int = Query(default=10, ge=1, le=50),
    top_k: Optional[int] = Query(default=None, ge=1, le=50, description="alias for limit"),
    graph_boost: float = Query(default=0.15, ge=0.0, le=1.0, description="graph-connection boost weight"),
    collection_ids: Optional[str] = Query(default=None, description="Comma-separated UUIDs"),
    entity_ids: Optional[str] = Query(default=None, description="Comma-separated entity UUIDs"),
    object_types: Optional[str] = Query(default=None, description="Comma-separated: user_memory,agent_memory,kb_entry"),
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    limit = top_k or limit
    coll_ids = None
    if collection_ids:
        coll_ids = [uuid.UUID(c.strip()) for c in collection_ids.split(",") if c.strip()]

    ent_ids = None
    if entity_ids:
        ent_ids = [uuid.UUID(e.strip()) for e in entity_ids.split(",") if e.strip()]

    obj_types = None
    if object_types:
        obj_types = [ObjectType(t.strip()) for t in object_types.split(",") if t.strip()]

    # Need either text or at least one filter to return anything.
    if not q.strip() and not (coll_ids or ent_ids or obj_types):
        return []

    results = await hybrid_search(db, auth, q, limit=limit, collection_ids=coll_ids,
                                  object_types=obj_types, entity_ids=ent_ids, graph_boost=graph_boost)

    output = []
    for r in results:
        obj = r["object"]
        enriched = await _enrich_object(obj, db)
        output.append({
            "id": str(obj.id),
            "object_type": obj.type.value,
            "subject": obj.subject or "",
            "content": obj.content or "",
            "snippet": r.get("snippet"),
            "score": r["score"],
            "tags": enriched.tags,
            "collection_id": str(obj.collection_id) if obj.collection_id else None,
            "collection_name": enriched.collection_name,
            "entities": [e.name for e in enriched.entities],
            "importance": obj.importance,
            "created_at": obj.created_at.isoformat(),
        })

    return output
