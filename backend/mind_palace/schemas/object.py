import uuid
from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, Field, AliasChoices
from mind_palace.models.object import ObjectType, IngestionStatus


class EntityInput(BaseModel):
    name: str
    type: str = "concept"


class EntityRef(BaseModel):
    id: uuid.UUID
    name: str
    type: str

    model_config = {"from_attributes": True}


class ObjectCreate(BaseModel):
    object_type: ObjectType = Field(alias="type", default=None)
    subject: str = Field("", max_length=512)
    content: str = ""
    collection_id: Optional[uuid.UUID] = None
    metadata: dict[str, Any] = {}
    importance: int = Field(default=1, ge=1, le=5)
    is_pinned: bool = False
    language: str = "en"
    tags: list[str] = []
    entities: list[EntityInput] = []

    model_config = {"populate_by_name": True}

    def get_object_type(self) -> ObjectType:
        return self.object_type or ObjectType.user_memory


class ObjectUpdate(BaseModel):
    subject: Optional[str] = Field(None, max_length=512)
    content: Optional[str] = None
    collection_id: Optional[uuid.UUID] = None
    metadata: Optional[dict[str, Any]] = None
    importance: Optional[int] = Field(None, ge=1, le=5)
    is_pinned: Optional[bool] = None
    tags: Optional[list[str]] = None
    entities: Optional[list[EntityInput]] = None  # full replacement set


class AttachmentResponse(BaseModel):
    id: uuid.UUID
    filename: str
    mime_type: str
    size_bytes: int
    parsed_content: Optional[str]
    blob_path: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ObjectResponse(BaseModel):
    id: uuid.UUID
    # Read from ORM attribute `type` (or `object_type`); always serialize as `object_type`.
    object_type: ObjectType = Field(
        validation_alias=AliasChoices("type", "object_type"),
        serialization_alias="object_type",
    )
    subject: str
    content: str
    collection_id: Optional[uuid.UUID]
    collection_name: Optional[str] = None
    contributor_id: str
    approved_at: Optional[datetime]
    status: IngestionStatus
    metadata: dict[str, Any]
    importance: int
    is_pinned: bool
    language: str
    tags: list[str] = []
    entities: list[EntityRef] = []
    created_at: datetime
    updated_at: datetime
    last_accessed_at: Optional[datetime]
    chunk_count: int = 0
    attachments: list[AttachmentResponse] = []

    model_config = {"from_attributes": True, "populate_by_name": True}


class ObjectListResponse(BaseModel):
    items: list[ObjectResponse]
    total: int
    page: int
    page_size: int
    pages: int


class LinkCreate(BaseModel):
    target_id: uuid.UUID
    link_type: str = "related_to"


class SearchQuery(BaseModel):
    q: str
    limit: int = Field(default=10, ge=1, le=100)
    collection_ids: Optional[list[uuid.UUID]] = None
    object_types: Optional[list[ObjectType]] = None
