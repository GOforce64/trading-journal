import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../client.js";
import { attachments, trades } from "../schema.js";

export type AttachmentRow = typeof attachments.$inferSelect;

/** What a stored image is: its content's hash, its type, and its size. */
export interface AttachmentFile {
  sha256: string;
  ext: string;
  mime: string;
  bytes: number;
}

/**
 * Screenshots on trades (screenshots spec §3). Each write stamps the screenshot alone: a merge between machines
 * resolves screenshots one by one, like fills, so the trade's own edit time is left to its own fields (spec §4).
 */
export function createAttachmentsRepo(db: Db, now: () => number = Date.now) {
  const live = (id: string) =>
    db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, id), isNull(attachments.deletedAt)))
      .get() ?? null;

  return {
    get: live,

    /** Null when the trade is unknown or deleted. */
    create(tradeId: string, file: AttachmentFile): AttachmentRow | null {
      const trade = db
        .select({ id: trades.id })
        .from(trades)
        .where(and(eq(trades.id, tradeId), isNull(trades.deletedAt)))
        .get();
      if (!trade) return null;
      const timestamp = now();
      const row = {
        id: crypto.randomUUID(),
        tradeId,
        ...file,
        caption: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      };
      db.insert(attachments).values(row).run();
      return row;
    },

    /** A blank caption clears it. Null for an unknown or removed screenshot. */
    setCaption(id: string, caption: string | null): AttachmentRow | null {
      const existing = live(id);
      if (!existing) return null;
      const timestamp = now();
      const text = caption?.trim() || null;
      db.update(attachments).set({ caption: text, updatedAt: timestamp }).where(eq(attachments.id, id)).run();
      return live(id);
    },

    /** Removes a screenshot from its trade. The file stays: another row may share it (screenshots spec §1). */
    remove(id: string): boolean {
      const existing = live(id);
      if (!existing) return false;
      const timestamp = now();
      db.update(attachments)
        .set({ deletedAt: timestamp, updatedAt: timestamp })
        .where(eq(attachments.id, id))
        .run();
      return true;
    },
  };
}
