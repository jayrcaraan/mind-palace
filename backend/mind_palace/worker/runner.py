"""Background worker: processes tasks and runs scheduled maintenance.

Per-object pipeline (each step recorded as an observable event):
  document → parse · vision · embed · ner · autolink · index
  memory   →                 embed · ner · autolink · index
  optimize →                 embed · ner · autolink · index   (phase-2 re-run)

Bulk / scheduled tasks:
  reindex        → rebuild shared-entity RELATES_TO edges (additive or full)
  proactive_link → scheduled additive reindex (daily)
  decay          → scheduled importance decay (daily)

Steps are gated by deployment mode (embed ≥ standard, vision/LLM-ner = advanced);
`autolink` always runs and records exactly which edges it created.
"""
import os
import re
import asyncio
import uuid
import logging
from datetime import datetime, timedelta, timezone

_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".svg"}


def _is_image_name(name: str) -> bool:
    return os.path.splitext(name or "")[1].lower() in _IMAGE_EXTS

from sqlalchemy import select, update, delete as sa_delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from mind_palace.database import AsyncSessionLocal
from mind_palace.models.object import MPObject, IngestionStatus
from mind_palace.models.ingestion_task import IngestionTask, IngestionStep
from mind_palace.models.ingestion_event import IngestionEvent, StepStatus
from mind_palace.models.entity import Entity, ObjectEntity
from mind_palace.config import settings

log = logging.getLogger(__name__)

DECAY_AFTER_DAYS = 7       # decay importance after this many idle days
ARCHIVE_AFTER_DAYS = 7     # auto-archive terminal tasks older than this
STUCK_AFTER = timedelta(minutes=15)  # a task 'running' longer than this is dead
DAILY = timedelta(hours=24)


async def emit(db, task_id, step, status, detail=None, metadata=None) -> IngestionEvent:
    event = IngestionEvent(
        task_id=task_id, step=step, status=status,
        detail=detail, metadata_=metadata or {}, ts=datetime.utcnow(),
    )
    db.add(event)
    await db.execute(
        update(IngestionTask).where(IngestionTask.id == task_id)
        .values(current_step=step, updated_at=datetime.utcnow())
    )
    await db.commit()
    await db.refresh(event)
    return event


async def _object_entity_ids(db: AsyncSession, object_id: uuid.UUID) -> list:
    rows = await db.execute(select(ObjectEntity.entity_id).where(ObjectEntity.object_id == object_id))
    return [r[0] for r in rows.all()]


# ─────────────────────────────────────────────────────────────────────────────
# Dispatcher
# ─────────────────────────────────────────────────────────────────────────────
async def run_pipeline(task: IngestionTask, db: AsyncSession) -> None:
    task_type = task.task_type or "document"
    try:
        if task_type in ("reindex", "proactive_link"):
            await _run_bulk_link(task, db)
        elif task_type == "decay":
            await _run_decay(task, db)
        else:
            await _run_object_pipeline(task, db)
    except Exception as exc:
        log.error("Task %s (%s) failed: %s", task.id, task_type, exc, exc_info=True)
        await db.rollback()
        async with AsyncSessionLocal() as fresh:
            await fresh.execute(
                update(IngestionTask).where(IngestionTask.id == task.id)
                .values(status=IngestionStatus.failed, error_message=str(exc), updated_at=datetime.utcnow())
            )
            await fresh.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Per-object enrichment pipeline (document / memory / optimize)
