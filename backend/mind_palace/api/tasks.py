"""Background task tracking — document ingestion + memory processing.

Surfaces the execution history of every background step (parse, embed, entity
extraction, automated edge creation, …) so it can be inspected in the UI.
"""
import uuid
import math
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from mind_palace.database import get_db
from mind_palace.models.object import MPObject
from mind_palace.models.ingestion_task import IngestionTask, IngestionStep
from mind_palace.models.ingestion_event import IngestionEvent
from mind_palace.auth.middleware import AuthContext, get_auth

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])


def _event_dict(e: IngestionEvent) -> dict:
    return {
        "id": str(e.id),
        "step": e.step.value if hasattr(e.step, "value") else e.step,
        "status": e.status.value if hasattr(e.status, "value") else e.status,
        "detail": e.detail,
        "metadata": e.metadata_ or {},
        "created_at": e.ts.isoformat(),
    }


def _label_subject(task, subject) -> str:
    """Readable label: the object's subject, a maintenance-job name, or a clear
    'deleted' marker — never just the bare task type."""
    if task.object_id:
        return subject or "(untitled)"
    return {
        "reindex": "Graph reindex",
        "proactive_link": "Proactive edge pass",
        "decay": "Importance decay",
    }.get(task.task_type, "(deleted entry)")


@router.get("")
async def list_tasks(
    status: Optional[str] = None,
    task_type: Optional[str] = None,
    archived: bool = Query(default=False),  # include archived tasks
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = Depends(get_auth),
):
    conditions = []
    if status:
        conditions.append(IngestionTask.status == status)
    if task_type:
        # accept a single type or a comma-separated group (e.g. ingestion vs core)
        types = [t.strip() for t in task_type.split(",") if t.strip()]
        conditions.append(IngestionTask.task_type.in_(types) if len(types) > 1
                          else IngestionTask.task_type == types[0])
    if archived:
        conditions.append(IngestionTask.archived_at.is_not(None))
    else:
        conditions.append(IngestionTask.archived_at.is_(None))

    where = conditions if conditions else [True]
    total = (await db.execute(select(func.count(IngestionTask.id)).where(*where))).scalar() or 0

    rows = (await db.execute(
        select(IngestionTask, MPObject.subject, MPObject.type)
        .outerjoin(MPObject, MPObject.id == IngestionTask.object_id)
        .where(*where)
        .order_by(IngestionTask.created_at.desc())
        .limit(page_size).offset((page - 1) * page_size)
    )).all()

    items = []
    for task, subject, otype in rows:
        items.append({
            "id": str(task.id),
            "task_type": task.task_type,
            "params": task.params or {},
            "object_id": str(task.object_id) if task.object_id else None,
            "object_subject": _label_subject(task, subject),
            "object_type": otype.value if otype else None,
            "status": task.status.value if hasattr(task.status, "value") else task.status,
            "current_step": task.current_step.value if task.current_step else None,
            "mode_level": task.mode_level,
            "progress_percentage": task.progress_percentage,
            "error_message": task.error_message,
            "archived_at": task.archived_at.isoformat() if task.archived_at else None,
            "created_at": task.created_at.isoformat(),
            "updated_at": task.updated_at.isoformat(),
        })

    return {
        "items": items, "total": total, "page": page,
        "page_size": page_size, "pages": max(1, math.ceil(total / page_size)),
    }


@router.post("/{task_id}/archive")
async def archive_task(task_id: uuid.UUID, db: AsyncSession = Depends(get_db), auth: AuthContext = Depends(get_auth)):
    from datetime import datetime, timezone
    task = (await db.execute(select(IngestionTask).where(IngestionTask.id == task_id))).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404)
    task.archived_at = None if task.archived_at else datetime.now(timezone.utc)
    await db.commit()
    return {"id": str(task_id), "archived": task.archived_at is not None}


@router.get("/stats")
async def task_stats(db: AsyncSession = Depends(get_db), auth: AuthContext = Depends(get_auth)):
    # Count only active (non-archived) tasks so the dashboard numbers match the list.
    rows = (await db.execute(
        select(IngestionTask.status, func.count(IngestionTask.id))
        .where(IngestionTask.archived_at.is_(None))
        .group_by(IngestionTask.status)
    )).all()
    by_status = {(s.value if hasattr(s, "value") else s): c for s, c in rows}
    total = sum(by_status.values())
    # Live count of distinct graph edges — NOT a cumulative sum of autolink events.
    # (autolink uses idempotent MERGE, so summing per-run "edges_created" double-counts
    #  every re-run/optimize/daily pass and grows forever while the graph stays small.)
    from mind_palace.services import graph_svc
    try:
        edges = len(await graph_svc.get_all_object_edges(db))
    except Exception:
        edges = 0
    return {"by_status": by_status, "total": total, "total_edges_created": edges, "graph_edges": edges}


@router.get("/{task_id}")
async def get_task(task_id: uuid.UUID, db: AsyncSession = Depends(get_db), auth: AuthContext = Depends(get_auth)):
    task = (await db.execute(select(IngestionTask).where(IngestionTask.id == task_id))).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404)
    subject = None
    if task.object_id:
        subject = (await db.execute(select(MPObject.subject).where(MPObject.id == task.object_id))).scalar_one_or_none()
    events = (await db.execute(
        select(IngestionEvent).where(IngestionEvent.task_id == task_id).order_by(IngestionEvent.ts)
    )).scalars().all()
    return {
        "id": str(task.id),
        "task_type": task.task_type,
        "params": task.params or {},
        "object_id": str(task.object_id) if task.object_id else None,
        "object_subject": _label_subject(task, subject),
        "status": task.status.value if hasattr(task.status, "value") else task.status,
        "current_step": task.current_step.value if task.current_step else None,
        "mode_level": task.mode_level,
        "progress_percentage": task.progress_percentage,
        "error_message": task.error_message,
        "archived_at": task.archived_at.isoformat() if task.archived_at else None,
        "created_at": task.created_at.isoformat(),
        "updated_at": task.updated_at.isoformat(),
        "events": [_event_dict(e) for e in events],
    }
