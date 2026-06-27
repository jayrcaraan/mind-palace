import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.exceptions import RequestValidationError

from mind_palace.config import settings
from mind_palace.database import db_healthcheck
from mind_palace.middleware import RequestContextMiddleware, SecurityHeadersMiddleware
from mind_palace.api import collections, objects, links, ingest, proposals, search, agents, entities, tasks, graph, attachments

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger(__name__)


# ── MCP over HTTP (Streamable HTTP transport, mounted at /mcp) ────────────────
_mcp_manager = None
try:
    from mind_palace.mcp.server import server as _mcp_server, set_request_token
    from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
    _mcp_manager = StreamableHTTPSessionManager(app=_mcp_server, stateless=True, json_response=False)
    log.info("MCP HTTP transport enabled at /mcp")
except Exception as e:  # pragma: no cover
    log.warning("MCP HTTP transport disabled: %s", e)


# ─────────────────────────────────────────────────────────────────────────────
# Background worker supervisor — restarts the ingestion worker if it ever crashes
# ─────────────────────────────────────────────────────────────────────────────
async def _supervise(coro_factory, name: str):
    """Run a long-lived background loop, restarting it with backoff if it crashes."""
    backoff = 1
    while True:
        try:
            await coro_factory()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("%s crashed — restarting in %ds", name, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)
        else:
            await asyncio.sleep(1)
            backoff = 1


async def _worker_supervisor():
    from mind_palace.worker.runner import worker_loop
    await _supervise(worker_loop, "Ingestion worker")


async def _scheduler_supervisor():
    from mind_palace.worker.runner import scheduler_loop
    await _supervise(scheduler_loop, "Scheduler")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Mind Palace v2 starting — env=%s mode=%s", settings.environment, settings.deployment_mode)
    if not await db_healthcheck():
        log.warning("Database not reachable at startup — will keep retrying via pool_pre_ping")

    worker_task = asyncio.create_task(_worker_supervisor())
    scheduler_task = asyncio.create_task(_scheduler_supervisor())
    if _mcp_manager is not None:
        async with _mcp_manager.run():
            yield
    else:
        yield
    for t in (worker_task, scheduler_task):
        t.cancel()
        try:
            await t
        except asyncio.CancelledError:
            pass
    log.info("Mind Palace v2 shut down")


app = FastAPI(
    title="Mind Palace",
    description="Unified Cognitive Memory & Knowledge Management Service",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.enable_docs else None,
    redoc_url="/redoc" if settings.enable_docs else None,
    openapi_url="/openapi.json" if settings.enable_docs else None,
)

# ── Middleware (order matters: outermost first) ──────────────────────────────
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestContextMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID", "X-Response-Time"],
)


# ── Global exception handlers — structured JSON, no stack-trace leakage ───────
@app.exception_handler(RequestValidationError)
async def _validation_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"detail": "Validation error", "errors": exc.errors()})


@app.exception_handler(Exception)
async def _unhandled_handler(request: Request, exc: Exception):
    rid = getattr(request.state, "request_id", None)
    log.exception("Unhandled error on %s %s [%s]", request.method, request.url.path, rid)
    detail = str(exc) if settings.debug else "Internal server error"
    return JSONResponse(status_code=500, content={"detail": detail, "request_id": rid})


# ── API routers ──────────────────────────────────────────────────────────────
app.include_router(collections.router)
app.include_router(objects.router)
app.include_router(links.router)
app.include_router(ingest.router)
app.include_router(proposals.router)
app.include_router(search.router)
app.include_router(agents.router)
app.include_router(entities.router)
app.include_router(tasks.router)
app.include_router(graph.router)
app.include_router(attachments.router)


# ── Health / probes ──────────────────────────────────────────────────────────
@app.get("/live", include_in_schema=False)
async def live():
    """Liveness — process is up. Used by Docker HEALTHCHECK."""
    return {"status": "alive"}


@app.get("/ready", include_in_schema=False)
async def ready():
    """Readiness — dependencies reachable. Returns 503 if DB is down."""
    db_ok = await db_healthcheck()
    if not db_ok:
        return JSONResponse(status_code=503, content={"status": "not_ready", "database": False})
    return {"status": "ready", "database": True}


@app.get("/api/v1/health")
async def health():
    from mind_palace.services.inference import providers_info
    db_ok = await db_healthcheck()
    return {
        "status": "ok" if db_ok else "degraded",
        "version": "0.1.0",
        "environment": settings.environment,
        "mode": settings.deployment_mode,
        "mode_level": settings.mode_level,
        "database": "ok" if db_ok else "down",
        "inference": providers_info(),
    }


@app.get("/api/v1/config")
async def get_config():
    from mind_palace.services.inference import providers_info
    return {
        "mode": settings.deployment_mode,
        "mode_level": settings.mode_level,
        "providers": providers_info(),
        "graph_enabled": True,
    }


# ── MCP HTTP endpoint (mounted before the SPA catch-all) ─────────────────────
if _mcp_manager is not None:
    from starlette.responses import RedirectResponse

    @app.api_route("/mcp", methods=["GET", "POST", "DELETE"], include_in_schema=False)
    async def _mcp_redirect(request: Request):
        # The transport lives at /mcp/ (mounted); 307 preserves method + body.
        return RedirectResponse(url="/mcp/", status_code=307)

    async def _mcp_asgi(scope, receive, send):
        if scope["type"] == "http":
            headers = dict(scope.get("headers") or [])
            auth = headers.get(b"authorization", b"").decode()
            set_request_token(auth[7:] if auth.lower().startswith("bearer ") else "")
        await _mcp_manager.handle_request(scope, receive, send)

    app.mount("/mcp", _mcp_asgi)


# ── Serve React SPA in production ─────────────────────────────────────────────
_base = Path(__file__).parent.parent
static_dir = (_base / "frontend" / "dist") if (_base / "frontend" / "dist").exists() else (_base.parent / "frontend" / "dist")
static_dir = static_dir if static_dir.exists() else Path("/nonexistent")
if static_dir.exists():
    app.mount("/assets", StaticFiles(directory=str(static_dir / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        # Serve real static files (manifest, icons, etc.) when present
        candidate = static_dir / full_path
        if full_path and candidate.is_file():
            return FileResponse(str(candidate))
        index = static_dir / "index.html"
        if index.exists():
            return FileResponse(str(index))
        return {"error": "Frontend not built"}