# ─────────────────────────────────────────────────────────────────────────────
async def _run_object_pipeline(task: IngestionTask, db: AsyncSession) -> None:
    task_id = task.id
    mode_level = task.mode_level
    object_id = task.object_id
    task_type = task.task_type or "document"
    # `optimize` re-runs phase 2 only — content already exists, skip parse/vision.
    do_extraction = task_type == "document"

    await db.execute(
        update(IngestionTask).where(IngestionTask.id == task_id)
        .values(status=IngestionStatus.running, updated_at=datetime.utcnow())
    )
    await db.commit()

    obj = (await db.execute(select(MPObject).where(MPObject.id == object_id))).scalar_one_or_none()
    if not obj:
        raise ValueError(f"Object {object_id} not found")

    images = []
    step_errors: list[str] = []  # surfaced loudly at the end — never fail silently

    # ── parse (documents only) ───────────────────────────────────────────────
    if do_extraction:
        await emit(db, task_id, IngestionStep.parse, StepStatus.running, "Parsing document via MarkItDown")
        if obj.raw_file_path:
            try:
                from mind_palace.services.markitdown_svc import parse_file
                # Run the (blocking) parser in a thread with a timeout so a
                # problematic document can't hang the worker / event loop forever.
                parsed = await asyncio.wait_for(
                    asyncio.to_thread(parse_file, obj.raw_file_path),
                    timeout=settings.parse_timeout,
                )
                content = parsed.text or obj.content or ""
                images = parsed.images
                # Preserve every image as an attachment in ALL modes, so nothing is
                # lost when vision/OCR doesn't run (light/standard). Agents can pull
                # these and parse them themselves.
                ids = await _save_image_attachments(db, obj, images)
                # Swap the positioned <<image:N>> placeholders for real attachment
                # tokens so the frontend renders each image exactly where it appeared.
                for idx, att_id in enumerate(ids):
                    content = content.replace(f"<<image:{idx}>>", f"<<attachment:{att_id}>>" if att_id else "")
                content = re.sub(r"<<image:\d+>>", "", content)  # drop any stragglers
                saved = sum(1 for a in ids if a)
                # If the upload IS an image (and wasn't decomposed), keep it inline too.
                meta = obj.metadata_ or {}
                raw_mime = (meta.get("mime_type") or "")
                fname = meta.get("original_filename") or os.path.basename(obj.raw_file_path)
                if not images and (raw_mime.startswith("image/") or _is_image_name(fname)):
                    rid = await _save_raw_as_attachment(db, obj, fname, raw_mime or "image/*")
                    if rid:
                        content = content.rstrip() + f"\n\n<<attachment:{rid}>>"
                        saved += 1
                obj.content = content
                await db.commit()
                await emit(db, task_id, IngestionStep.parse, StepStatus.completed,
                           f"{len(parsed.text)} chars extracted, {saved} image attachment(s) saved",
                           {"char_count": len(parsed.text), "attachment_count": saved})
            except (asyncio.TimeoutError, TimeoutError):
                await db.rollback()
                msg = f"Parsing timed out after {settings.parse_timeout:.0f}s — document too large/complex or malformed."
                await emit(db, task_id, IngestionStep.parse, StepStatus.failed, msg)
                raise RuntimeError(msg)
            except Exception as e:
                await emit(db, task_id, IngestionStep.parse, StepStatus.failed, str(e)); raise
        else:
            await emit(db, task_id, IngestionStep.parse, StepStatus.skipped, "No raw file — using text content")

        # ── vision (advanced) — describe the saved image attachments ──────────
        from mind_palace.models.attachment import Attachment
        img_atts = [
            a for a in (await db.execute(select(Attachment).where(Attachment.object_id == obj.id))).scalars().all()
            if (a.mime_type or "").startswith("image") and not a.parsed_content
        ]
        if mode_level >= 3 and img_atts:
            await emit(db, task_id, IngestionStep.vision, StepStatus.running,
                       f"Describing {len(img_atts)} image(s) via {settings.ocr_model}")
            from mind_palace.services.inference import describe_image
            descriptions, vision_errs = [], []
            for a in img_atts:
                try:
                    desc = await describe_image(a.blob_path)
                    a.parsed_content = desc
                    descriptions.append(f"\n\n<!-- Image: {a.filename} -->\n{desc}")
                except Exception as e:
                    vision_errs.append(str(e))
                    log.warning("vision failed for %s: %s", a.filename, e)
            await db.commit()
            if descriptions:
                obj.content += "\n\n---\n## Extracted Image Content\n" + "\n".join(descriptions)
                await db.commit()
            if vision_errs and not descriptions:
                err = f"OCR failed for all {len(img_atts)} image(s): {vision_errs[0]}"
                step_errors.append(err)
                await emit(db, task_id, IngestionStep.vision, StepStatus.failed, err, {"errors": vision_errs})
            elif vision_errs:
                await emit(db, task_id, IngestionStep.vision, StepStatus.completed,
                           f"{len(descriptions)} described, {len(vision_errs)} failed: {vision_errs[0]}",
                           {"image_count": len(img_atts), "errors": vision_errs})
            else:
                await emit(db, task_id, IngestionStep.vision, StepStatus.completed,
                           f"{len(img_atts)} image(s) described", {"image_count": len(img_atts)})
        elif img_atts:
            await emit(db, task_id, IngestionStep.vision, StepStatus.skipped,
                       f"{len(img_atts)} image(s) kept as attachments — no OCR in light/standard mode")
        else:
            await emit(db, task_id, IngestionStep.vision, StepStatus.skipped, "No images")

    # ── embed (standard+) ────────────────────────────────────────────────────
    if mode_level >= 2:
        await emit(db, task_id, IngestionStep.embed, StepStatus.running, "Chunking & embedding content")
        try:
            from mind_palace.services.markitdown_svc import chunk_text
            from mind_palace.services.inference import embed_batch
            from mind_palace.models.chunk import ObjectChunk
            # Chunk the clean text — strip inline attachment tokens so embeddings
            # and search aren't polluted by UUIDs.
            clean = re.sub(r"<<attachment:[0-9a-fA-F-]{36}>>", "", obj.content or "").strip()
            chunks = chunk_text(clean)
            if chunks:
                embeddings = await embed_batch([f"search_document: {c['content']}" for c in chunks])
                await db.execute(sa_delete(ObjectChunk).where(ObjectChunk.object_id == obj.id))
                for c, emb in zip(chunks, embeddings):
                    db.add(ObjectChunk(object_id=obj.id, chunk_index=c["chunk_index"],
                                       content=c["content"], embedding=emb, metadata_=c["metadata"]))
                await db.commit()
            await emit(db, task_id, IngestionStep.embed, StepStatus.completed,
                       f"{len(chunks)} chunks embedded", {"chunk_count": len(chunks)})
        except Exception as e:
            # Surface loudly but keep going so the object isn't lost (it just won't
            # have vector search until re-run via Optimize once the model is fixed).
            await db.rollback()
            step_errors.append(f"embed: {e}")
            await emit(db, task_id, IngestionStep.embed, StepStatus.failed, str(e))
            log.warning("embed failed for %s: %s", obj.id, e)
    else:
        await emit(db, task_id, IngestionStep.embed, StepStatus.skipped, "Light mode — no embeddings")

    # ── ner ──────────────────────────────────────────────────────────────────
    if mode_level >= 3:
        await emit(db, task_id, IngestionStep.ner, StepStatus.running, "Extracting entities via LLM")
        try:
            from mind_palace.services.inference import extract_entities
            raw = await extract_entities(obj.content)
            added = await _merge_entities(db, obj.id, [(e.get("name", ""), e.get("type", "concept")) for e in raw])
            await emit(db, task_id, IngestionStep.ner, StepStatus.completed,
                       f"{added} new entities extracted", {"entity_count": added})
        except Exception as e:
            await db.rollback()
            step_errors.append(f"ner: {e}")
            await emit(db, task_id, IngestionStep.ner, StepStatus.failed, str(e))
            log.warning("LLM entity extraction failed for %s: %s", obj.id, e)
    elif task_type in ("document", "optimize"):
        # No LLM — fast regex extraction so the graph still fills in light/standard.
        await emit(db, task_id, IngestionStep.ner, StepStatus.running, "Extracting entities (regex)")
        try:
            from mind_palace.services.inference import regex_extract_entities
            added = await _merge_entities(db, obj.id, [(e.get("name", ""), e.get("type", "concept")) for e in regex_extract_entities(obj.content)])
            await emit(db, task_id, IngestionStep.ner, StepStatus.completed,
                       f"{added} new entities extracted", {"entity_count": added})
        except Exception as e:
            await emit(db, task_id, IngestionStep.ner, StepStatus.failed, str(e)); raise
    else:
        await emit(db, task_id, IngestionStep.ner, StepStatus.skipped, "Client-supplied entities only")

    # ── autolink ─────────────────────────────────────────────────────────────
    await emit(db, task_id, IngestionStep.autolink, StepStatus.running, "Building knowledge-graph edges")
    try:
        await _sync_object_graph(db, obj)
        entity_ids = await _object_entity_ids(db, obj.id)
        from mind_palace.services import graph_svc
        linked_ids = await graph_svc.auto_link_by_shared_entities(db, obj.id, entity_ids)
        targets = await _resolve_subjects(db, linked_ids)
        ent_count = len(entity_ids)
        await emit(db, task_id, IngestionStep.autolink, StepStatus.completed,
                   f"{ent_count} entities, {len(linked_ids)} edge(s) created",
                   {"entity_count": ent_count, "edges_created": len(linked_ids), "linked": targets})
    except Exception as e:
        await emit(db, task_id, IngestionStep.autolink, StepStatus.failed, str(e))
        log.warning("autolink failed for %s: %s", obj.id, e)

    # ── index ────────────────────────────────────────────────────────────────
    await emit(db, task_id, IngestionStep.index, StepStatus.running, "Finalizing")
    obj.status = IngestionStatus.completed
    await db.commit()
    await emit(db, task_id, IngestionStep.index, StepStatus.completed, "Done")

    # Never finish silently: if any enrichment step errored, the TASK is marked
    # failed (red in the list) with the reason — even though the object is saved.
    if step_errors:
        summary = " · ".join(step_errors)[:1000]
        await db.execute(
            update(IngestionTask).where(IngestionTask.id == task_id)
            .values(status=IngestionStatus.failed, error_message=summary,
                    progress_percentage=100, updated_at=datetime.utcnow())
        )
        await db.commit()
        log.error("Task %s (%s) completed WITH ERRORS: %s", task_id, task_type, summary)
    else:
        await db.execute(
            update(IngestionTask).where(IngestionTask.id == task_id)
            .values(status=IngestionStatus.completed, progress_percentage=100, updated_at=datetime.utcnow())
        )
        await db.commit()
        log.info("Task %s (%s) completed for object %s", task_id, task_type, object_id)


