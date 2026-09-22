@echo off
REM Build the UI and serve everything from one process.
cd /d "%~dp0.."
call pnpm install --frozen-lockfile || exit /b 1
call pnpm build || exit /b 1
call pnpm --filter @tj/server start
