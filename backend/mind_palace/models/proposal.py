import uuid
import enum
from datetime import datetime
from sqlalchemy import String, Text, ForeignKey, DateTime, Enum as SAEnum, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from mind_palace.database import Base


class ProposalType(str, enum.Enum):
    add_user_memory = "add_user_memory"
    edit_user_memory = "edit_user_memory"
    delete_item = "delete_item"
    add_document = "add_document"
    create_connection = "create_connection"


class ProposalStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class Proposal(Base):
    __tablename__ = "proposals"
    __table_args__ = (
        Index("idx_proposals_status", "status"),
        Index("idx_proposals_agent", "proposer_id"),
        Index("idx_proposals_created", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proposal_type: Mapped[ProposalType] = mapped_column(
        SAEnum(ProposalType, name="proposal_type"), nullable=False
    )
    status: Mapped[ProposalStatus] = mapped_column(
        SAEnum(ProposalStatus, name="proposal_status"), nullable=False, default=ProposalStatus.pending
    )
    proposer_id: Mapped[str] = mapped_column(String(255), nullable=False)
    collection_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("collections.id", ondelete="SET NULL")
    )
    target_object_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("objects.id", ondelete="SET NULL")
    )
    proposed_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    reviewer_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