async def _save_image_attachments(db: AsyncSession, obj: MPObject, images: list) -> list:
    """Persist every extracted image as an Attachment (no description). All modes.
    Returns a list of attachment-id strings aligned to `images` (None on failure)."""
    from mind_palace.models.attachment import Attachment
    from mind_palace.services.markitdown_svc import save_attachment_blob
    ids: list = []
    for img in images:
        try:
            att_id = uuid.uuid4()
            with open(img["path"], "rb") as f:
                data = f.read()
            blob = save_attachment_blob(data, obj.contributor_id, obj.id, att_id, img["filename"])
            db.add(Attachment(id=att_id, object_id=obj.id, filename=img["filename"],
                              mime_type=img.get("mime_type", "image/jpeg"),
                              size_bytes=img.get("size", len(data)), blob_path=blob))
            ids.append(str(att_id))
        except Exception as e:
            log.warning("could not save image attachment %s: %s", img.get("filename"), e)
            ids.append(None)
    if any(ids):
        await db.commit()
    return ids


async def _save_raw_as_attachment(db: AsyncSession, obj: MPObject, filename: str, mime: str):
    """Save the object's raw uploaded file as an attachment (used for image uploads).
    Returns the attachment-id string, or None on failure."""
    from mind_palace.models.attachment import Attachment
    from mind_palace.services.markitdown_svc import save_attachment_blob
    try:
        with open(obj.raw_file_path, "rb") as f:
            data = f.read()
        att_id = uuid.uuid4()
        blob = save_attachment_blob(data, obj.contributor_id, obj.id, att_id, filename)
        db.add(Attachment(id=att_id, object_id=obj.id, filename=filename,
                          mime_type=mime, size_bytes=len(data), blob_path=blob))
        await db.commit()
        return str(att_id)
    except Exception as e:
        log.warning("could not save raw file as attachment for %s: %s", obj.id, e)
        return None


