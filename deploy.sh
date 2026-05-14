#!/bin/bash
set -e

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

APP_DIR="/home/qwe/apps/punchme"
cd "$APP_DIR"

echo "Pulling latest changes..."
git pull origin main

echo "Starting infrastructure (PostgreSQL + pgvector)..."
docker compose -f docker-compose.prod.yml up -d

echo "Waiting for postgres to be healthy..."
for i in {1..40}; do
  if docker exec punchme-postgres pg_isready -U punchme -d punchme >/dev/null 2>&1; then
    echo "postgres ready"
    break
  fi
  if [ "$i" -eq 40 ]; then
    echo "postgres did not become ready in 40s — aborting deploy"
    docker logs --tail 50 punchme-postgres || true
    exit 1
  fi
  sleep 1
done

echo "Installing API dependencies..."
cd "$APP_DIR/api"
npm ci

echo "Building API..."
npm run build

echo "Installing Web dependencies..."
cd "$APP_DIR/web"
npm ci

echo "Building Web..."
npm run build

echo "Restarting API (drizzle migrations run automatically on boot)..."
cd "$APP_DIR"
npx pm2 delete punchme-api 2>/dev/null || true
npx pm2 start ecosystem.config.cjs

echo "Waiting for API to come up..."
for i in {1..30}; do
  if curl -fsS http://127.0.0.1:4002/api/health >/dev/null 2>&1 \
     || curl -fsS http://127.0.0.1:4002 >/dev/null 2>&1; then
    echo "api responding"
    break
  fi
  sleep 1
done

echo "Importing curated seeds (idempotent)..."
cd "$APP_DIR/api"
# Export env explicitly: PM2 envs aren't inherited by the shell after pm2 start.
set -a
[ -f "$APP_DIR/.env" ] && . "$APP_DIR/.env"
export DATABASE_URL="postgres://punchme:punchme@127.0.0.1:5432/punchme"
export OLLAMA_BASE_URL="http://127.0.0.1:11434"
export OLLAMA_EMBED_MODEL="bge-m3"
set +a
npm run import:seeds || echo "WARN: import:seeds failed — continuing"

echo "Backfilling embeddings (uses Ollama bge-m3)..."
npm run backfill:embeddings || echo "WARN: backfill:embeddings failed — continuing"

echo "Deploy complete!"
