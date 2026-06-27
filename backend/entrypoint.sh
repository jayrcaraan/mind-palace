#!/usr/bin/env sh
set -e

echo "[entrypoint] Running database migrations (alembic upgrade head)…"
# Idempotent: creates the schema on a fresh DB, no-ops on an existing one.
if alembic upgrade head; then
  echo "[entrypoint] Migrations applied."
else
  echo "[entrypoint] WARNING: migrations failed — starting anyway (schema may already exist)."
fi

echo "[entrypoint] Starting API server…"
exec uvicorn mind_palace.main:app \
  --host 0.0.0.0 --port 8000 --workers 1 \
  --proxy-headers --forwarded-allow-ips '*'
