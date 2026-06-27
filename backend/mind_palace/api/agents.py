import uuid
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from mind_palace.database import get_db
from mind_palace.models.agent import Agent
from mind_palace.models.object import MPObject, ObjectType
from mind_palace.models.collection import Collection, CollectionScope
from mind_palace.models.proposal import Proposal
from mind_palace.models.ingestion_task import IngestionTask
from mind_palace.schemas.agent import AgentCreate, AgentUpdate, AgentResponse, AgentTokenResponse
from mind_palace.auth.middleware import AuthContext, get_auth
from mind_palace.services import graph_svc

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/agents", tags=["agents"])


async def _purge_agent_private_data(db: AsyncSession, agent_id: str) -> dict:
    """Remove everything private to an agent: its `agent_memory` objects, its
    agent-scoped collections (and their contents), and its pending proposals —
    plus the graph vertices/edges and ingestion tasks for those objects.

    Shared data the agent may have written (user_memory / kb_entry) is NOT
    touched — that belongs to the user/knowledge base, not the agent.
    """
    # 1. The agent's own private memories.
    obj_ids = [r[0] for r in (await db.execute(
        select(MPObject.id).where(
            MPObject.type == ObjectType.agent_memory, MPObject.contributor_id == agent_id
        )
    )).all()]

    # 2. The agent's own collections + everything inside them.
    coll_ids = [r[0] for r in (await db.execute(
        select(Collection.id).where(
            Collection.scope == CollectionScope.agent, Collection.agent_id == agent_id
        )
    )).all()]
    if coll_ids:
        obj_ids += [r[0] for r in (await db.execute(
            select(MPObject.id).where(MPObject.collection_id.in_(coll_ids))
        )).all()]
    obj_ids = list(dict.fromkeys(obj_ids))  # dedupe, preserve order

    # Drop ingestion tasks first (object_id FK is SET NULL → would orphan them).
    if obj_ids:
        await db.execute(sa_delete(IngestionTask).where(IngestionTask.object_id.in_(obj_ids)))
        for oid in obj_ids:
            o = (await db.execute(select(MPObject).where(MPObject.id == oid))).scalar_one_or_none()
            if o:
                await db.delete(o)            # cascades chunks / attachments / entity links
        await db.flush()                       # objects gone before their collections
    for cid in coll_ids:
        c = (await db.execute(select(Collection).where(Collection.id == cid))).scalar_one_or_none()
        if c:
            await db.delete(c)

    # 3. The agent's pending/own proposals.
    props = (await db.execute(
        sa_delete(Proposal).where(Proposal.proposer_id == agent_id).returning(Proposal.id)
    )).fetchall()
    await db.commit()

    # 4. Cascade the knowledge-graph vertices + edges for the deleted objects.
    for oid in obj_ids:
        await graph_svc.detach_delete_object(db, oid)

    summary = {"memories": len(obj_ids), "collections": len(coll_ids), "proposals": len(props)}
    log.info("Purged private data for agent %s: %s", agent_id, summary)
    return summary


def _agent_response(agent: Agent) -> AgentResponse:
    return AgentResponse(
        id=agent.id,
        name=agent.name,
        description=agent.description,
        capabilities=agent.capabilities or [],
        revoked=agent.revoked,
        last_seen_at=agent.last_used_at,
        created_at=agent.created_at,
    )


@router.get("", response_model=list[AgentResponse])
async def list_agents(
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    if not auth.is_human:
        raise HTTPException(status_code=403, detail="Only human users can list agents")
    result = await db.execute(
        select(Agent).where(Agent.owner_id == auth.user_id).order_by(Agent.created_at)
    )
    return [_agent_response(a) for a in result.scalars().all()]


@router.post("", response_model=AgentTokenResponse, status_code=201)
async def create_agent(
    body: AgentCreate,
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    if not auth.is_human:
        raise HTTPException(status_code=403, detail="Only human users can create agents")

    token = Agent.generate_token()
    agent = Agent(
        name=body.name,
        description=body.description,
        capabilities=body.capabilities,
        token_hash=Agent.hash_token(token),
        owner_id=auth.user_id,
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)

    return AgentTokenResponse(agent=_agent_response(agent), token=token)


@router.patch("/{agent_id}", response_model=AgentResponse)
async def update_agent(
    agent_id: uuid.UUID,
    body: AgentUpdate,
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    if not auth.is_human:
        raise HTTPException(status_code=403, detail="Only human users can edit agents")
    agent = (await db.execute(
        select(Agent).where(Agent.id == agent_id, Agent.owner_id == auth.user_id)
    )).scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404)
    if body.name is not None:
        agent.name = body.name
    if body.description is not None:
        agent.description = body.description
    if body.capabilities is not None:
        agent.capabilities = body.capabilities
    await db.commit()
    await db.refresh(agent)
    return _agent_response(agent)


@router.delete("/{agent_id}", status_code=200)
async def revoke_agent(
    agent_id: uuid.UUID,
    purge: bool = Query(default=True, description="also delete the agent's private memory"),
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    if not auth.is_human:
        raise HTTPException(status_code=403)
    result = await db.execute(
        select(Agent).where(Agent.id == agent_id, Agent.owner_id == auth.user_id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404)
    agent.revoked = True
    await db.commit()
    # Revoking access also cleans up the agent's private data by default, so a
    # revoked agent leaves nothing private behind (pass ?purge=false to keep it).
    cleaned = await _purge_agent_private_data(db, str(agent_id)) if purge else None
    return {"revoked": True, "purged": purge, "cleaned": cleaned}
