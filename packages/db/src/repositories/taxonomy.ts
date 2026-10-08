import { and, asc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { setups, tags, trades, tradeTags } from "../schema.js";

export type SetupRow = typeof setups.$inferSelect;
export type TagRow = typeof tags.$inferSelect;
/** A setup or tag as the Playbook and the pickers list it: with how many live trades use it. */
export type SetupListItem = SetupRow & { tradeCount: number };
export type TagListItem = TagRow & { tradeCount: number };

/** A name already taken (scalp-review spec §6.3). The route answers 409 with the message. */
export class DuplicateNameError extends Error {}

const DEFAULT_SETUPS = [
  {
    name: "Earnings IV crush",
    strategy: "iron_fly",
    description: "Short fly into earnings, out the next day",
  },
  { name: "ORB breakout", strategy: "scalp", description: "Break of the opening range" },
  { name: "VWAP reclaim", strategy: "scalp", description: "Reclaim of session VWAP after a flush" },
];

const DEFAULT_TAGS: { name: string; kind: "mistake" | "emotion" }[] = [
  { name: "Moved stop", kind: "mistake" },
  { name: "FOMO entry", kind: "mistake" },
  { name: "Oversized", kind: "mistake" },
  { name: "Exited early", kind: "mistake" },
  { name: "Calm", kind: "emotion" },
  { name: "Rushed", kind: "emotion" },
  { name: "Revenge", kind: "emotion" },
];

const setupTaken = () => new DuplicateNameError("A setup with that name exists");
const tagTaken = (kind: string) =>
  new DuplicateNameError(
    kind === "emotion" ? "An emotion tag with that name exists" : "A mistake tag with that name exists",
  );

/** Only the fields a patch names. */
const named = <T extends object>(patch: T) =>
  Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));

export function createTaxonomyRepo(db: Db, now: () => number = Date.now) {
  const stamps = () => {
    const timestamp = now();
    return { createdAt: timestamp, updatedAt: timestamp, deletedAt: null, mergedInto: null };
  };

  /**
   * Names are unique ignoring case, archived ones included: a setup among setups, a tag within its kind. One a merge
   * folded into another (deleted) doesn't count.
   */
  function setupNameTaken(name: string, exceptId?: string): boolean {
    const conditions = [isNull(setups.deletedAt), sql`lower(${setups.name}) = lower(${name})`];
    if (exceptId) conditions.push(ne(setups.id, exceptId));
    return (
      db
        .select({ id: setups.id })
        .from(setups)
        .where(and(...conditions))
        .get() !== undefined
    );
  }

  function tagNameTaken(kind: string, name: string, exceptId?: string): boolean {
    const conditions = [
      isNull(tags.deletedAt),
      eq(tags.kind, kind),
      sql`lower(${tags.name}) = lower(${name})`,
    ];
    if (exceptId) conditions.push(ne(tags.id, exceptId));
    return (
      db
        .select({ id: tags.id })
        .from(tags)
        .where(and(...conditions))
        .get() !== undefined
    );
  }

  /** How many live (not deleted) trades use each setup, and each tag. */
  function setupCounts(): Map<string, number> {
    const rows = db
      .select({ id: trades.setupId, count: sql<number>`count(*)` })
      .from(trades)
      .where(and(isNull(trades.deletedAt), isNotNull(trades.setupId)))
      .groupBy(trades.setupId)
      .all();
    return new Map(rows.flatMap((row) => (row.id ? [[row.id, row.count] as const] : [])));
  }

  function tagCounts(): Map<string, number> {
    const rows = db
      .select({ id: tradeTags.tagId, count: sql<number>`count(*)` })
      .from(tradeTags)
      .innerJoin(trades, eq(trades.id, tradeTags.tradeId))
      .where(isNull(trades.deletedAt))
      .groupBy(tradeTags.tagId)
      .all();
    return new Map(rows.map((row) => [row.id, row.count]));
  }

  function createSetup(input: {
    name: string;
    description?: string | null;
    strategy?: string | null;
  }): SetupRow {
    if (setupNameTaken(input.name)) throw setupTaken();
    const row = {
      id: crypto.randomUUID(),
      name: input.name,
      description: input.description ?? null,
      strategy: input.strategy ?? null,
      archived: false,
      ...stamps(),
    };
    db.insert(setups).values(row).run();
    return row;
  }

  function createTag(input: { name: string; kind: "mistake" | "emotion" }): TagRow {
    if (tagNameTaken(input.kind, input.name)) throw tagTaken(input.kind);
    const row = {
      id: crypto.randomUUID(),
      name: input.name,
      kind: input.kind,
      archived: false,
      ...stamps(),
    };
    db.insert(tags).values(row).run();
    return row;
  }

  return {
    listSetups(options: { includeArchived?: boolean } = {}): SetupListItem[] {
      const counts = setupCounts();
      return db
        .select()
        .from(setups)
        .where(
          and(isNull(setups.deletedAt), options.includeArchived ? undefined : eq(setups.archived, false)),
        )
        .orderBy(asc(setups.name))
        .all()
        .map((row) => ({ ...row, tradeCount: counts.get(row.id) ?? 0 }));
    },

    createSetup,

    /** Null for an unknown setup, or one a merge folded into another. */
    updateSetup(
      id: string,
      patch: { name?: string; description?: string | null; strategy?: string | null; archived?: boolean },
    ): SetupRow | null {
      if (
        !db
          .select()
          .from(setups)
          .where(and(eq(setups.id, id), isNull(setups.deletedAt)))
          .get()
      )
        return null;
      if (patch.name !== undefined && setupNameTaken(patch.name, id)) throw setupTaken();
      db.update(setups)
        .set({ ...named(patch), updatedAt: now() })
        .where(eq(setups.id, id))
        .run();
      return db.select().from(setups).where(eq(setups.id, id)).get() ?? null;
    },

    listTags(options: { includeArchived?: boolean } = {}): TagListItem[] {
      const counts = tagCounts();
      return db
        .select()
        .from(tags)
        .where(and(isNull(tags.deletedAt), options.includeArchived ? undefined : eq(tags.archived, false)))
        .orderBy(asc(tags.name))
        .all()
        .map((row) => ({ ...row, tradeCount: counts.get(row.id) ?? 0 }));
    },

    createTag,

    /** Null for an unknown tag, or one a merge folded into another. A tag's kind never changes. */
    updateTag(id: string, patch: { name?: string; archived?: boolean }): TagRow | null {
      const existing = db
        .select()
        .from(tags)
        .where(and(eq(tags.id, id), isNull(tags.deletedAt)))
        .get();
      if (!existing) return null;
      if (patch.name !== undefined && tagNameTaken(existing.kind, patch.name, id))
        throw tagTaken(existing.kind);
      db.update(tags)
        .set({ ...named(patch), updatedAt: now() })
        .where(eq(tags.id, id))
        .run();
      return db.select().from(tags).where(eq(tags.id, id)).get() ?? null;
    },

    /** First-run content so the app is usable immediately. Safe to call on every boot. */
    seedDefaults(): void {
      if (db.select().from(setups).all().length === 0) {
        for (const setup of DEFAULT_SETUPS) createSetup(setup);
      }
      if (db.select().from(tags).all().length === 0) {
        for (const tag of DEFAULT_TAGS) createTag(tag);
      }
    },
  };
}
