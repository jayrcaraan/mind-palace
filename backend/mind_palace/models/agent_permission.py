import uuid
import enum
from sqlalchemy import String, ForeignKey, Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from mind_palace.database import Base


class PermissionLevel(str, enum.Enum):
    none = "none"
    read = "read"
    write = "write"


class AgentPermission(Base):
    __tablename__ = "agent_permissions"

    agent_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    collection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("collections.id", ondelete="CASCADE"), primary_key=True
    )
    permission_level: Mapped[PermissionLevel] = mapped_column(
        SAEnum(PermissionLevel, name="permission_level"), nullable=False, default=PermissionLevel.read
    )

    collection: Mapped["Collection"] = relationship("Collection", back_populates="permissions")
