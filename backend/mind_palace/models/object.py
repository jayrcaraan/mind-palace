import uuid
import enum
from datetime import datetime
from sqlalchemy import (
    String, Text, ForeignKey, DateTime, SmallInteger, Boolean,
    Enum as SAEnum, Index
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from mind_palace.database import Base


class ObjectType(str, enum.Enum):
    user_memory = "user_memory"
    agent_memory = "agent_memory"
    kb_entry = "kb_entry"


class IngestionStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"


class MPObject(Base):
    __tablename__ = "objects"
    __table_args__ = (
        Index("idx_objects_type", "type"),
        Index("idx_objects_collection", "collection_id"),
        Index("idx_objects_contributor", "contributor_id"),
        Index("idx_objects_metadata", "metadata", postgresql_using="gin"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    type: Mapped[ObjectType] = mapped_column(SAEnum(ObjectType, name="object_type"), nullable=False)
    subject: Mapped[str] = mapped_column(String(512), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    collection_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("collections.id", ondelete="RESTRICT"), nullable=True
    )
    contributor_id: Mapped[str] = mapped_column(String(255), nullable=False)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    raw_file_path: Mapped[str | None] = mapped_column(String(2048))
    status: Mapped[IngestionStatus] = mapped_column(
        SAEnum(IngestionStatus, name="ingestion_status"), nullable=False, default=IngestionStatus.completed
    )
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    importance: Mapped[int] = mapped_column(SmallInteger, default=1)
    # Tracks when importance last changed — drives time-based decay independently
    # of `updated_at` (which the DB trigger bumps on every write).
    importance_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    language: Mapped[str] = mapped_column(String(32), default="en")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    last_accessed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    collection: Mapped["Collection"] = relationship("Collection", back_populates="objects")
    chunks: Mapped[list["ObjectChunk"]] = relationship("ObjectChunk", back_populates="object", cascade="all, delete-orphan")
    attachments: Mapped[list["Attachment"]] = relationship("Attachment", back_populates="object", cascade="all, delete-orphan")
    entity_links: Mapped[list["ObjectEntity"]] = relationship("ObjectEntity", back_populates="object", cascade="all, delete-orphan")
    ingestion_tasks: Mapped[list["IngestionTask"]] = relationship("IngestionTask", back_populates="object")
