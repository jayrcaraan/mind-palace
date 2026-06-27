import uuid
import enum
from datetime import datetime
from sqlalchemy import String, Text, SmallInteger, ForeignKey, DateTime, Enum as SAEnum, Integer, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from mind_palace.database import Base
from mind_palace.models.object import IngestionStatus


class IngestionStep(str, enum.Enum):
    parse = "parse"
    vision = "vision"
    embed = "embed"
    ner = "ner"
    autolink = "autolink"   # automated knowledge-graph edge creation
    index = "index"
    decay = "decay"         # scheduled importance decay pass


class TaskType(str, enum.Enum):
    document = "document"            # file upload ingestion
    memory = "memory"               # memory / entry processing
    optimize = "optimize"           # manual phase-2 re-enrichment of one object
    reindex = "reindex"             # bulk shared-entity edge (re)build
    proactive_link = "proactive_link"  # scheduled additive edge pass
    decay = "decay"                 # scheduled importance decay pass


class IngestionTask(Base):
    __tablename__ = "ingestion_tasks"
    __table_args__ = (
        Index("idx_ingestion_status", "status"),
        Index("idx_ingestion_object", "object_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    object_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("objects.id", ondelete="SET NULL")
    )
    task_type: Mapped[str] = mapped_column(String(32), nullable=False, default="document")
    # Free-form per-task parameters (e.g. {"mode": "full"} for reindex).
    params: Mapped[dict] = mapped_column(JSONB, default=dict)
    mode_level: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=2)
    status: Mapped[IngestionStatus] = mapped_column(
        SAEnum(IngestionStatus, name="ingestion_status", create_type=False),
        nullable=False, default=IngestionStatus.queued
    )
    current_step: Mapped[IngestionStep | None] = mapped_column(
        SAEnum(IngestionStep, name="ingestion_step"), nullable=True
    )
    progress_percentage: Mapped[int] = mapped_column(SmallInteger, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    object: Mapped["MPObject | None"] = relationship("MPObject", back_populates="ingestion_tasks")
    events: Mapped[list["IngestionEvent"]] = relationship(
        "IngestionEvent", back_populates="task", cascade="all, delete-orphan",
        order_by="IngestionEvent.ts"
    )