async def _merge_entities(db: AsyncSession, object_id: uuid.UUID, pairs: list) -> int:
    """Upsert (name,type) entities and link them to the object. Returns # newly linked."""
    added = 0
    for name, etype in pairs:
        name = (name or "").strip()
        etype = (etype or "concept").strip() or "concept"
        if not name:
            continue
        entity = (await db.execute(
            select(Entity).where(Entity.name == name, Entity.type == etype)
        )).scalar_one_or_none()
        if not entity:
            entity = Entity(name=name, type=etype); db.add(entity); await db.flush()
        exists = (await db.execute(select(ObjectEntity).where(
            ObjectEntity.object_id == object_id, ObjectEntity.entity_id == entity.id))).scalar_one_or_none()
        if not exists:
            db.add(ObjectEntity(object_id=object_id, entity_id=entity.id)); added += 1
    await db.commit()
    return added


async def _sync_object_graph(db: AsyncSession, obj: MPObject) -> None:
    """Ensure the object vertex, its collection link, and entity vertices/links exist."""
    from mind_palace.services import graph_svc
    entity_ids = await _object_entity_ids(db, obj.id)
    await graph_svc.ensure_object_vertex(db, obj.id, obj.type.value, obj.contributor_id)
    if obj.collection_id:
        await graph_svc.link_object_to_collection(db, obj.id, obj.collection_id)
    ent_rows = (await db.execute(select(Entity).where(Entity.id.in_(entity_ids)))).scalars().all() if entity_ids else []
    for e in ent_rows:
        await graph_svc.ensure_entity_vertex(db, e.id, e.name, e.type)
        await graph_svc.link_object_to_entity(db, obj.id, e.id)


