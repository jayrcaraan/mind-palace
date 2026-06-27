# PostgreSQL 16 + pgvector + Apache AGE
#
# Mind Palace needs two Postgres extensions:
#   • pgvector — dense-vector semantic search (HNSW)
#   • Apache AGE — the openCypher knowledge graph
#
# pgvector ships in the base image; AGE is compiled from source for PG16.
# Build:  docker build -f docker/postgres.Dockerfile -t mind-palace-db:pg16 .
FROM pgvector/pgvector:pg16

USER root
# `ca-certificates` is required so git can verify github.com over HTTPS — the base
# image ships without it (otherwise: "server certificate verification failed. CAfile: none").
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates build-essential git postgresql-server-dev-16 flex bison \
    && update-ca-certificates \
    && git clone --depth 1 --branch PG16 https://github.com/apache/age.git /tmp/age \
    && cd /tmp/age && make && make install \
    && cd / && rm -rf /tmp/age \
    && apt-get purge -y --auto-remove build-essential git postgresql-server-dev-16 flex bison \
    && rm -rf /var/lib/apt/lists/*

USER postgres
