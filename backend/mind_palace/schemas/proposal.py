import uuid
from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel
from mind_palace.models.proposal import ProposalType, ProposalStatus


class ProposalCreate(BaseModel):
    proposal_type: ProposalType
    collection_id: Optional[uuid.UUID] = None
    target_object_id: Optional[uuid.UUID] = None
    data: dict[str, Any]


class ProposalApprove(BaseModel):
    modified_content: Optional[str] = None
    note: Optional[str] = None


class ProposalReject(BaseModel):
    note: Optional[str] = None


class ProposalResponse(BaseModel):
    id: uuid.UUID
    proposal_type: ProposalType
    status: ProposalStatus
    proposer_id: str
    collection_id: Optional[uuid.UUID]
    target_object_id: Optional[uuid.UUID]
    target_subject: Optional[str] = None   # human-readable name of the target object
    title: Optional[str] = None            # best human label for the proposal
    proposed_data: dict[str, Any]
    reviewer_note: Optional[str]
    created_at: datetime
    reviewed_at: Optional[datetime]

    model_config = {"from_attributes": True}
