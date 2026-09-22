import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Columns every syncable row carries, so machines can merge later (spec §12). */
const syncColumns = {
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"),
};

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  broker: text("broker").notNull().default("ibkr"),
  /** 'live' | 'paper' */
  kind: text("kind").notNull(),
  externalId: text("external_id"),
  ...syncColumns,
});

export const setups = sqliteTable("setups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  /** null means the setup applies to both strategies. */
  strategy: text("strategy"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  ...syncColumns,
});

export const trades = sqliteTable(
  "trades",
  {
    id: text("id").primaryKey(),
    /** 'scalp' | 'iron_fly' */
    strategy: text("strategy").notNull(),
    /** 'live' | 'paper' | 'missed' */
    book: text("book").notNull(),
    accountId: text("account_id").references(() => accounts.id),
    underlying: text("underlying").notNull(),
    underlyingName: text("underlying_name"),
    structureLabel: text("structure_label"),
    openedAt: integer("opened_at").notNull(),
    closedAt: integer("closed_at"),
    netPnl: real("net_pnl"),
    fees: real("fees").notNull().default(0),
    notes: text("notes"),
    grade: text("grade"),
    setupId: text("setup_id").references(() => setups.id),
    excluded: integer("excluded", { mode: "boolean" }).notNull().default(false),
    excludeReason: text("exclude_reason"),
    source: text("source").notNull().default("manual"),
    externalRef: text("external_ref"),
    importBatchId: text("import_batch_id"),
    /** Last edit made by a person; null when only ever written by an importer or sync. */
    editedAt: integer("edited_at"),
    ...syncColumns,
  },
  (table) => [
    index("trades_opened_at_idx").on(table.openedAt),
    index("trades_strategy_book_idx").on(table.strategy, table.book),
    index("trades_underlying_idx").on(table.underlying),
  ],
);

export const legs = sqliteTable(
  "legs",
  {
    id: text("id").primaryKey(),
    tradeId: text("trade_id")
      .notNull()
      .references(() => trades.id),
    /** 'C' | 'P' */
    right: text("right").notNull(),
    strike: real("strike").notNull(),
    /** YYYY-MM-DD */
    expiry: text("expiry").notNull(),
    /** Signed: negative is short. */
    quantity: integer("quantity").notNull(),
    multiplier: integer("multiplier").notNull().default(100),
    openPrice: real("open_price").notNull(),
    closePrice: real("close_price"),
    ...syncColumns,
  },
  (table) => [index("legs_trade_idx").on(table.tradeId)],
);

export const ironFlyDetails = sqliteTable("iron_fly_details", {
  tradeId: text("trade_id")
    .primaryKey()
    .references(() => trades.id),
  bodyPutStrike: real("body_put_strike"),
  bodyCallStrike: real("body_call_strike"),
  putWingStrike: real("put_wing_strike"),
  callWingStrike: real("call_wing_strike"),
  contracts: integer("contracts"),
  creditPerShare: real("credit_per_share"),
  netCost: real("net_cost"),
  earningsDate: text("earnings_date"),
  /** 'BMO' | 'AMC' */
  earningsTiming: text("earnings_timing"),
  impliedMovePct: real("implied_move_pct"),
  actualMovePct: real("actual_move_pct"),
  ivBefore: real("iv_before"),
  ivAfter: real("iv_after"),
  sourceNotes: text("source_notes"),
});

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** 'mistake' | 'emotion' */
    kind: text("kind").notNull(),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    ...syncColumns,
  },
  (table) => [uniqueIndex("tags_kind_name_idx").on(table.kind, table.name)],
);

export const tradeTags = sqliteTable(
  "trade_tags",
  {
    tradeId: text("trade_id")
      .notNull()
      .references(() => trades.id),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id),
  },
  (table) => [uniqueIndex("trade_tags_pk").on(table.tradeId, table.tagId)],
);
