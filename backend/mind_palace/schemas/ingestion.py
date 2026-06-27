import uuid
from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel
from mind_palace.models.object import IngestionStatus
from mind_palace.models.ingestion_task import IngestionStep
from mind_palace.models.ingestion_event import StepStatus


class IngestionEventResponse(BaseModel):
    id: uuid.UUID
    step: IngestionStep
    status: StepStatus
    detail: Optional[str]
    metadata: dict[str, Any]
    created_at: datetime = None  # ORM column is `ts`; serialized via @model_validator

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_event(cls, obj: Any) -> "IngestionEventResponse":
        data = {
            "id": obj.id,
            "step": obj.step,
            "status": obj.status,
            "detail": obj.detail,
            "metadata": obj.metadata_ or {},
            "created_at": obj.ts,
        }
        return cls(**data)


class IngestionTaskResponse(BaseModel):
    task_id: uuid.UUID
    object_id: Optional[uuid.UUID]
    mode_level: int
    status: IngestionStatus
    current_step: Optional[IngestionStep]
    progress_percentage: int
    error_message: Optional[str]
    created_at: datetime
    updated_at: datetime
    events: list[IngestionEventResponse] = []

    model_config = {"from_attributes": True}


class IngestAccepted(BaseModel):
    task_id: Optional[uuid.UUID] = None
    object_id: Optional[uuid.UUID] = None
    status: str = "queued"
    message: str = ""
