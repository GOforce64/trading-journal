# Screenshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every trade's page gets a Screenshots panel: paste, drop or pick PNG, JPEG or WebP images, see thumbnails, open a lightbox with captions, and remove one. Screenshots travel in the export bundle.

**Architecture:**
- `packages/db`: an `attachments` table (migration 0009) and `createAttachmentsRepo`. Live attachments hydrate onto every `TradeRecord`. Every attachment write is a user edit of its trade, stamping `edited_at`/`updated_at`, so the merge's whole-aggregate rule carries it.
- `bundle.ts`: `attachments` becomes a bundle table and a trade child. A bundle without it, from before this change, keeps the local children.
- `apps/server`: `routes/attachments.ts` stores content-addressed files in `attachmentsDir`. The bundle routes add and accept a `files` map.
- `apps/web`: `screenshots/Screenshots.tsx` and `Lightbox.tsx` on `TradeDetail`.

**Tech Stack:** TypeScript, Drizzle and better-sqlite3, Hono, node:crypto/fs, React 19, TanStack Query, Vitest.

**Spec:** [docs/superpowers/specs/2026-10-08-screenshots-design.md](../specs/2026-10-08-screenshots-design.md)

## Global Constraints

- **Accepted types:** `image/png` → `png`, `image/jpeg` → `jpg`, `image/webp` → `webp`, up to 20 MB each.
- **Files:** `attachmentsDir/<sha256>.<ext>`, written atomically (a temp file, then rename). A file is never deleted.
- **File names served** must match `^[0-9a-f]{64}\.(png|jpg|webp)$`.
- **Every attachment create, caption or delete** stamps its trade's `edited_at` and `updated_at`.
- **Copy, word for word:**
  - "Screenshots can be PNG, JPEG or WebP."
  - "That image is over 20 MB."
  - "Paste (Ctrl+V), drop an image here, or Add screenshot."
  - "Add screenshot", "Uploading…", "Remove this screenshot?", "Remove"
- **Bundle:** `files` is optional, `{ "<sha256>.<ext>": base64 }`, holding only what live rows use. A file whose hash doesn't match its name answers 400, before any backup.

## Review Focus

1. **Pasting into the Notes field** must not hijack a text paste; only an image on the clipboard is taken.
2. **The same image twice** gives one file and two rows. Removing one keeps the other's file.
3. **A merge where the local trade wins** keeps its screenshots, and a bundle without the table keeps them too.
4. **A forged file name** in a bundle (`../x.png`) or in a URL is refused.
5. **A failed upload** leaves no row, and no half-written file is served.

---

### Task 1: db — the table, the repo, hydration

- **Schema:** `attachments` with `id` (text pk), `tradeId` (references trades, not null), `sha256`, `ext`, `mime` (not null), `bytes` (integer, not null), `caption` (nullable), and the sync columns. Index `attachments_trade_idx` on `trade_id`.
- **Migration:** `pnpm --filter @tj/db generate --name attachments`.
- **`createAttachmentsRepo(db, now)`:**
  - `create(tradeId, { sha256, ext, mime, bytes })` → the row, or null when the trade is unknown or deleted;
  - `setCaption(id, caption)` → the row or null;
  - `remove(id)` → boolean (soft delete);
  - `get(id)`;
  - each write stamps the trade's `editedAt`/`updatedAt` in the same transaction.
- **`hydrateMany`** adds `attachments` (live, oldest first) to every `TradeRecord`.
- **Tests (`repositories/attachments.test.ts`):**
  - create, list order, and the trade stamped;
  - caption, trimmed and stamped;
  - remove hides the row and stamps;
  - an unknown or deleted trade → null;
  - `migrate.test` lists the columns.

### Task 2: db — attachments in the bundle

- `BUNDLE_TABLES` gains `attachments` (after `trade_tags`). `BUNDLE_KEYS.attachments = ["id"]`, and `CHILDREN` gains it.
- `Bundle` gains `files?: Record<string, string>`, filled by the server, not db. `Bundle.tables` is `Partial` for incoming bundles: `mergeBundle` takes `{ manifest; tables: Partial<Record<BundleTable, Row[]>>; files? }`.
- **A child table missing from the bundle:**
  - a winning bundle aggregate keeps the local rows of that table;
  - a trade new to this journal gets none.
