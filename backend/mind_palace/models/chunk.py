import uuid
from sqlalchemy import Integer, Text, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

try:
    from pgvector.sqlalchemy import Vector
    HAS_PGVECTOR = True
except ImportError:
    HAS_PGVECTOR = False

from mind_palace.database import Base
from mind_palace.config import settings


class ObjectChunk(Base):
    __tablename__ = "object_chunks"
    __table_args__ = (Index("idx_chunks_object", "object_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    object_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("objects.id", ondelete="CASCADE"), nullable=False
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # embedding stored as JSONB array when pgvector not available (light mode)
    embedding: Mapped[list[float] | None] = mapped_column(
        Vector(settings.embedding_dimensions) if HAS_PGVECTOR else JSONB,
        nullable=True,
    )
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)

    object: Mapped["MPObject"] = relationship("MPObject", back_populates="chunks")
