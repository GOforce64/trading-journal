import { z } from "zod";
import { DIRECTIONS } from "./missed.js";
import { LEVEL_BASES } from "./review.js";

export const STRATEGIES = ["scalp", "iron_fly"] as const;
export const BOOKS = ["live", "paper", "missed"] as const;
export const GRADES = ["A", "B", "C", "D", "F"] as const;
export const SOURCES = ["ibkr_flex", "csv_import", "oquants_extract", "manual"] as const;

export type Strategy = (typeof STRATEGIES)[number];
export type Book = (typeof BOOKS)[number];
export type Grade = (typeof GRADES)[number];
export type TradeSource = (typeof SOURCES)[number];
export type OptionRight = "C" | "P";

const epochMs = z.number().int().positive();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const legInputSchema = z.object({
  right: z.enum(["C", "P"]),
  strike: z.number().positive(),
  expiry: isoDate,
  /** Signed: negative is short, positive is long. Never zero. */
  quantity: z
    .number()
    .int()
    .refine((quantity) => quantity !== 0, "quantity cannot be zero"),
  multiplier: z.number().positive().default(100),
  openPrice: z.number().min(0),
  closePrice: z.number().min(0).nullable().default(null),
});

export const ironFlyDetailsSchema = z.object({
  bodyPutStrike: z.number().positive(),
  bodyCallStrike: z.number().positive(),
  /** 0 marks a 1-wing trade: with no long put, the stock going to zero caps the put side. */
  putWingStrike: z.number().nonnegative(),
  /** Null when there is no long call: the upside is uncapped, so max loss is undefined. */
  callWingStrike: z.number().positive().nullable(),
  contracts: z.number().int().positive(),
  /** Gross credit per share, before fees. */
  creditPerShare: z.number(),
  /** Cash flow at open; negative means credit received. */
  netCost: z.number().nullable().default(null),
  earningsDate: isoDate.nullable().default(null),
  earningsTiming: z.enum(["BMO", "AMC"]).nullable().default(null),
  impliedMovePct: z.number().nullable().default(null),
  actualMovePct: z.number().nullable().default(null),
  ivBefore: z.number().nullable().default(null),
  ivAfter: z.number().nullable().default(null),
  sourceNotes: z.string().nullable().default(null),
});

/** A missed trade's levels (missed-trades spec §3); its entry and exit times are `openedAt` and `closedAt`. */
export const missedLevelsSchema = z.object({
  direction: z.enum(DIRECTIONS),
  entryPrice: z.number().positive(),
  stopPrice: z.number().positive().nullable(),
  targetPrice: z.number().positive().nullable(),
  exitPrice: z.number().positive().nullable(),
});

/**
 * The fields of a trade, without creation defaults. A patch must carry defaults
 * nowhere: parsing `{ grade: "B" }` against a defaulted shape would fill in
 * `legs: []` and `excluded: false`, so a one-field PATCH would wipe the rest.
 */
const tradeFields = {
  strategy: z.enum(STRATEGIES),
  book: z.enum(BOOKS),
  underlying: z
    .string()
    .trim()
    .min(1)
    .max(12)
    .transform((symbol) => symbol.toUpperCase()),
  underlyingName: z.string().trim().max(120).nullable(),
  structureLabel: z.string().trim().max(60).nullable(),
  openedAt: epochMs,
  closedAt: epochMs.nullable(),
  netPnl: z.number().nullable(),
  // Negative is a rebate: IBKR credits some exchanges' fees, so one side's net commission can be a credit.
  fees: z.number(),
  feesOpen: z.number().nullable(),
  feesClose: z.number().nullable(),
  notes: z.string().max(10_000).nullable(),
  grade: z.enum(GRADES).nullable(),
  excluded: z.boolean(),
  excludeReason: z.string().max(200).nullable(),
  source: z.enum(SOURCES),
  setupId: z.uuid().nullable(),
  tagIds: z.array(z.uuid()),
  legs: z.array(legInputSchema).max(8),
  ironFly: ironFlyDetailsSchema.nullish(),
  missed: missedLevelsSchema.nullish(),
};

