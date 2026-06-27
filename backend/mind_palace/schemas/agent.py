import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, model_validator


class AgentCreate(BaseModel):
    name: str
    description: Optional[str] = None
    capabilities: list[str] = []


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    capabilities: Optional[list[str]] = None


class AgentResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: Optional[str]
    capabilities: list[str]
    revoked: bool
    last_seen_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def remap_last_used(cls, values):
        if hasattr(values, "__dict__"):
            # ORM object — extract last_used_at as last_seen_at
            return {
                "id": values.id,
                "name": values.name,
                "description": values.description,
                "capabilities": values.capabilities,
                "revoked": values.revoked,
                "last_seen_at": values.last_used_at,
                "created_at": values.created_at,
            }
        if isinstance(values, dict):
            if "last_used_at" in values and "last_seen_at" not in values:
                values["last_seen_at"] = values.pop("last_used_at")
        return values


class AgentTokenResponse(BaseModel):
    agent: AgentResponse
    token: str
