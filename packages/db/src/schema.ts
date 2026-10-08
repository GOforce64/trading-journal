import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    /** Round-trip commissions; feesOpen + feesClose when both are known. */
    fees: real("fees").notNull().default(0),
    feesOpen: real("fees_open"),
    feesClose: real("fees_close"),
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
    /** The user changed a broker fact on this trade, so the sync stops writing it (spec §5.3). */
    factsEditedAt: integer("facts_edited_at"),
    /** When the user clicked Done reviewing (scalp-review spec §5); null otherwise. */
    reviewedAt: integer("reviewed_at"),
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
  /** The stock price at openedAt and at closedAt, from Alpaca. Only the move filler writes them (spec §5.1). */
  underlyingPriceEntry: real("underlying_price_entry"),
  underlyingPriceExit: real("underlying_price_exit"),
  sourceNotes: text("source_notes"),
});

/**
 * A scalp's levels (scalp-review spec §5, scalp-R spec §5): one row per scalp, from its first level or basis. Its
 * targets are in `scalp_targets`.
 */
export const scalpDetails = sqliteTable("scalp_details", {
  tradeId: text("trade_id")
    .primaryKey()
    .references(() => trades.id),
  /** What the stop and targets are measured on. */
  levelBasis: text("level_basis", { enum: ["stock", "premium"] }).notNull(),
  /** A stock price, or an option price per share. */
  stopPrice: real("stop_price"),
  /** Typed over the fetched stock price at entry. */
  stockEntryOverride: real("stock_entry_override"),
  /** Typed over the model's planned risk, in dollars. */
  riskOverride: real("risk_override"),
});

/** A scalp's profit targets (scalp-R spec §5), numbered from 1 in the order the trade reaches them. */
export const scalpTargets = sqliteTable(
  "scalp_targets",
  {
    tradeId: text("trade_id")
      .notNull()
      .references(() => trades.id),
    position: integer("position").notNull(),
    /** On the trade's basis. */
    price: real("price").notNull(),
    /** Whole contracts sold there. */
    contracts: integer("contracts").notNull(),
  },
  (table) => [primaryKey({ columns: [table.tradeId, table.position] })],
);

/** The stock prices a scalp's R needs (scalp-R spec §5). Only the price filler writes them; an edit deletes them. */
export const scalpPrices = sqliteTable("scalp_prices", {
  tradeId: text("trade_id")
    .primaryKey()
    .references(() => trades.id),
  /** The stock at openedAt, interpolated by the second. */
  entryPrice: real("entry_price"),
  /** The stock's range from the entry minute through the exit minute. */
  holdHigh: real("hold_high"),
  holdLow: real("hold_low"),
  fetchedAt: integer("fetched_at").notNull(),
  /** The contract's range over the same minutes (premium-chart spec §9.1). */
  optionHigh: real("option_high"),
  optionLow: real("option_low"),
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

/** One IBKR execution, expiry, exercise or assignment: a fact only the sync writes (spec §5.1). */
export const fills = sqliteTable(
  "fills",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    /** The execution id, or `trade-{tradeID}` for a booking without one. */
    brokerExecKey: text("broker_exec_key").notNull(),
    brokerTradeId: text("broker_trade_id").notNull(),
    brokerOrderId: text("broker_order_id"),
    conid: text("conid").notNull(),
    underlying: text("underlying").notNull(),
    /** 'C' | 'P' */
    right: text("right").notNull(),
    strike: real("strike").notNull(),
    /** YYYY-MM-DD */
    expiry: text("expiry").notNull(),
    multiplier: integer("multiplier").notNull(),
    /** YYYY-MM-DD, New York */
    tradeDate: text("trade_date").notNull(),
    executedAt: integer("executed_at").notNull(),
    /** Signed: + bought, − sold. */
    quantity: integer("quantity").notNull(),
    price: real("price").notNull(),
    /** Positive dollars. */
    commission: real("commission").notNull(),
    /** 'O' | 'C' */
    openClose: text("open_close"),
    /** 'trade' | 'expiration' | 'exercise' | 'assignment' */
    kind: text("kind").notNull(),
    /** 'confirm' | 'activity': the statement that last wrote the row. */
    origin: text("origin").notNull(),
    canceled: integer("canceled", { mode: "boolean" }).notNull().default(false),
    tradeId: text("trade_id").references(() => trades.id),
    legId: text("leg_id"),
    /** The source row as JSON, for audit. */
    raw: text("raw").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("fills_account_time_idx").on(table.accountId, table.executedAt),
    index("fills_trade_idx").on(table.tradeId),
  ],
);

/** The last sync run of a source. Keyed by source: a run can fail before any account is known. */
export const syncState = sqliteTable("sync_state", {
  /** 'ibkr' */
  source: text("source").primaryKey(),
  accountId: text("account_id").references(() => accounts.id),
  lastRunAt: integer("last_run_at").notNull(),
  /** 'ok' | 'error' */
  lastStatus: text("last_status").notNull(),
  lastError: text("last_error"),
  /** The run's summary, as JSON. */
  lastSummary: text("last_summary"),
});

/** Cached bars (trade-chart spec §5): finished days only, never exported. `t` is the bar's start. */
export const bars = sqliteTable(
  "bars",
  {
    symbol: text("symbol").notNull(),
    /** '1m' | '1d' */
    timeframe: text("timeframe").notNull(),
    t: integer("t").notNull(),
    o: real("o").notNull(),
    h: real("h").notNull(),
    l: real("l").notNull(),
    c: real("c").notNull(),
    v: real("v").notNull(),
  },
  (table) => [primaryKey({ columns: [table.symbol, table.timeframe, table.t] })],
);

/** The finished days a symbol's bars were fetched for, empty ones (weekends, holidays) included. */
export const barDays = sqliteTable(
  "bar_days",
  {
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    /** YYYY-MM-DD, New York */
    date: text("date").notNull(),
    count: integer("count").notNull(),
    fetchedAt: integer("fetched_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.symbol, table.timeframe, table.date] })],
);
