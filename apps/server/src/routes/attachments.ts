import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zValidator } from "@hono/zod-validator";
import { createAttachmentsRepo, type Db } from "@tj/db";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

/** The image types a screenshot can be, and the extension each is stored under (screenshots spec §2). */
const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
/** A stored file's name: its content's SHA-256 and extension. Nothing else is ever read from the directory. */
export const FILE_NAME = /^([0-9a-f]{64})\.(png|jpg|webp)$/;
/** The largest screenshot: an upload's limit, and a bundle's for each file. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** A hidden temp file in `dir` holding `bytes`. Its name never matches a stored file's, so it's never served. */
export function stageFile(dir: string, name: string, bytes: Uint8Array): string {
  const temp = join(dir, `.${name}.${randomUUID()}.tmp`);
  writeFileSync(temp, bytes);
  return temp;
}

/** Moves a staged file into place as `dir/name`, unless the same content is there already. */
export function commitFile(dir: string, name: string, temp: string): void {
  const target = join(dir, name);
  if (existsSync(target)) rmSync(temp, { force: true });
  else renameSync(temp, target);
}

/** Writes `dir/name` unless it's there, through a temp file, so a half-written image is never served. */
export function storeFile(dir: string, name: string, bytes: Uint8Array): void {
  if (!existsSync(join(dir, name))) commitFile(dir, name, stageFile(dir, name, bytes));
}

const NO_DIR = { error: "unavailable", message: "Screenshots need a data directory." };
const NOT_FOUND = { error: "not found" };

/** Screenshots on trades (screenshots spec §4), mounted at /api. */
export function attachmentRoutes(db: Db, { dir, now }: { dir?: string; now?: () => number } = {}) {
  const repo = createAttachmentsRepo(db, now);
  return new Hono()
    .post(
      "/trades/:id/attachments",
      bodyLimit({
        maxSize: MAX_IMAGE_BYTES,
        onError: (c) => c.json({ error: "too_large", message: "That image is over 20 MB." }, 413),
      }),
      async (c) => {
        if (!dir) return c.json(NO_DIR, 503);
        const mime = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
        const ext = EXTENSIONS[mime];
        if (!ext) return c.json({ error: "invalid", message: "Screenshots can be PNG, JPEG or WebP." }, 400);
        const bytes = new Uint8Array(await c.req.arrayBuffer());
        if (bytes.length === 0) return c.json({ error: "invalid", message: "That image is empty." }, 400);
        const hash = sha256(bytes);
        // The file first: a row never points at a missing one. A file for a trade that turns out unknown is harmless.
        storeFile(dir, `${hash}.${ext}`, bytes);
        const row = repo.create(c.req.param("id"), { sha256: hash, ext, mime, bytes: bytes.length });
        return row ? c.json(row, 201) : c.json(NOT_FOUND, 404);
      },
    )
    .get("/attachments/files/:name", (c) => {
      if (!dir) return c.json(NO_DIR, 503);
      const name = c.req.param("name");
      const match = FILE_NAME.exec(name);
      const path = join(dir, name);
      if (!match || !existsSync(path)) return c.json(NOT_FOUND, 404);
      return c.body(new Uint8Array(readFileSync(path)), 200, {
        "content-type": TYPES[match[2] ?? ""] ?? "application/octet-stream",
        "cache-control": "public, max-age=31536000, immutable",
      });
    })
    .patch(
      "/attachments/:id",
      zValidator("json", z.object({ caption: z.string().max(500).nullable() })),
      (c) => {
        const row = repo.setCaption(c.req.param("id"), c.req.valid("json").caption);
        return row ? c.json(row, 200) : c.json(NOT_FOUND, 404);
      },
    )
    .delete("/attachments/:id", (c) =>
      repo.remove(c.req.param("id")) ? c.body(null, 204) : c.json(NOT_FOUND, 404),
    );
}
