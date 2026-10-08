# Screenshots — Design Spec

- **Date:** 2026-10-08
- **Status:** Approved on autopilot, 2026-10-08. The user granted it overnight ("do as much as possible without asking… decide what's best"), so the decisions in §2 were mine. **The user confirmed them all on 2026-10-08**, including leaving removed files on disk.
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
| How images come in | **Paste anywhere on the trade page**, drop anywhere on the page, or the **Add screenshot** button. A paste with no image is left alone. So is a paste into a text field whenever the clipboard holds text: cells copied from Excel or LibreOffice carry a picture of themselves too, and they paste as text. Typing notes is never interrupted. A dropped file of another kind stays on the page and shows "Screenshots can be PNG, JPEG or WebP." *(Changed in the final review.)* |
| Upload | The raw bytes are the request body (`POST /api/trades/:id/attachments`, `content-type` image/png, image/jpeg or image/webp), limited to 20 MB. The server hashes them, writes `attachments/<sha256>.<ext>` only if it's missing, and inserts the row. |
| Serving | `GET /api/attachments/files/<sha256>.<ext>` serves the file, cached as immutable (the name is its content). |
| Order | Oldest first, by `created_at`. |
| Captions | Optional, edited in the lightbox (`PATCH /api/attachments/:id`). |
| Removal | `DELETE /api/attachments/:id` soft-deletes the row. Files stay (§1). |
| Merging screenshots | **Each screenshot resolves by its own id, like a fill**: the newer write wins, and a removal wins a tie. A screenshot added on either machine is never lost to the other's later edit of the trade. A screenshot's write stamps only its own row, not its trade. *(Changed in the final review. The first version put screenshots in the trade's aggregate and stamped the trade, so the other machine's later notes edit hard-deleted them on both sides.)* The merge summary counts "screenshots added". |
| In the bundle | **The `.tjbundle` is a ustar archive** (§4): `bundle.json.gz`, the manifest and tables as before, then one `attachments/<sha256>.<ext>` entry per file live rows use. It is written and read as a stream, so screenshots add no limit. *(Changed in the final review. The first version carried files as base64 in the JSON: merging stopped at 100 MB, and exporting at about 384 MB.)* |
| Older bundles | A gzipped JSON bundle from before screenshots still merges, and its trades' local screenshots are kept. An app from before this change can't read the new archive: update both machines. |

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
- **The bundle** (`apps/server/src/archive.ts`, `routes/bundle.ts`):
  - `GET /api/bundle` streams a ustar archive (`application/x-tar`):
    - `bundle.json.gz` first, the manifest (format 1) and tables;
    - then each file live rows use, once, read one at a time;
    - a file whose content no longer matches its name is left out, since the other machine would refuse the whole bundle for it;
    - any tar tool can list or unpack one.
  - `POST /api/bundle/merge` reads the upload as a stream:
    - the tables must come first, at most 100 MB, and a newer schema answers 409 before any file is read;
    - each `attachments/` entry must be named like a stored file, be at most 20 MB, and match its SHA-256, or the bundle answers 400;
    - files are hashed into hidden temp files and put in place only after the backup, before the rows, so a refused bundle leaves none;
    - entries it doesn't know are skipped;
    - every answer waits until the upload has been read to its end, so a refusal doesn't reach the browser as a broken connection.
  - A body starting with gzip's magic bytes is a bundle from before screenshots: its tables alone, still capped at 100 MB.

---

## 5. Web

- **`Screenshots`** (`apps/web/src/screenshots/Screenshots.tsx`), on `TradeDetail` for every trade:
  - the panel header reads "Screenshots · 3";
  - thumbnails sit in a wrapping row, 160 px wide with their aspect kept, the caption under each in muted text;
  - with none, the panel reads "Paste (Ctrl+V), drop an image here, or Add screenshot." and shows the button.
- **Paste and drop:**
  - one `paste` listener on the window while the page is open; it takes the clipboard's image files, except into a text field when the clipboard holds text (§2);
  - `dragover` and `drop` on the page take dropped files; a drop with files is always kept from the browser, and one with no accepted image shows "Screenshots can be PNG, JPEG or WebP.";
  - each image uploads on its own, with a "Uploading…" placeholder thumbnail;
  - an error reads under the panel, such as "That image is over 20 MB.";
  - every success refetches the trade.
- **The lightbox:**
  - a fixed overlay with the image fitted to the window, ← and → (buttons and keys), Esc or a click on the backdrop to close;
  - a click on the image toggles between fitted and 100%, scrollable;
  - the caption field below saves on blur or Enter, and when Esc or the backdrop closes the lightbox while it's being typed in;
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

---

## 8. Final review (2026-10-08)

A fresh Opus review of cf2eb00..841f32e found no Critical issues and three Important ones; two of its Minors were graded up by their effect. All five are fixed test-first:
- **A screenshot lost to the other machine's edit:** screenshots now merge one by one (§2).
- **Bundles capped by their screenshots:** the bundle is now a streamed archive (§2, §4). A live check exported seven 18 MB screenshots (126 MB) in 0.4 s and merged them into an empty journal in 0.75 s. `tar -tvf` listed the archive, and a copy cut off at 50 MB was refused with no temp files left behind.
- **An Office paste into Notes taken as a screenshot:** text pastes into fields stay text (§2).
- **A caption lost on Esc or a backdrop click:** closing blurs the caption first (§5). *(Graded up from Minor.)*
- **An unsupported dropped image opening in the browser:** the drop is kept and the message shows (§2). *(Graded up from Minor.)*
- **A damaged file spoiling every export:** the export leaves it out (§4). *(Graded up from Minor as part of the archive.)*

**Deferred minors:**
- The caption input has no `maxLength`, so past 500 characters the user sees "Saving the caption failed: 400".
- A soft-deleted trade's live screenshot rows still put their files in every bundle.
- A bundle's attachment rows aren't checked: a crafted `sha256` could point a thumbnail at another `/api` path.
- On Windows, a rename right after a write can fail while antivirus scans the file, and the upload answers 500 (a retry works).
- Served files lack `X-Content-Type-Options: nosniff`.
- Thumbnails are cropped to 160×96 (`object-cover`), though §5 says their aspect is kept.
- Dragging a thumbnail within the page might drop it back as a duplicate in some browsers (`draggable={false}` would rule it out).
- Test gaps: a 404 upload asserting no row; caption and remove operations in the property test; the server tests leave `tj-shots-*` temp directories behind.
- The lightbox has no focus trap, and its zoom is mouse-only.
