import { asc, eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { setups, tags } from "../schema.js";

export type SetupRow = typeof setups.$inferSelect;
export type TagRow = typeof tags.$inferSelect;

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

export function createTaxonomyRepo(db: Db, now: () => number = Date.now) {
  const stamps = () => {
    const timestamp = now();
    return { createdAt: timestamp, updatedAt: timestamp, deletedAt: null };
  };

  function createSetup(input: {
    name: string;
    description?: string | null;
    strategy?: string | null;
  }): SetupRow {
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
    listSetups(): SetupRow[] {
      return db.select().from(setups).where(eq(setups.archived, false)).orderBy(asc(setups.name)).all();
    },

    createSetup,

    listTags(): TagRow[] {
      return db.select().from(tags).where(eq(tags.archived, false)).orderBy(asc(tags.name)).all();
    },

    createTag,

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
