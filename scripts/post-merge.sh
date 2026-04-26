#!/bin/bash
set -e

echo "[post-merge] Installing dependencies..."
npm install --no-audit --no-fund --prefer-offline

if [ -n "$DATABASE_URL" ]; then
  echo "[post-merge] Pushing Drizzle schema..."
  npm run db:push -- --force
else
  echo "[post-merge] DATABASE_URL not set, skipping db:push."
fi

echo "[post-merge] Done."
