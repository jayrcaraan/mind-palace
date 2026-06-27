"""Generic inference layer.

All providers speak the OpenAI API (`/embeddings`, `/chat/completions`), so the
embedding, LLM and OCR/vision steps can each point at a local Ollama, OpenAI, or
any OpenAI-compatible remote endpoint — configured independently.
"""
import json
import base64
import logging
from pathlib import Path
from typing import Optional

import httpx

from mind_palace.config import settings

log = logging.getLogger(__name__)


def _headers(api_key: str) -> dict:
    h = {"Content-Type": "application/json"}
    if api_key and api_key not in ("not-needed", ""):
        h["Authorization"] = f"Bearer {api_key}"
    return h


def _raise_clear(e: Exception, provider: str, model: str):
    """Turn an httpx error into a clear, actionable message (esp. 404 model-not-found)."""
    if isinstance(e, httpx.HTTPStatusError):
        code = e.response.status_code
        body = (e.response.text or "")[:200].replace("\n", " ")
        if code == 404:
            raise RuntimeError(
                f"{provider} model '{model}' not found (404) at {e.request.url} — "
                f"pull it on the inference endpoint or fix {provider.upper()}_MODEL. [{body}]"
            ) from e
        raise RuntimeError(f"{provider} call failed (HTTP {code}) at {e.request.url}: {body}") from e
    if isinstance(e, httpx.RequestError):
        raise RuntimeError(f"{provider} endpoint unreachable at {e.request.url}: {e}") from e
    raise RuntimeError(f"{provider} call failed: {e}") from e


def _api_url(base: str, path: str) -> str:
    """Build an OpenAI-compatible endpoint URL, tolerating a base with or without
    the `/v1` suffix (and trailing slashes). Avoids 404s from a misconfigured base.
    e.g. http://ollama:11434  ·  http://ollama:11434/  ·  http://ollama:11434/v1
         all → http://ollama:11434/v1/<path>
    """
    base = (base or "").rstrip("/")
    if not base.endswith("/v1"):
        base = base + "/v1"
    return f"{base}/{path.lstrip('/')}"


# Short connect timeout so an unreachable/misconfigured endpoint fails fast
# (instead of hanging the whole read window); generous read for slow generation.
# Both are env-configurable (INFERENCE_CONNECT_TIMEOUT, {EMBEDDING,OCR,LLM}_TIMEOUT).
def _timeout(read: float) -> "httpx.Timeout":
    return httpx.Timeout(read, connect=settings.inference_connect_timeout)


def _mime_for(path: Path) -> str:
    ext = path.suffix.lower().lstrip(".")
    return {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "gif": "gif", "webp": "webp"}.get(ext, "png")


# ── Embeddings ───────────────────────────────────────────────────────────────
async def embed(text: str) -> list[float]:
    return (await embed_batch([text]))[0]


async def embed_batch(texts: list[str]) -> list[list[float]]:
    try:
        async with httpx.AsyncClient(timeout=_timeout(settings.embedding_timeout)) as client:
            resp = await client.post(
                _api_url(settings.embedding_base_url, "embeddings"),
                headers=_headers(settings.embedding_api_key),
                json={"model": settings.embedding_model, "input": texts},
            )
            resp.raise_for_status()
            data = resp.json()["data"]
            data.sort(key=lambda d: d.get("index", 0))  # preserve input order
            return [d["embedding"] for d in data]
    except Exception as e:
        _raise_clear(e, "embedding", settings.embedding_model)


# ── OCR / vision (image → text) ──────────────────────────────────────────────
async def describe_image(image_path: str | Path) -> str:
    p = Path(image_path)
    b64 = base64.b64encode(p.read_bytes()).decode()
    data_url = f"data:image/{_mime_for(p)};base64,{b64}"

    try:
        async with httpx.AsyncClient(timeout=_timeout(settings.ocr_timeout)) as client:
            resp = await client.post(
                _api_url(settings.ocr_base_url, "chat/completions"),
                headers=_headers(settings.ocr_api_key),
                json={
                    "model": settings.ocr_model,
                    "messages": [{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": (
                                "Transcribe and describe this image. If it contains text, "
                                "transcribe it verbatim. If it contains charts or diagrams, "
                                "describe the data and structure. Be concise but complete."
                            )},
                            {"type": "image_url", "image_url": {"url": data_url}},
                        ],
                    }],
                    "temperature": 0,
                },
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]
    except Exception as e:
        _raise_clear(e, "ocr", settings.ocr_model)


# ── LLM (entity extraction) ──────────────────────────────────────────────────
async def extract_entities(text: str) -> list[dict]:
    prompt = (
        "Extract named entities from the text. Return ONLY a JSON array; each item "
        'has "name" (string) and "type" (one of: Person, Organization, Location, '
        "Project, Date). No prose.\n\nText:\n" + text[:3000] + "\n\nJSON:"
    )
    async with httpx.AsyncClient(timeout=_timeout(settings.llm_timeout)) as client:
        try:
            resp = await client.post(
                _api_url(settings.llm_base_url, "chat/completions"),
                headers=_headers(settings.llm_api_key),
                json={
                    "model": settings.llm_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                },
            )
            resp.raise_for_status()
        except Exception as e:
            # Connection / model-not-found errors must surface (not silent).
            _raise_clear(e, "llm", settings.llm_model)
        content = resp.json()["choices"][0]["message"]["content"].strip()
    # A model that replies with non-JSON is a soft failure — no entities, no crash.
    try:
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        entities = json.loads(content)
        return [e for e in entities if isinstance(e, dict) and "name" in e and "type" in e]
    except Exception as e:
        log.warning("LLM returned unparseable entity JSON (%s); treating as 0 entities", e)
        return []


def regex_extract_entities(text: str) -> list[dict]:
    """Fast regex-based entity extraction for light mode (no LLM)."""
    import re
    entities, seen = [], set()
    for m in re.finditer(r"\b\d{4}-\d{2}-\d{2}\b", text):
        if (m.group(), "Date") not in seen:
            entities.append({"name": m.group(), "type": "Date"}); seen.add((m.group(), "Date"))
    for m in re.finditer(r"https?://[^\s<>\"']+", text):
        if (m.group(), "Location") not in seen:
            entities.append({"name": m.group(), "type": "Location"}); seen.add((m.group(), "Location"))
    for m in re.finditer(r"@([A-Za-z][A-Za-z0-9_]+)", text):
        if (m.group(1), "Person") not in seen:
            entities.append({"name": m.group(1), "type": "Person"}); seen.add((m.group(1), "Person"))
    return entities


# ── Health / introspection ───────────────────────────────────────────────────
def providers_info() -> dict:
    """Configured providers (no network call — safe for frequent health checks)."""
    def host(url: str) -> str:
        try:
            return httpx.URL(url).host or url
        except Exception:
            return url
    return {
        "embedding": {"model": settings.embedding_model, "host": host(settings.embedding_base_url)},
        "llm": {"model": settings.llm_model, "host": host(settings.llm_base_url)},
        "ocr": {"model": settings.ocr_model, "host": host(settings.ocr_base_url)},
    }


async def health_check() -> dict:
    """Soft reachability probe of the embedding provider (best-effort)."""
    info = providers_info()
    reachable = None
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            r = await client.get(
                _api_url(settings.embedding_base_url, "models"),
                headers=_headers(settings.embedding_api_key),
            )
            reachable = r.status_code < 500
    except Exception:
        reachable = False
    return {"status": "ok" if reachable else "unreachable", "providers": info}
