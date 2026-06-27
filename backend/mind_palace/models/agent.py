import uuid
import enum
import secrets
from datetime import datetime
from sqlalchemy import String, Text, Boolean, DateTime, Index, Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from mind_palace.database import Base


class AgentPermissionLevel(str, enum.Enum):
    none = "none"
    read = "read"
    write = "write"


class Agent(Base):
    __tablename__ = "agents"
    __table_args__ = (
        Index("idx_agents_token_hash", "token_hash"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    token_hash: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    capabilities: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    permission_level: Mapped[AgentPermissionLevel] = mapped_column(
        SAEnum(AgentPermissionLevel, name="agent_permission_level"),
        nullable=False, default=AgentPermissionLevel.read
    )
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @staticmethod
    def hash_token(token: str) -> str:
        import hashlib
        return hashlib.sha256(token.encode()).hexdigest()

    @staticmethod
    def generate_token() -> str:
        return f"mp_agt_{secrets.token_urlsafe(32)}"
