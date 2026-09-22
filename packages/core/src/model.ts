import { z } from "zod";

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
  putWingStrike: z.number().positive(),
  callWingStrike: z.number().positive(),
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
  fees: z.number().min(0),
  notes: z.string().max(10_000).nullable(),
  grade: z.enum(GRADES).nullable(),
  excluded: z.boolean(),
  excludeReason: z.string().max(200).nullable(),
  source: z.enum(SOURCES),
  setupId: z.uuid().nullable(),
  tagIds: z.array(z.uuid()),
  legs: z.array(legInputSchema).max(8),
  ironFly: ironFlyDetailsSchema.nullish(),
};

/** Creation takes the same fields, with everything optional defaulted. */
const newTradeShape = z.object({
  ...tradeFields,
  underlyingName: tradeFields.underlyingName.default(null),
  structureLabel: tradeFields.structureLabel.default(null),
  closedAt: tradeFields.closedAt.default(null),
  netPnl: tradeFields.netPnl.default(null),
  fees: tradeFields.fees.default(0),
  notes: tradeFields.notes.default(null),
  grade: tradeFields.grade.default(null),
  excluded: tradeFields.excluded.default(false),
  excludeReason: tradeFields.excludeReason.default(null),
  source: tradeFields.source.default("manual"),
  setupId: tradeFields.setupId.default(null),
  tagIds: tradeFields.tagIds.default([]),
  legs: tradeFields.legs.default([]),
  ironFly: tradeFields.ironFly.default(null),
});

export const newTradeSchema = newTradeShape
  .refine((trade) => trade.closedAt === null || trade.closedAt >= trade.openedAt, {
    message: "closedAt must be at or after openedAt",
    path: ["closedAt"],
  })
  .refine((trade) => trade.strategy !== "iron_fly" || trade.ironFly != null, {
    message: "iron_fly trades require ironFly details",
    path: ["ironFly"],
  });

/** Every field optional, no defaults; `source` is provenance and is never patched. */
export const tradePatchSchema = z.object(tradeFields).omit({ source: true }).partial();

export type LegInput = z.infer<typeof legInputSchema>;
export type IronFlyDetailsInput = z.infer<typeof ironFlyDetailsSchema>;
export type NewTrade = z.infer<typeof newTradeSchema>;
export type TradePatch = z.infer<typeof tradePatchSchema>;
