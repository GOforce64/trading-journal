# Screenshots — Design Spec

- **Date:** 2026-10-08
- **Status:** Approved on autopilot, 2026-10-08. The user granted it overnight ("do as much as possible without asking… decide what's best"), so the decisions in §2 are mine, made for the user to revisit.
- **Scope:** parent spec §8.5 (Phase 2, item 4): screenshots on every trade's page, and their place in the export bundle.
- **Parent spec:** [2026-09-22-trading-journal-design.md](2026-09-22-trading-journal-design.md), §5 (`attachments/<sha256>.<ext>`), §6 (the `attachments` table), §8.5 and §12.

---

## 1. Purpose and success criteria

A trade's own chart can't show everything: the broker's ticket, a level the user drew on TradingView, an index trade the free data doesn't cover. Screenshots keep those images with the trade.

**Success:**
- **Adding:** on any trade's page, Ctrl+V with an image on the clipboard adds it. So do dropping an image file on the page and **Add screenshot**. PNG, JPEG and WebP are accepted, up to 20 MB each.
- **The panel:** **Screenshots** shows thumbnails, oldest first. Clicking one opens a lightbox: the full image, with ← and → between screenshots, Esc to close, click to zoom to 100%, and an editable caption.
- **Removing:** a screenshot can be removed, after a confirm.
- **Storage:** the same image attached twice is stored once on disk, named by its SHA-256.
- **Export:** an exported bundle carries the screenshots, and merging it on the other machine brings them along.

### Out of scope
- **Screenshots on missed trades,** since missed trades aren't built.
- **Image editing** (cropping, drawing).
- **Deleting files from disk.** A removed screenshot's row is soft-deleted and its file stays: it may be shared with another trade, and the space is small. A later cleanup can come.

---

## 2. Decisions

| Question | Decision |
|---|---|
| Where it shows | **A Screenshots panel** on every trade page (scalps and flies), under the review strip or the fly's details, so it's there whatever the chart can show. |
| How images come in | **Paste anywhere on the trade page**, drop anywhere on the page, or the **Add screenshot** button. Paste and drop are ignored while a text field has focus and the clipboard holds no image, so typing notes is never interrupted. |
| Upload | The raw bytes are the request body (`POST /api/trades/:id/attachments`, `content-type` image/png, image/jpeg or image/webp), limited to 20 MB. The server hashes them, writes `attachments/<sha256>.<ext>` only if it's missing, and inserts the row. |
| Serving | `GET /api/attachments/files/<sha256>.<ext>` serves the file, cached as immutable (the name is its content). |
| Order | Oldest first, by `created_at`. |
| Captions | Optional, edited in the lightbox (`PATCH /api/attachments/:id`). |
| Removal | `DELETE /api/attachments/:id` soft-deletes the row. Files stay (§1). |
| In the bundle | Attachment rows are part of a trade's aggregate (export-merge spec §2), so they move with it. The files ride along in the bundle's new `files` map, `{ "<sha256>.<ext>": "<base64>" }`, holding only those live rows use. A merge writes each missing file before the rows. |
| Older bundles | A bundle without an `attachments` table (format 1) still merges. The local screenshots of every trade are kept, whichever side's aggregate wins. |

---

## 3. Data

- **`attachments`** (migration 0009):
  - `id` text primary key (a UUID);
  - `trade_id` text, references `trades`;
  - `sha256` text, `ext` text (`png`, `jpg` or `webp`), `mime` text, `bytes` integer;
  - `caption` text or null;
  - `created_at`, `updated_at`, `deleted_at`, as every syncable row has.
  - An index on `trade_id`.
- **The trade view** (`GET /api/trades/:id`, and the list rows) gains `attachments: { id, sha256, ext, mime, bytes, caption, createdAt }[]`, live rows only.

---

## 4. Server