async def _resolve_subjects(db: AsyncSession, ids: list[str]) -> list[dict]:
    tid = [uuid.UUID(x) for x in ids if _is_uuid(x)]
    if not tid:
        return []
    rows = (await db.execute(select(MPObject.id, MPObject.subject).where(MPObject.id.in_(tid)))).all()
    return [{"id": str(r[0]), "subject": r[1]} for r in rows]


# ─────────────────────────────────────────────────────────────────────────────
# Bulk shared-entity edge (re)build — reindex / proactive_link
# ─────────────────────────────────────────────────────────────────────────────
async def _run_bulk_link(task: IngestionTask, db: AsyncSession) -> None:
    task_id = task.id
    full = (task.params or {}).get("mode") == "full"
    from mind_palace.services import graph_svc

    await db.execute(
        update(IngestionTask).where(IngestionTask.id == task_id)
        .values(status=IngestionStatus.running, updated_at=datetime.utcnow())
    )
    await db.commit()

    mode_label = "full reindex" if full else "additive pass"
    await emit(db, task_id, IngestionStep.autolink, StepStatus.running, f"Starting {mode_label}")

    cleared = 0
    if full:
        cleared = await graph_svc.clear_all_relates_to(db)

    objs = (await db.execute(select(MPObject.id))).scalars().all()
    total = len(objs)
    total_edges = 0
    scanned = 0
    for oid in objs:
        obj = (await db.execute(select(MPObject).where(MPObject.id == oid))).scalar_one_or_none()
        if not obj:
            continue
        await _sync_object_graph(db, obj)
        entity_ids = await _object_entity_ids(db, oid)
        linked = await graph_svc.auto_link_by_shared_entities(db, oid, entity_ids)
        total_edges += len(linked)
        scanned += 1
        if total and scanned % 10 == 0:
            await db.execute(
                update(IngestionTask).where(IngestionTask.id == task_id)
                .values(progress_percentage=int(scanned / total * 100), updated_at=datetime.utcnow())
            )
            await db.commit()

    await db.execute(
        update(IngestionTask).where(IngestionTask.id == task_id)
        .values(status=IngestionStatus.completed, progress_percentage=100, updated_at=datetime.utcnow())
    )
    await db.commit()
    detail = f"{scanned} objects scanned, {total_edges} edge(s) created"
    if full:
        detail = f"cleared {cleared} old edges · " + detail
    await emit(db, task_id, IngestionStep.autolink, StepStatus.completed, detail,
               {"objects_scanned": scanned, "edges_created": total_edges, "mode": "full" if full else "additive"})
    log.info("Bulk link task %s done: %s", task_id, detail)


# ─────────────────────────────────────────────────────────────────────────────
# Importance decay (daily)
# ─────────────────────────────────────────────────────────────────────────────
async def _run_decay(task: IngestionTask, db: AsyncSession) -> None:
    task_id = task.id
    await db.execute(
        update(IngestionTask).where(IngestionTask.id == task_id)
        .values(status=IngestionStatus.running, updated_at=datetime.utcnow())
    )
    await db.commit()
    await emit(db, task_id, IngestionStep.decay, StepStatus.running,
               f"Decaying importance for items idle ≥{DECAY_AFTER_DAYS}d (pinned exempt)")

    # SET LOCAL mp.skip_touch keeps updated_at stable so decayed items don't
    # masquerade as freshly-edited. Floor is enforced by importance > 1.
    conn = await db.connection()
    await conn.exec_driver_sql("SET LOCAL mp.skip_touch = 'on'")
    res = await conn.exec_driver_sql(f"""
        UPDATE objects
        SET importance = importance - 1, importance_updated_at = now()
        WHERE is_pinned = false
          AND importance > 1
          AND importance_updated_at < now() - interval '{DECAY_AFTER_DAYS} days'
        RETURNING id
    """)
    decayed = len(res.fetchall())
    await db.commit()

    await db.execute(
        update(IngestionTask).where(IngestionTask.id == task_id)
        .values(status=IngestionStatus.completed, progress_percentage=100, updated_at=datetime.utcnow())
    )
    await db.commit()
    await emit(db, task_id, IngestionStep.decay, StepStatus.completed,
               f"{decayed} item(s) decayed", {"decayed": decayed})
    log.info("Decay task %s done: %d items decayed", task_id, decayed)


