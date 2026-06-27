"""Attachment access — list, view/download, and pull raw bytes (for agents).

In light/standard mode the server does NOT OCR images; it keeps them as
attachments so they're never lost. Agents are expected to pull the raw bytes and
reconstruct / parse them on their own.
"""
import os
import base64
import uuid
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mind_palace.database import get_db
from mind_palace.models.object import MPObject
from mind_palace.models.attachment import Attachment
from mind_palace.auth.middleware import AuthContext, get_auth, privacy_filter_clause

router = APIRouter(prefix="/api/v1/attachments", tags=["attachments"])

MAX_INLINE_BYTES = 20 * 1024 * 1024  # cap base64 payloads at 20 MB


async def _load(attachment_id: uuid.UUID, auth: AuthContext, db: AsyncSession) -> Attachment:
    att = (await db.execute(select(Attachment).where(Attachment.id == attachment_id))).scalar_one_or_none()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")
    # The caller must be able to read the parent object (privacy filter for agents).
    priv = privacy_filter_clause(auth)
    q = select(MPObject.id).where(MPObject.id == att.object_id)
    if priv is not None:
        q = q.where(priv)
    if not (await db.execute(q)).scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Access denied")
    return att


def _meta(att: Attachment) -> dict:
    return {
        "id": str(att.id),
        "object_id": str(att.object_id),
        "filename": att.filename,
        "mime_type": att.mime_type,
        "size_bytes": att.size_bytes,
        "parsed_content": att.parsed_content,
        "created_at": att.created_at.isoformat(),
        "content_url": f"/api/v1/attachments/{att.id}/content",
    }


@router.get("/{attachment_id}")
async def get_attachment(attachment_id: uuid.UUID, db: AsyncSession = Depends(get_db), auth: AuthContext = Depends(get_auth)):
    return _meta(await _load(attachment_id, auth, db))


@router.get("/{attachment_id}/content")
async def get_attachment_content(attachment_id: uuid.UUID, db: AsyncSession = Depends(get_db), auth: AuthContext = Depends(get_auth)):
    """Serve the raw bytes — used by the UI to render images inline or download."""
    att = await _load(attachment_id, auth, db)
    if not att.blob_path or not os.path.isfile(att.blob_path):
        raise HTTPException(status_code=404, detail="Attachment file missing")
    return FileResponse(att.blob_path, media_type=att.mime_type or "application/octet-stream",
                        filename=att.filename, content_disposition_type="inline")


@router.get("/{attachment_id}/data")
async def get_attachment_data(attachment_id: uuid.UUID, db: AsyncSession = Depends(get_db), auth: AuthContext = Depends(get_auth)):
    """Return the attachment as base64 — for agents to reconstruct & parse themselves."""
    att = await _load(attachment_id, auth, db)
    if not att.blob_path or not os.path.isfile(att.blob_path):
        raise HTTPException(status_code=404, detail="Attachment file missing")
    size = os.path.getsize(att.blob_path)
    if size > MAX_INLINE_BYTES:
        raise HTTPException(status_code=413, detail=f"Attachment too large to inline ({size} bytes); use /content")
    with open(att.blob_path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("ascii")
    return {
        "id": str(att.id), "filename": att.filename, "mime_type": att.mime_type,
        "size_bytes": att.size_bytes, "encoding": "base64", "data": encoded,
    }
