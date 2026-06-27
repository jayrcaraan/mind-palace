import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field
from mind_palace.models.collection import CollectionScope


class CollectionCreate(BaseModel):
    name: str = Field(..., max_length=255)
    description: Optional[str] = None
    scope: CollectionScope = CollectionScope.user
    parent_collection_id: Optional[uuid.UUID] = None


class CollectionUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    parent_collection_id: Optional[uuid.UUID] = None


class CollectionResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: Optional[str]
    scope: CollectionScope
    owner_id: uuid.UUID
    agent_id: Optional[str]
    parent_collection_id: Optional[uuid.UUID]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CollectionTreeNode(CollectionResponse):
    children: list["CollectionTreeNode"] = []
    object_count: int = 0
