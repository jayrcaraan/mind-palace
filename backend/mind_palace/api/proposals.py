import uuid
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mind_palace.database import get_db
from mind_palace.models.proposal import Proposal, ProposalStatus, ProposalType
from mind_palace.models.object import MPObject, ObjectType
from mind_palace.models.collection import Collection
from mind_palace.schemas.proposal import ProposalCreate, ProposalApprove, ProposalReject, ProposalResponse
from mind_palace.auth.middleware import AuthContext, get_auth

router = APIRouter(prefix="/api/v1/proposals", tags=["proposals"])


@router.get("", response_model=list[ProposalResponse])
async def list_proposals(
    status: ProposalStatus = Query(default=ProposalStatus.pending),
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    q = select(Proposal).where(Proposal.status == status).order_by(Proposal.created_at.desc())

    # Agents only see their own proposals
    if not auth.is_human:
        q = q.where(Proposal.proposer_id == auth.agent_id)

    result = await db.execute(q)
    proposals = result.scalars().all()

    # Resolve human-readable titles: the target object's subject, the proposed
    # subject, or a humanized proposal type — never a bare UUID.
    target_ids = [p.target_object_id for p in proposals if p.target_object_id]
    subjects: dict[uuid.UUID, str] = {}
    if target_ids:
        rows = (await db.execute(
            select(MPObject.id, MPObject.subject).where(MPObject.id.in_(target_ids))
        )).all()
        subjects = {r[0]: r[1] for r in rows}

    def _title(p: Proposal) -> str:
        data = p.proposed_data or {}
        return (
            data.get("subject")
            or (subjects.get(p.target_object_id) if p.target_object_id else None)
            or data.get("title")
            or p.proposal_type.value.replace("_", " ").title()
        )

    out = []
    for p in proposals:
        data, conn_title = await _enrich_connection(db, p)
        out.append(ProposalResponse(
            id=p.id, proposal_type=p.proposal_type, status=p.status,
            proposer_id=p.proposer_id, collection_id=p.collection_id,
            target_object_id=p.target_object_id,
            target_subject=subjects.get(p.target_object_id) if p.target_object_id else None,
            title=conn_title or _title(p),
            proposed_data=data,
            reviewer_note=p.reviewer_note, created_at=p.created_at, reviewed_at=p.reviewed_at,
        ))
    return out


def _proposal_title(p: Proposal, target_subject: Optional[str]) -> str:
    data = p.proposed_data or {}
    return (data.get("subject") or target_subject or data.get("title")
            or p.proposal_type.value.replace("_", " ").title())


async def _enrich_connection(db: AsyncSession, p: Proposal) -> tuple[dict, Optional[str]]:
    """For `create_connection` proposals, resolve the source/target object subjects
    so the UI shows WHAT is being linked instead of bare UUIDs. Returns the
    (possibly enriched) data dict and a connection-specific title (or None)."""
    data = dict(p.proposed_data or {})
    if p.proposal_type != ProposalType.create_connection:
        return data, None

    async def _subj(key: str) -> Optional[str]:
        try:
            oid = uuid.UUID(str(data.get(key)))
        except (ValueError, TypeError):
            return None
        return (await db.execute(select(MPObject.subject).where(MPObject.id == oid))).scalar_one_or_none()

    data["source_subject"] = await _subj("source_id")
    data["target_subject"] = await _subj("target_id")
    title = f"Link: {data['source_subject'] or 'item'} → {data['target_subject'] or 'item'}"
    return data, title


@router.get("/{proposal_id}", response_model=ProposalResponse)
async def get_proposal(
    proposal_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    p = (await db.execute(select(Proposal).where(Proposal.id == proposal_id))).scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404)
    if not auth.is_human and p.proposer_id != auth.agent_id:
        raise HTTPException(status_code=403)
    subject = None
    if p.target_object_id:
        subject = (await db.execute(select(MPObject.subject).where(MPObject.id == p.target_object_id))).scalar_one_or_none()
    data, conn_title = await _enrich_connection(db, p)
    return ProposalResponse(
        id=p.id, proposal_type=p.proposal_type, status=p.status,
        proposer_id=p.proposer_id, collection_id=p.collection_id,
        target_object_id=p.target_object_id, target_subject=subject,
        title=conn_title or _proposal_title(p, subject), proposed_data=data,
        reviewer_note=p.reviewer_note, created_at=p.created_at, reviewed_at=p.reviewed_at,
    )


@router.post("", response_model=ProposalResponse, status_code=201)
async def create_proposal(
    body: ProposalCreate,
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    proposer_id = auth.agent_id or str(auth.user_id)

    proposal = Proposal(
        proposal_type=body.proposal_type,
        proposer_id=proposer_id,
        collection_id=body.collection_id,
        target_object_id=body.target_object_id,
        proposed_data=body.data,
        status=ProposalStatus.pending,
    )
    db.add(proposal)
    await db.commit()
    await db.refresh(proposal)

    return ProposalResponse(
        id=proposal.id, proposal_type=proposal.proposal_type, status=proposal.status,
        proposer_id=proposal.proposer_id, collection_id=proposal.collection_id,
        target_object_id=proposal.target_object_id, proposed_data=proposal.proposed_data,
        reviewer_note=proposal.reviewer_note, created_at=proposal.created_at,
        reviewed_at=proposal.reviewed_at,
    )


@router.post("/{proposal_id}/approve", status_code=200)
async def approve_proposal(
    proposal_id: uuid.UUID,
    body: ProposalApprove = ProposalApprove(),
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    if not auth.is_human:
        raise HTTPException(status_code=403, detail="Only human users can approve proposals")

    result = await db.execute(select(Proposal).where(Proposal.id == proposal_id))
    proposal = result.scalar_one_or_none()
    if not proposal:
        raise HTTPException(status_code=404)
    if proposal.status != ProposalStatus.pending:
        raise HTTPException(status_code=409, detail=f"Proposal is already {proposal.status.value}")

    # Commit the proposed change
    committed_object_id = await _commit_proposal(db, proposal, body.modified_content)

    proposal.status = ProposalStatus.approved
    proposal.reviewer_note = body.note
    proposal.reviewed_at = datetime.utcnow()
    await db.commit()

    return {"approved": True, "proposal_id": str(proposal_id), "object_id": str(committed_object_id)}


@router.delete("/{proposal_id}", status_code=200)
async def withdraw_proposal(
    proposal_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    """Withdraw a pending proposal. Agents may withdraw only their own; humans any."""
    proposal = (await db.execute(select(Proposal).where(Proposal.id == proposal_id))).scalar_one_or_none()
    if not proposal:
        raise HTTPException(status_code=404)
    if not auth.is_human and proposal.proposer_id != auth.agent_id:
        raise HTTPException(status_code=403, detail="Can only withdraw your own proposals")
    if proposal.status != ProposalStatus.pending:
        raise HTTPException(status_code=409, detail=f"Proposal is already {proposal.status.value}")
    await db.delete(proposal)
    await db.commit()
    return {"withdrawn": True, "proposal_id": str(proposal_id)}


@router.post("/{proposal_id}/reject", status_code=200)
async def reject_proposal(
    proposal_id: uuid.UUID,
    body: ProposalReject = ProposalReject(),
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    if not auth.is_human:
        raise HTTPException(status_code=403, detail="Only human users can reject proposals")

    result = await db.execute(select(Proposal).where(Proposal.id == proposal_id))
    proposal = result.scalar_one_or_none()
    if not proposal:
        raise HTTPException(status_code=404)
    if proposal.status != ProposalStatus.pending:
        raise HTTPException(status_code=409, detail=f"Proposal is already {proposal.status.value}")

    proposal.status = ProposalStatus.rejected
    proposal.reviewer_note = body.note
    proposal.reviewed_at = datetime.utcnow()
    await db.commit()
    return {"rejected": True}


async def _commit_proposal(
    db: AsyncSession,
    proposal: Proposal,
    modified_content: Optional[str] = None,
) -> uuid.UUID:
    """Execute the proposed action and return the created/modified object ID."""
    data = proposal.proposed_data

    if proposal.proposal_type == ProposalType.add_user_memory:
        content = modified_content or data.get("content", "")
        obj = MPObject(
            type=ObjectType.user_memory,
            subject=data.get("subject", "Proposed Memory"),
            content=content,
            collection_id=uuid.UUID(data["collection_id"]) if "collection_id" in data else proposal.collection_id,
            contributor_id=proposal.proposer_id,
            approved_at=datetime.utcnow(),
        )
        db.add(obj)
        await db.flush()
        return obj.id

    elif proposal.proposal_type == ProposalType.edit_user_memory:
        target_id = proposal.target_object_id or uuid.UUID(data["memory_id"])
        result = await db.execute(select(MPObject).where(MPObject.id == target_id))
        obj = result.scalar_one_or_none()
        if not obj:
            raise HTTPException(status_code=404, detail="Target object not found")
        obj.content = modified_content or data.get("proposed_content", obj.content)
        obj.approved_at = datetime.utcnow()
        return obj.id

    elif proposal.proposal_type == ProposalType.delete_item:
        target_id = proposal.target_object_id
        if target_id:
            result = await db.execute(select(MPObject).where(MPObject.id == target_id))
            obj = result.scalar_one_or_none()
            if obj:
                await db.delete(obj)
        return target_id or uuid.uuid4()

    elif proposal.proposal_type == ProposalType.add_document:
        content = modified_content or data.get("content", "")
        obj = MPObject(
            type=ObjectType.kb_entry,
            subject=data.get("subject", "Proposed Document"),
            content=content,
            collection_id=uuid.UUID(data["collection_id"]) if "collection_id" in data else proposal.collection_id,
            contributor_id=proposal.proposer_id,
            approved_at=datetime.utcnow(),
        )
        db.add(obj)
        await db.flush()
        return obj.id

    elif proposal.proposal_type == ProposalType.create_connection:
        from mind_palace.services import graph_svc
        source_id = uuid.UUID(data["source_id"])
        target_id = uuid.UUID(data["target_id"])
        link_type = data["relationship_type"]
        await graph_svc.create_edge(db, source_id, target_id, link_type)
        return source_id

    raise ValueError(f"Unknown proposal type: {proposal.proposal_type}")
