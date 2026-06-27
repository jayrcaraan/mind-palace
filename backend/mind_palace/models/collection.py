import uuid
from datetime import datetime
from sqlalchemy import String, Text, ForeignKey, DateTime, CheckConstraint, Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
import enum

from mind_palace.database import Base


class CollectionScope(str, enum.Enum):
    user = "user"
    agent = "agent"
    kb = "kb"


class Collection(Base):
    __tablename__ = "collections"
    __table_args__ = (
        CheckConstraint(
            "(scope = 'agent' AND agent_id IS NOT NULL) OR (scope != 'agent' AND agent_id IS NULL)",
            name="chk_agent_scope",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    scope: Mapped[CollectionScope] = mapped_column(
        SAEnum(CollectionScope, name="collection_scope"), nullable=False, default=CollectionScope.user
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    agent_id: Mapped[str | None] = mapped_column(String(255))
    parent_collection_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("collections.id", ondelete="SET NULL"), nullable=True
    )
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    parent: Mapped["Collection | None"] = relationship("Collection", remote_side="Collection.id")
    children: Mapped[list["Collection"]] = relationship("Collection", back_populates="parent", foreign_keys=[parent_collection_id])
    objects: Mapped[list["MPObject"]] = relationship("MPObject", back_populates="collection")
    permissions: Mapped[list["AgentPermission"]] = relationship("AgentPermission", back_populates="collection")
