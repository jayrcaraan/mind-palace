# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — build the React frontend
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS frontend
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci || npm install
COPY frontend/ ./
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — Python runtime
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.11-slim
WORKDIR /app

# System deps for MarkItDown / OCR / image handling + curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 poppler-utils tesseract-ocr libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/pyproject.toml .
RUN pip install --no-cache-dir uv && uv pip install --system --no-cache-dir -e "."

COPY backend/mind_palace/ mind_palace/
COPY backend/migrations/ migrations/
COPY backend/alembic/ alembic/
COPY backend/alembic.ini .
COPY backend/entrypoint.sh .

# Frontend build output, served by the backend
COPY --from=frontend /web/dist frontend/dist

# Blob storage dir + non-root user
RUN chmod +x entrypoint.sh && \
    mkdir -p /data/blobs && \
    addgroup --system --gid 1001 mindpalace && \
    adduser --system --uid 1001 --gid 1001 mindpalace && \
    chown -R mindpalace:mindpalace /app /data

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    BLOB_STORAGE_PATH=/data/blobs

USER mindpalace
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD curl -fsS http://localhost:8000/live || exit 1

ENTRYPOINT ["./entrypoint.sh"]