- `POST /api/trades/:id/attachments`:
  - **400** for any other content type ("Screenshots can be PNG, JPEG or WebP."), and **413** over 20 MB ("That image is over 20 MB.");
  - **404** for an unknown or deleted trade;
  - otherwise **201** with the row.
  - The file is written atomically (a temp file, then rename), so a half-written image is never served.
- `GET /api/attachments/files/:name`:
  - `name` must match `^[0-9a-f]{64}\.(png|jpg|webp)$`, which keeps paths out of the data directory;
  - answered with its MIME type and `cache-control: public, max-age=31536000, immutable`;
  - **404** when missing.
- `PATCH /api/attachments/:id` takes `{ caption: string | null }`, trimmed, up to 500 characters, and stamps `updated_at`.
- `DELETE /api/attachments/:id` soft-deletes the row (`deleted_at`, `updated_at`).
- **The bundle:**
  - `GET /api/bundle` adds `files`, read from the attachments directory for live rows;
  - `POST /api/bundle/merge` writes the missing files before merging, checking each file's SHA-256 against its name. A mismatch answers 400 and writes nothing.
  - The format stays 1. `files` and `attachments` are optional, and a bundle without them merges as before.

---

## 5. Web

- **`Screenshots`** (`apps/web/src/trade/Screenshots.tsx`), on `TradeDetail` for every trade:
  - the panel header reads "Screenshots · 3";
  - thumbnails sit in a wrapping row, 160 px wide with their aspect kept, the caption under each in muted text;
  - with none, the panel reads "Paste (Ctrl+V), drop an image here, or Add screenshot." and shows the button.
- **Paste and drop:**
  - one `paste` listener on the window while the page is open; it takes the clipboard's image files;
  - `dragover` and `drop` on the page take dropped files;
  - each image uploads on its own, with a "Uploading…" placeholder thumbnail;
  - an error reads under the panel, such as "That image is over 20 MB.";
  - every success refetches the trade.
- **The lightbox:**
  - a fixed overlay with the image fitted to the window, ← and → (buttons and keys), Esc or a click on the backdrop to close;
  - a click on the image toggles between fitted and 100%, scrollable;
  - the caption field below saves on blur or Enter;
  - **Remove** asks first ("Remove this screenshot?").

---

## 6. Testing

- **db:** the migration; the attachments repo (create, list live rows oldest first, caption, soft delete); and the bundle:
  - attachments move with their trade;
  - a format-1 bundle without the table keeps local screenshots;
  - the property test gains an "attach" operation.
- **server:**
  - an upload stores one file for two identical images;
  - the 400, 413 and 404 answers;
  - serving checks the name and sets the headers;
  - captions and deletes;
  - the bundle round trip carries files, writes the missing ones, and refuses a file whose hash doesn't match.
- **web:**
  - paste and drop upload the image, while paste into a focused text field doesn't;
  - an upload's error message;
  - the thumbnails;
  - the lightbox's keys, zoom, caption save and remove.
- **Live check** on a stand-in over a copy of the journal:
  - paste a real screenshot into a fly's page;
  - export, then merge into an empty stand-in, and see it there;
  - take screenshots of the panel and the lightbox.

---

## 7. Live check (2026-10-08)

Two stand-ins: A over a copy of the real journal, and B over an empty journal, each with its own attachments directory.
- **In headless Firefox** on A's BB iron fly:
  - an image dropped on the page uploaded at once, as `55edfb97….png` (12 KB), and showed as a thumbnail;
  - the lightbox opened on it;
  - a caption typed and saved with Enter ("PD high rejected") showed under the thumbnail;
  - no console errors.
- **Paste isn't checked live.** Firefox strips clipboard data from a paste a script makes, though it keeps a drop's. Both go through the same window listener and upload, and the jsdom tests cover paste.
- **Bundle:** A's bundle (27 KB with the image) merged into B in 83 ms. B's attachments directory then held the file, the fly carried the screenshot with its caption, and B served it as `image/png`.
