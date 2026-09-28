#!/usr/bin/env bash
# Build the UI and serve everything from one process.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @tj/server start
