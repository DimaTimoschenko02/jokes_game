#!/bin/bash
set -e

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

APP_DIR="/home/qwe/apps/punchme"
cd "$APP_DIR"

echo "Pulling latest changes..."
git pull origin main

echo "Starting infrastructure (MongoDB)..."
docker compose -f docker-compose.prod.yml up -d

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

echo "Restarting API..."
cd "$APP_DIR"
npx pm2 delete punchme-api 2>/dev/null || true
npx pm2 start ecosystem.config.cjs

echo "Deploy complete!"
