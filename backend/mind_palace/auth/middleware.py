import hashlib
import uuid
from typing import Optional
from fastapi import Depends, HTTPException, Security, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mind_palace.database import get_db
from mind_palace.models.agent import Agent
from mind_palace.models.collection import Collection, CollectionScope

security = HTTPBearer(auto_error=False)

ADMIN_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")

# Capability vocabulary — the single source of truth for what an agent may do.
CAP_READ_MEMORY = "read_memory"
CAP_READ_KB = "read_kb"
CAP_LINK = "link_nodes"
CAP_WRITE_MEMORY = "write_memory"
CAP_WRITE_KB = "write_kb"


class AuthContext:
    def __init__(
        self,
        is_human: bool,
        user_id: uuid.UUID,
        agent_id: Optional[str] = None,
        agent_capabilities: Optional[list[str]] = None,
    ):
        self.is_human = is_human
        self.user_id = user_id
        self.agent_id = agent_id
        self.capabilities = agent_capabilities or []

    def has_capability(self, cap: str) -> bool:
        return cap in self.capabilities

    @property
    def can_write_any(self) -> bool:
        return self.is_human or CAP_WRITE_MEMORY in self.capabilities or CAP_WRITE_KB in self.capabilities

    @property
    def can_link(self) -> bool:
        # linking is non-destructive; either an explicit link cap or any write cap grants it
        return self.is_human or CAP_LINK in self.capabilities or self.can_write_any


async def get_auth(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security),
    db: AsyncSession = Depends(get_db),
) -> AuthContext:
    if credentials is None:
        return AuthContext(is_human=True, user_id=ADMIN_USER_ID)

    token = credentials.credentials

    if token.startswith("mp_agt_"):
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        result = await db.execute(
            select(Agent).where(Agent.token_hash == token_hash, Agent.revoked == False)
        )
        agent = result.scalar_one_or_none()
        if not agent:
            raise HTTPException(status_code=401, detail="Invalid or revoked agent token")
        import datetime
        agent.last_used_at = datetime.datetime.utcnow()
        await db.commit()
        return AuthContext(
            is_human=False,
            user_id=agent.owner_id,
            agent_id=str(agent.id),
            agent_capabilities=agent.capabilities,
        )

    raise HTTPException(status_code=401, detail="Unrecognized token format")


async def assert_collection_access(
    collection: Optional[Collection],
    auth: AuthContext,
    db: AsyncSession,
    require_write: bool = False,
) -> None:
    """Authorize a collection operation purely from the agent's capabilities.

    - own agent-scoped collection → full access
    - writes to a KB collection require `write_kb`; to anything else `write_memory`
    - reads are governed by the privacy filter (agents never see others' private memory)
    """
    if auth.is_human:
        return
    if collection is None:
        # A write with no collection (uncategorized) still needs a write capability.
        if require_write and not auth.can_write_any:
            raise HTTPException(status_code=403, detail="Write requires a write capability")
        return

    if collection.scope == CollectionScope.agent:
        if collection.agent_id != auth.agent_id:
            raise HTTPException(status_code=403, detail="Access denied")
        return  # an agent has full control over its own collection

    if require_write:
        needed = CAP_WRITE_KB if collection.scope == CollectionScope.kb else CAP_WRITE_MEMORY
        if not auth.has_capability(needed):
            raise HTTPException(status_code=403, detail=f"Write requires capability: {needed}")


def assert_can_link(auth: AuthContext) -> None:
    """Authorize edge creation/removal — needs the link (or any write) capability."""
    if not auth.can_link:
        raise HTTPException(status_code=403, detail=f"Linking requires capability: {CAP_LINK}")


def agent_can_write_target(auth: AuthContext, collection: Optional[Collection], object_type=None) -> bool:
    """Whether the caller may *directly* write this target (vs. having to propose).

    Humans always can. An agent can write its own agent-scoped collection, or a
    user/KB target only if it holds the matching write capability.
    """
    if auth.is_human:
        return True
    if collection is not None and collection.scope == CollectionScope.agent:
        return collection.agent_id == auth.agent_id
    # Decide KB vs memory from the collection scope, falling back to object type.
    from mind_palace.models.object import ObjectType
    is_kb = (collection is not None and collection.scope == CollectionScope.kb) or \
            (object_type == ObjectType.kb_entry)
    return auth.has_capability(CAP_WRITE_KB if is_kb else CAP_WRITE_MEMORY)


def privacy_filter_clause(auth: AuthContext):
    from sqlalchemy import or_, and_
    from mind_palace.models.object import MPObject, ObjectType

    if auth.is_human:
        return None

    return or_(
        MPObject.type.in_([ObjectType.user_memory, ObjectType.kb_entry]),
        and_(
            MPObject.type == ObjectType.agent_memory,
            MPObject.contributor_id == auth.agent_id,
        ),
    )