/** Creation takes the same fields, with everything optional defaulted. */
const newTradeShape = z.object({
  ...tradeFields,
  underlyingName: tradeFields.underlyingName.default(null),
  structureLabel: tradeFields.structureLabel.default(null),
  closedAt: tradeFields.closedAt.default(null),
  netPnl: tradeFields.netPnl.default(null),
  fees: tradeFields.fees.default(0),
  feesOpen: tradeFields.feesOpen.default(null),
  feesClose: tradeFields.feesClose.default(null),
  notes: tradeFields.notes.default(null),
  grade: tradeFields.grade.default(null),
  excluded: tradeFields.excluded.default(false),
  excludeReason: tradeFields.excludeReason.default(null),
  source: tradeFields.source.default("manual"),
  setupId: tradeFields.setupId.default(null),
  tagIds: tradeFields.tagIds.default([]),
  legs: tradeFields.legs.default([]),
  ironFly: tradeFields.ironFly.default(null),
  missed: tradeFields.missed.default(null),
});

export const newTradeSchema = newTradeShape
  .refine((trade) => trade.closedAt === null || trade.closedAt >= trade.openedAt, {
    message: "closedAt must be at or after openedAt",
    path: ["closedAt"],
  })
  .refine((trade) => trade.strategy !== "iron_fly" || trade.ironFly != null, {
    message: "iron_fly trades require ironFly details",
    path: ["ironFly"],
  })
  // Missed trades (missed-trades spec §3, §5): scalps with no fills or P&L, scored from their own levels.
  .refine((trade) => trade.book !== "missed" || trade.missed != null, {
    message: "missed trades need missed details",
    path: ["missed"],
  })
  .refine((trade) => trade.book === "missed" || trade.missed == null, {
    message: "only a missed trade has missed details",
    path: ["missed"],
  })
  .refine(
    (trade) =>
      trade.book !== "missed" ||
      (trade.strategy === "scalp" &&
        trade.legs.length === 0 &&
        trade.netPnl == null &&
        trade.ironFly == null),
    { message: "a missed trade is a scalp with no legs or P&L", path: ["book"] },
  )
  .refine((trade) => trade.missed == null || (trade.missed.exitPrice == null) === (trade.closedAt == null), {
    message: "an exit needs both a time and a price",
    path: ["closedAt"],
  });

/** A profit target on the trade's basis, trimming whole contracts (scalp-R spec §8). */
export const scalpTargetSchema = z.object({
  price: z.number().min(0),
  contracts: z.number().int().min(1),
});

/**
 * A scalp's levels (scalp-review spec §6.2, scalp-R spec §8), merged into what's stored. The repository checks the
 * rest on write: a stock price above 0, an override above 0, and the targets trimming no more than the position.
 */
export const scalpLevelsPatchSchema = z
  .object({
    levelBasis: z.enum(LEVEL_BASES),
    stopPrice: z.number().min(0).nullable(),
    /** The whole list; [] clears it. */
    targets: z.array(scalpTargetSchema).max(10),
    /** Typed over the fetched stock price at entry. */
    stockEntryOverride: z.number().nullable(),
    /** Typed over the model's planned risk, in dollars. */
    riskOverride: z.number().nullable(),
  })
  .partial();

/** Every field optional, no defaults; `source` is provenance and is never patched. */
export const tradePatchSchema = z.object(tradeFields).omit({ source: true }).partial().extend({
  /** Part of a missed trade's levels; the repository checks the result against the stored row. */
  missed: missedLevelsSchema.partial().optional(),
  scalp: scalpLevelsPatchSchema.optional(),
  /** true stamps the trade reviewed with the server's clock; false puts it back in the queue. */
  reviewed: z.boolean().optional(),
});

export type LegInput = z.infer<typeof legInputSchema>;
export type IronFlyDetailsInput = z.infer<typeof ironFlyDetailsSchema>;
export type NewTrade = z.infer<typeof newTradeSchema>;
export type TradePatch = z.infer<typeof tradePatchSchema>;
