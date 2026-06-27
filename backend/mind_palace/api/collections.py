import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from mind_palace.database import get_db
from mind_palace.models.collection import Collection, CollectionScope
from mind_palace.models.object import MPObject
from mind_palace.schemas.collection import CollectionCreate, CollectionUpdate, CollectionResponse, CollectionTreeNode
from mind_palace.auth.middleware import AuthContext, get_auth, assert_collection_access
from mind_palace.services import graph_svc

router = APIRouter(prefix="/api/v1/collections", tags=["collections"])


async def _auth(db: AsyncSession = Depends(get_db)):
    return db


async def collection_to_response(c: Collection, db: AsyncSession) -> CollectionResponse:
    return CollectionResponse(
        id=c.id, name=c.name, description=c.description, scope=c.scope,
        owner_id=c.owner_id, agent_id=c.agent_id,
        parent_collection_id=c.parent_collection_id,
        created_at=c.created_at, updated_at=c.updated_at,
    )


async def build_tree(
    all_collections: list[Collection],
    parent_id: Optional[uuid.UUID],
    object_counts: dict[uuid.UUID, int],
) -> list[CollectionTreeNode]:
    nodes = []
    for c in all_collections:
        if c.parent_collection_id == parent_id:
            node = CollectionTreeNode(
                id=c.id, name=c.name, description=c.description, scope=c.scope,
                owner_id=c.owner_id, agent_id=c.agent_id,
                parent_collection_id=c.parent_collection_id,
                created_at=c.created_at, updated_at=c.updated_at,
                object_count=object_counts.get(c.id, 0),
            )
            node.children = await build_tree(all_collections, c.id, object_counts)
            nodes.append(node)
    return nodes


@router.get("", response_model=list[CollectionTreeNode])
async def list_collections(
    scope: Optional[CollectionScope] = None,
    parent_collection_id: Optional[uuid.UUID] = None,
    flat: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    q = select(Collection)

    if auth.is_human:
        if scope:
            q = q.where(Collection.scope == scope)
    else:
        # Agents see their own agent-scoped collections + user/kb
        if scope == CollectionScope.agent:
            q = q.where(Collection.scope == CollectionScope.agent, Collection.agent_id == auth.agent_id)
        else:
            from sqlalchemy import or_
            q = q.where(or_(
                Collection.scope.in_([CollectionScope.user, CollectionScope.kb]),
                (Collection.scope == CollectionScope.agent) & (Collection.agent_id == auth.agent_id),
            ))

    result = await db.execute(q)
    collections = result.scalars().all()

    # Get object counts
    count_result = await db.execute(
        select(MPObject.collection_id, func.count(MPObject.id))
        .group_by(MPObject.collection_id)
    )
    object_counts = {row[0]: row[1] for row in count_result}

    if flat:
        return [
            CollectionTreeNode(
                id=c.id, name=c.name, description=c.description, scope=c.scope,
                owner_id=c.owner_id, agent_id=c.agent_id,
                parent_collection_id=c.parent_collection_id,
                created_at=c.created_at, updated_at=c.updated_at,
                object_count=object_counts.get(c.id, 0),
            )
            for c in collections
        ]

    return await build_tree(list(collections), parent_collection_id, object_counts)


@router.post("", response_model=CollectionResponse, status_code=201)
async def create_collection(
    body: CollectionCreate,
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    if not auth.is_human:
        # Agents can only create agent-scoped collections for themselves
        if body.scope != CollectionScope.agent:
            raise HTTPException(status_code=403, detail="Agents may only create agent-scoped collections")

    collection = Collection(
        name=body.name,
        description=body.description,
        scope=body.scope,
        owner_id=auth.user_id,
        agent_id=auth.agent_id if body.scope == CollectionScope.agent else None,
        parent_collection_id=body.parent_collection_id,
    )
    db.add(collection)
    await db.flush()

    await graph_svc.ensure_collection_vertex(db, collection.id, collection.name)
    await db.commit()
    await db.refresh(collection)
    return await collection_to_response(collection, db)


@router.put("/{collection_id}", response_model=CollectionResponse)
async def update_collection(
    collection_id: uuid.UUID,
    body: CollectionUpdate,
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    result = await db.execute(select(Collection).where(Collection.id == collection_id))
    collection = result.scalar_one_or_none()
    if not collection:
        raise HTTPException(status_code=404)
    await assert_collection_access(collection, auth, db, require_write=True)

    if body.name is not None:
        collection.name = body.name
    if body.description is not None:
        collection.description = body.description
    if body.parent_collection_id is not None:
        collection.parent_collection_id = body.parent_collection_id

    await db.commit()
    await db.refresh(collection)
    return await collection_to_response(collection, db)


@router.delete("/{collection_id}", status_code=200)
async def delete_collection(
    collection_id: uuid.UUID,
    cascade: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    result = await db.execute(select(Collection).where(Collection.id == collection_id))
    collection = result.scalar_one_or_none()
    if not collection:
        raise HTTPException(status_code=404)
    await assert_collection_access(collection, auth, db, require_write=True)

    # Check for children
    child_result = await db.execute(
        select(func.count(Collection.id)).where(Collection.parent_collection_id == collection_id)
    )
    child_count = child_result.scalar()

    object_result = await db.execute(
        select(func.count(MPObject.id)).where(MPObject.collection_id == collection_id)
    )
    object_count = object_result.scalar()

    if (child_count or object_count) and not cascade:
        raise HTTPException(
            status_code=409,
            detail=f"Collection has {child_count} sub-collections and {object_count} objects. Use cascade=true to delete all."
        )

    if cascade:
        # Recursively delete children first
        await _cascade_delete(db, collection_id)

    await db.delete(collection)
    await db.commit()
    return {"deleted": True}


async def _cascade_delete(db: AsyncSession, collection_id: uuid.UUID) -> None:
    """Recursively delete all children and their objects."""
    children = await db.execute(
        select(Collection).where(Collection.parent_collection_id == collection_id)
    )
    for child in children.scalars():
        await _cascade_delete(db, child.id)
        await db.delete(child)

    objects = await db.execute(select(MPObject).where(MPObject.collection_id == collection_id))
    for obj in objects.scalars():
        await db.delete(obj)