def _is_uuid(s: str) -> bool:
    try:
        uuid.UUID(s); return True
    except (ValueError, TypeError):
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Worker loop
# ─────────────────────────────────────────────────────────────────────────────
async def _reconcile_orphans() -> None:
    """On startup, re-queue tasks left 'running' by a previous (now-dead) process.
    A single worker owns processing, so any 'running' task at boot is orphaned."""
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            update(IngestionTask)
            .where(IngestionTask.status == IngestionStatus.running)
            .values(status=IngestionStatus.queued, current_step=None, error_message=None)
            .returning(IngestionTask.id)
        )
        ids = res.fetchall()
        await db.commit()
        if ids:
            log.warning("Re-queued %d orphaned running task(s) after restart", len(ids))


async def worker_loop() -> None:
    log.info("Background worker started")
    await _reconcile_orphans()
    while True:
        try:
            async with AsyncSessionLocal() as db:
                task = (await db.execute(
                    select(IngestionTask)
                    .where(IngestionTask.status == IngestionStatus.queued)
                    .order_by(IngestionTask.created_at)
                    .limit(1).with_for_update(skip_locked=True)
                )).scalar_one_or_none()
                if task:
                    log.info("Picked up task %s (%s)", task.id, task.task_type)
                    await run_pipeline(task, db)
                else:
                    await asyncio.sleep(settings.worker_poll_interval_seconds)
        except Exception as e:
            log.error("Worker loop error: %s", e, exc_info=True)
            await asyncio.sleep(5)


# ─────────────────────────────────────────────────────────────────────────────
# Scheduler loop — enqueues daily decay + proactive_link, auto-archives old tasks
# ─────────────────────────────────────────────────────────────────────────────
async def _recent_task_exists(db: AsyncSession, task_type: str, within: timedelta) -> bool:
    cutoff = datetime.now(timezone.utc) - within
    row = (await db.execute(
        select(func.count(IngestionTask.id))
        .where(IngestionTask.task_type == task_type, IngestionTask.created_at >= cutoff)
    )).scalar() or 0
    return row > 0


async def _auto_archive(db: AsyncSession) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=ARCHIVE_AFTER_DAYS)
    res = await db.execute(
        update(IngestionTask)
        .where(
            IngestionTask.archived_at.is_(None),
            IngestionTask.status.in_([IngestionStatus.completed, IngestionStatus.failed]),
            IngestionTask.updated_at < cutoff,
        )
        .values(archived_at=datetime.utcnow())
        .returning(IngestionTask.id)
    )
    n = len(res.fetchall())
    await db.commit()
    return n


async def _fail_stuck(db: AsyncSession) -> int:
    """Mark tasks 'running' for too long as failed — a watchdog for tasks that
    wedged while the worker was alive (the startup reconcile only catches restarts)."""
    cutoff = datetime.now(timezone.utc) - STUCK_AFTER
    res = await db.execute(
        update(IngestionTask)
        .where(IngestionTask.status == IngestionStatus.running, IngestionTask.updated_at < cutoff)
        .values(status=IngestionStatus.failed,
                error_message="Timed out — task ran too long and was marked failed.",
                updated_at=datetime.utcnow())
        .returning(IngestionTask.id)
    )
    n = len(res.fetchall())
    await db.commit()
    return n


async def scheduler_loop() -> None:
    log.info("Scheduler started (daily decay + proactive edge pass + auto-archive + stuck watchdog)")
    # Small startup delay so the app is fully up before the first tick.
    await asyncio.sleep(30)
    while True:
        try:
            async with AsyncSessionLocal() as db:
                stuck = await _fail_stuck(db)
                if stuck:
                    log.warning("Watchdog failed %d stuck running task(s)", stuck)
                if not await _recent_task_exists(db, "decay", DAILY):
                    db.add(IngestionTask(task_type="decay", object_id=None, mode_level=settings.mode_level))
                    await db.commit()
                    log.info("Scheduled daily importance-decay task")
                if not await _recent_task_exists(db, "proactive_link", DAILY):
                    db.add(IngestionTask(task_type="proactive_link", object_id=None,
                                         mode_level=settings.mode_level, params={"mode": "additive"}))
                    await db.commit()
                    log.info("Scheduled daily proactive edge-creation task")
                archived = await _auto_archive(db)
                if archived:
                    log.info("Auto-archived %d old terminal task(s)", archived)
        except Exception as e:
            log.error("Scheduler error: %s", e, exc_info=True)
        # Tick every 5 min: fast enough for the stuck watchdog; daily jobs are
        # still gated to once/24h via _recent_task_exists.
        await asyncio.sleep(300)
