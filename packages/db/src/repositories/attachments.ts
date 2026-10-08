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
 * Screenshots on trades (screenshots spec §3). Each write is an edit of its trade, stamping `edited_at`, so a merge
 * between machines carries it with the trade (export-merge spec §2).
 */
export function createAttachmentsRepo(db: Db, now: () => number = Date.now) {
  const live = (id: string) =>
    db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, id), isNull(attachments.deletedAt)))
      .get() ?? null;

  /** Stamps the trade as edited by the user. */
  function touch(tradeId: string, timestamp: number): void {
    db.update(trades).set({ editedAt: timestamp, updatedAt: timestamp }).where(eq(trades.id, tradeId)).run();
  }

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
      db.transaction((tx) => {
        tx.insert(attachments).values(row).run();
        tx.update(trades)
          .set({ editedAt: timestamp, updatedAt: timestamp })
          .where(eq(trades.id, tradeId))
          .run();
      });
      return row;
    },

    /** A blank caption clears it. Null for an unknown or removed screenshot. */
    setCaption(id: string, caption: string | null): AttachmentRow | null {
      const existing = live(id);
      if (!existing) return null;
      const timestamp = now();
      const text = caption?.trim() || null;
      db.transaction(() => {
        db.update(attachments)
          .set({ caption: text, updatedAt: timestamp })
          .where(eq(attachments.id, id))
          .run();
        touch(existing.tradeId, timestamp);
      });
      return live(id);
    },

    /** Removes a screenshot from its trade. The file stays: another row may share it (screenshots spec §1). */
    remove(id: string): boolean {
      const existing = live(id);
      if (!existing) return false;
      const timestamp = now();
      db.transaction(() => {
        db.update(attachments)
          .set({ deletedAt: timestamp, updatedAt: timestamp })
          .where(eq(attachments.id, id))
          .run();
        touch(existing.tradeId, timestamp);
      });
      return true;
    },
  };
}
