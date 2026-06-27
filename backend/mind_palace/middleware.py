"""Production middleware: request logging, timing, request IDs, security headers."""
import time
import uuid
import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

log = logging.getLogger("mind_palace.request")


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Attach a request ID, log method/path/status/duration, expose X-Request-ID."""

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
        request.state.request_id = request_id
        start = time.perf_counter()

        try:
            response: Response = await call_next(request)
        except Exception:
            duration_ms = (time.perf_counter() - start) * 1000
            log.exception("%s %s -> 500 (%.1fms) [%s]",
                          request.method, request.url.path, duration_ms, request_id)
            raise

        duration_ms = (time.perf_counter() - start) * 1000
        # Skip noisy health probes at INFO; log everything else
        if request.url.path not in ("/health", "/live", "/ready"):
            level = logging.WARNING if response.status_code >= 500 else logging.INFO
            log.log(level, "%s %s -> %d (%.1fms) [%s]",
                    request.method, request.url.path, response.status_code, duration_ms, request_id)

        response.headers["X-Request-ID"] = request_id
        response.headers["X-Response-Time"] = f"{duration_ms:.1f}ms"
        return response


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-XSS-Protection": "0",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add baseline security headers to every response."""

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        for k, v in SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        return response
