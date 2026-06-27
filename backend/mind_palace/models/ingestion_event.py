import uuid
import enum
from datetime import datetime
from sqlalchemy import Text, ForeignKey, DateTime, Enum as SAEnum, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from mind_palace.database import Base
from mind_palace.models.ingestion_task import IngestionStep


class StepStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    skipped = "skipped"
    failed = "failed"


class IngestionEvent(Base):
    __tablename__ = "ingestion_events"
    __table_args__ = (Index("idx_events_task_ts", "task_id", "ts"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ingestion_tasks.id", ondelete="CASCADE"), nullable=False
    )
    step: Mapped[IngestionStep] = mapped_column(
        SAEnum(IngestionStep, name="ingestion_step", create_type=False), nullable=False
    )
    status: Mapped[StepStatus] = mapped_column(
        SAEnum(StepStatus, name="step_status"), nullable=False
    )
    detail: Mapped[str | None] = mapped_column(Text)
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    task: Mapped["IngestionTask"] = relationship("IngestionTask", back_populates="events")
