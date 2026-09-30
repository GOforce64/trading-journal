import { nyWallClock } from "@tj/core";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

export type FillKind = "trade" | "expiration" | "exercise" | "assignment";

/** One execution or booking, the same shape whichever statement it came from (spec §6.2). */
export interface ParsedFill {
  /** The execution id, or `trade-{tradeID}` for a booking that has none. */
  key: string;
  tradeId: string;
  orderId: string | null;
  conid: string;
  underlying: string;
  right: "C" | "P";
  strike: number;
  /** YYYY-MM-DD */
  expiry: string;
  multiplier: number;
  /** YYYY-MM-DD, New York */
  tradeDate: string;
  executedAt: number;
  /** Signed: + bought, − sold. */
  quantity: number;
  price: number;
  /** Positive dollars. */
  commission: number;
  openClose: "O" | "C" | null;
  kind: FillKind;
  raw: Record<string, string>;
}

/** A cancel names the fill it undoes by trade id, size and price: IBKR books corrections under the same trade id. */
export interface CancelRef {
  tradeId: string;
  quantity: number;
  price: number;
  /** YYYY-MM-DD, New York: a cancel before the start date names a fill that was never stored. */
  tradeDate: string;
}

export interface FlexStatementData {
  accountId: string;
  kind: "activity" | "confirm";
  fromDate: string;
  toDate: string;
  fills: ParsedFill[];
  cancels: CancelRef[];
  ignored: { stock: number; other: number; malformed: number };
}

export class FlexParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlexParseError";
  }
}

type Row = Record<string, string>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  // Ids like 1785797699 must stay strings.
  parseAttributeValue: false,
  parseTagValue: false,
});

const asArray = <T>(value: T | T[] | undefined | ""): T[] =>
  value === undefined || value === "" ? [] : Array.isArray(value) ? value : [value];

const ymd = (value: string) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;

/** IBKR's `20260716;135242`, New York time, as epoch ms. A date alone is a booking, made at 16:20. */
export function flexTime(value: string): number {
  const [date = "", time = "162000"] = value.split(";");
  const hours = Number(time.slice(0, 2));
  const minutes = Number(time.slice(2, 4));
  const seconds = Number(time.slice(4, 6));
  return nyWallClock(ymd(date), hours * 60 + minutes) + seconds * 1000;
}

const numeric = z
  .string()
  .trim()
  .min(1)
  .transform(Number)
  .refine((value) => Number.isFinite(value), "not a number");

const optionRow = z.object({
  conid: z.string().min(1),
  underlyingSymbol: z.string().min(1),
  putCall: z.enum(["C", "P"]),
  strike: numeric,
  expiry: z.string().regex(/^\d{8}$/),
  multiplier: numeric,
  quantity: numeric.refine((value) => value !== 0, "zero quantity"),
  dateTime: z.string().regex(/^\d{8}(;\d{6})?$/),
  tradeDate: z.string().regex(/^\d{8}$/),
  tradeID: z.string().min(1),
});
type OptionRow = z.infer<typeof optionRow>;

const openCloseOf = (values: string[]): "O" | "C" | null =>
  values.includes("O") ? "O" : values.includes("C") ? "C" : null;

// `-Number("0")` is −0, which would never equal 0 in a test or a comparison.
const commissionOf = (value: string | undefined) => -Number(value || 0) || 0;

function toFill(
  base: OptionRow,
  row: Row,
  extra: Pick<ParsedFill, "key" | "orderId" | "price" | "commission" | "openClose" | "kind">,
): ParsedFill {
  return {
    ...extra,
    tradeId: base.tradeID,
    conid: base.conid,
    underlying: base.underlyingSymbol,
    right: base.putCall,
    strike: base.strike,
    expiry: ymd(base.expiry),
    multiplier: base.multiplier,
    tradeDate: ymd(base.tradeDate),
    executedAt: flexTime(base.dateTime),
    quantity: base.quantity,
    raw: row,
  };
}

/** An Activity `<Trade>` row: null when malformed, "other" when it isn't a fill this app keeps. */
function activityFill(row: Row, marks: Map<string, string>, ignored: FlexStatementData["ignored"]) {
  const parsed = optionRow.safeParse(row);
  if (!parsed.success) return null;
  const notes = (row.notes ?? "").split(";");
  let kind: FillKind;
  if (row.transactionType === "ExchTrade") kind = "trade";
  else if (row.transactionType === "BookTrade" && notes.includes("Ep")) kind = "expiration";
  else if (row.transactionType === "BookTrade" && notes.includes("Ex")) kind = "exercise";
  else if (row.transactionType === "BookTrade" && notes.includes("A")) kind = "assignment";
  else return "other" as const;

  let price = Number(row.tradePrice);
  if (kind === "exercise" || kind === "assignment") {
    // IBKR books these at $0; the leg's value at expiry is the mark on its OptionEAE row.
    const mark = Number(marks.get(parsed.data.tradeID));
    if (Number.isFinite(mark) && marks.has(parsed.data.tradeID)) price = mark;
    else {
      ignored.malformed++;
      price = 0;
    }
  }
  if (!Number.isFinite(price)) return null;
  return toFill(parsed.data, row, {
    key: row.ibExecID || `trade-${parsed.data.tradeID}`,
    orderId: row.ibOrderID || null,
    price,
    commission: commissionOf(row.ibCommission),
    openClose: openCloseOf((row.openCloseIndicator ?? "").split(";")),
    kind,
  });
}