- **Tests:**
  - attachments move with their trade both ways;
  - a bundle with `attachments` deleted from `tables` keeps local screenshots even when its trade version wins;
  - the property test gains an `attach` op (`attachments` repo create with a random sha) and stays green at 1,500 locally and 100 in CI.

### Task 3: server — upload, serve, caption, remove; files in the bundle

- **`routes/attachments.ts`, mounted at `/api`:**
  - `POST /trades/:id/attachments`: content-type map; `bodyLimit` 20 MB → 413 "That image is over 20 MB."; any other type → 400 "Screenshots can be PNG, JPEG or WebP."; an empty body → 400; hash with sha256; write atomically if missing; `repo.create`; unknown trade → 404 (the file may stay); otherwise 201 with the row.
  - `GET /attachments/files/:name`: the name regex → 404 otherwise; the file with its MIME and `cache-control: public, max-age=31536000, immutable`; missing → 404.
  - `PATCH /attachments/:id` takes `{ caption: string | null }`, at most 500 characters → the row or 404.
  - `DELETE /attachments/:id` → 204 or 404.
- **`AppDeps` gains `attachmentsDir?: string`.** Without it, upload and serving answer 503 "Screenshots need a data directory." `index.ts` passes `paths.attachmentsDir`, and the test helper uses a temp dir.
- **The bundle routes:**
  - the export adds `files` for live attachment rows whose file exists;
  - the merge validates the `files` names and hashes before the backup (a mismatch → 400 "This isn't a journal bundle."), then writes the missing ones atomically, then merges;
  - zod: `files` is optional, and `tables.attachments` is optional.
- **Tests:**
  - an upload stores one file for two identical bodies, with two rows;
  - 400, 413 and 404;
  - serving's headers, and a forged name → 404;
  - caption and delete;
  - a bundle round trip carries a file onto an empty journal and its directory;
  - a hash mismatch → 400 with no backup;
  - a bundle without `files` or `attachments` still merges.

### Task 4: web — the panel and the lightbox

- **`screenshots/Screenshots.tsx`** takes `{ trade }`:
  - the `Panel` title "Screenshots · N" ("Screenshots" when there are none);
  - thumbnails link to the lightbox;
  - "Add screenshot" uses a hidden file input (accept png, jpeg, webp; multiple);
  - an empty state with the copy;
  - placeholders while uploading, and the error line.
- **`useUploadScreenshot(tradeId)`** is a mutation that POSTs the raw file, reads the server's message on failure, and invalidates `["trade", id]` and `["trades"]`.
- **Paste:** a `window` paste listener takes `clipboardData.files` that are images, and ignores pastes with none, so text paste into fields works. **Drop:** `dragover`/`drop` on the panel's page wrapper (the `TradeDetail` root) takes image files.
- **`screenshots/Lightbox.tsx`:**
  - a fixed overlay, with ←/→ and Esc;
  - a click on the backdrop closes it, and a click on the image toggles fitted and 100%;
  - the caption field saves on blur or Enter, via PATCH;
  - Remove confirms, via DELETE.
- **`TradeDetail`** renders `<Screenshots trade={trade} />` last.
- **Tests (`Screenshots.test.tsx`):**
  - paste an image → POST with its body;
  - paste with only text → nothing;
  - drop → POST;
  - a 413 shows its message;
  - the thumbnails' count and title;
  - the lightbox: Esc, arrows, caption PATCH on blur, Remove after a confirm → DELETE.

### Task 5: docs, the full check, the live check, the review, the PR

- The README features list and the parent spec §8.5 point at the spec.
- Run `pnpm format && pnpm lint && pnpm typecheck && pnpm test`.
- **Live check:**
  - a stand-in over a copy of the journal, plus an empty one;
  - paste an image through puppeteer (`DataTransfer` in the page) onto a fly's page;
  - export and merge into the empty one, and see the image there;
  - take screenshots of the panel and the lightbox.
- Then the Opus review and a fix pass. Push, open the PR, wait for CI, and merge.
