import uuid
from datetime import datetime
from sqlalchemy import String, Text, BigInteger, ForeignKey, DateTime, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from mind_palace.database import Base


class Attachment(Base):
    __tablename__ = "attachments"
    __table_args__ = (Index("idx_attachments_object", "object_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    object_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("objects.id", ondelete="CASCADE"), nullable=False
    )
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    parsed_content: Mapped[str | None] = mapped_column(Text)
    blob_path: Mapped[str] = mapped_column(String(2048), nullable=False)
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    object: Mapped["MPObject"] = relationship("MPObject", back_populates="attachments")