/** A Trade Confirmation `<TradeConfirm>` row. */
function confirmFill(row: Row) {
  if (row.transactionType !== "ExchTrade") return "other" as const;
  const parsed = optionRow.safeParse(row);
  const price = Number(row.price);
  if (!parsed.success || !row.execID || !Number.isFinite(price)) return null;
  return toFill(parsed.data, row, {
    key: row.execID,
    orderId: row.orderID || null,
    price,
    commission: commissionOf(row.commission),
    openClose: openCloseOf((row.code ?? "").split(";")),
    kind: "trade",
  });
}

/** A cancel from either statement: Activity's rows name the price `tradePrice`, Today's name it `price`. */
function cancelOf(row: Row): CancelRef | null {
  const quantity = -Number(row.quantity);
  const price = Number(row.tradePrice ?? row.price);
  if (
    !row.origTradeID ||
    !Number.isFinite(quantity) ||
    quantity === 0 ||
    !Number.isFinite(price) ||
    !/^\d{8}$/.test(row.tradeDate ?? "")
  )
    return null;
  return { tradeId: row.origTradeID, quantity, price, tradeDate: ymd(row.tradeDate ?? "") };
}

/** One Flex statement, Activity or Trade Confirmation, as fills (spec §6.2). */
export function parseFlex(xml: string): FlexStatementData {
  let doc: { FlexQueryResponse?: { type?: string; FlexStatements?: { FlexStatement?: unknown } } };
  try {
    doc = parser.parse(xml);
  } catch {
    throw new FlexParseError("IBKR sent something that isn't XML.");
  }
  const response = doc.FlexQueryResponse;
  if (!response) throw new FlexParseError("IBKR sent something that isn't a Flex statement.");
  const kind = response.type === "AF" ? "activity" : response.type === "TCF" ? "confirm" : null;
  if (!kind)
    throw new FlexParseError("The Flex query is neither an Activity nor a Trade Confirmation query.");
  const statements = asArray(response.FlexStatements?.FlexStatement) as Record<string, unknown>[];
  if (statements.length > 1) {
    throw new FlexParseError("The Flex query covers more than one account; make one query per account.");
  }
  const statement = statements[0];
  if (!statement) throw new FlexParseError("The Flex statement names no account.");

  // A section is one holder element (or none, or "" when empty) whose rows are one element or many.
  type Holder = Record<string, Row | Row[] | "">;
  const section = (name: string, rowName: string): Row[] =>
    asArray<Holder>((statement[name] as Holder | "" | undefined) || undefined).flatMap((holder) =>
      asArray<Row>(holder[rowName]),
    );
  const marks = new Map(
    section("OptionEAE", "OptionEAE").map((row) => [row.tradeID ?? "", row.markPrice ?? ""]),
  );
  const rows = kind === "activity" ? section("Trades", "Trade") : section("TradeConfirms", "TradeConfirm");

  const ignored = { stock: 0, other: 0, malformed: 0 };
  const fills: ParsedFill[] = [];
  const cancels: CancelRef[] = [];
  for (const row of rows) {
    if (row.assetCategory !== "OPT") {
      if (row.assetCategory === "STK") ignored.stock++;
      else ignored.other++;
      continue;
    }
    if (row.levelOfDetail && row.levelOfDetail !== "EXECUTION") {
      ignored.other++;
      continue;
    }
    if (row.transactionType === "TradeCancel") {
      const cancel = cancelOf(row);
      if (cancel) cancels.push(cancel);
      else ignored.malformed++;
      continue;
    }
    const fill = kind === "activity" ? activityFill(row, marks, ignored) : confirmFill(row);
    if (fill === "other") ignored.other++;
    else if (fill === null) ignored.malformed++;
    else fills.push(fill);
  }
  return {
    accountId: String(statement.accountId ?? ""),
    kind,
    fromDate: ymd(String(statement.fromDate ?? "")),
    toDate: ymd(String(statement.toDate ?? "")),
    fills,
    cancels,
    ignored,
  };
}
