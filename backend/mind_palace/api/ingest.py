import uuid
import hashlib
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mind_palace.database import get_db
from mind_palace.config import settings
from mind_palace.models.object import MPObject, ObjectType, IngestionStatus
from mind_palace.models.collection import Collection
from mind_palace.models.ingestion_task import IngestionTask
from mind_palace.schemas.ingestion import IngestAccepted
from mind_palace.auth.middleware import AuthContext, get_auth, assert_collection_access
from mind_palace.services.markitdown_svc import save_blob

router = APIRouter(prefix="/api/v1/ingest", tags=["ingestion"])


@router.post("", status_code=202)
async def ingest_file(
    file: UploadFile = File(...),
    object_type: str = Form(default="kb_entry"),
    collection_id: Optional[uuid.UUID] = Form(default=None),
    subject: Optional[str] = Form(default=None),
    importance: int = Form(default=1),
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    """Accept an upload and enqueue it for background processing.

    Fire-and-forget: the file is saved, a queued task is created, and we return
    immediately (202). The supervised worker loop picks the task up and runs the
    full pipeline. Progress is observable on the Tasks page — the client never
    has to wait, and can navigate away freely.
    """
    try:
        obj_type = ObjectType(object_type)
    except ValueError:
        obj_type = ObjectType.kb_entry

    if collection_id:
        coll_result = await db.execute(select(Collection).where(Collection.id == collection_id))
        collection = coll_result.scalar_one_or_none()
        if not collection:
            raise HTTPException(status_code=404, detail="Collection not found")
        await assert_collection_access(collection, auth, db)

    data = await file.read()
    sha256 = hashlib.sha256(data).hexdigest()
    mode_level = settings.mode_level

    # Hash deduplication — an identical file already ingested is skipped (returns
    # the existing entry) rather than creating a duplicate document.
    dup = (await db.execute(
        select(MPObject).where(MPObject.metadata_.contains({"sha256": sha256})).limit(1)
    )).scalar_one_or_none()
    if dup:
        return IngestAccepted(
            object_id=dup.id, status="duplicate",
            message=f"Identical file already ingested as “{dup.subject}” — skipped.",
        )

    obj = MPObject(
        type=obj_type,
        subject=subject or file.filename or "Untitled",
        content="",
        collection_id=collection_id,
        contributor_id=auth.agent_id or str(auth.user_id),
        status=IngestionStatus.queued,
        importance=importance,
        metadata_={
            "sha256": sha256,
            "original_filename": file.filename,
            "mime_type": file.content_type or "",
        },
    )
    db.add(obj)
    await db.flush()

    blob_path = save_blob(data, auth.user_id, collection_id, obj.id, file.filename)
    obj.raw_file_path = blob_path

    task = IngestionTask(object_id=obj.id, task_type="document", mode_level=mode_level)
    db.add(task)
    await db.commit()
    await db.refresh(task)

    return IngestAccepted(
        task_id=task.id, object_id=obj.id,
        status="queued", message="Upload accepted — processing in the background",
    )
