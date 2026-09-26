import {
  closeEstimate,
  ironFlyMetrics,
  ironFlyStructureFromLegs,
  type MarkableLeg,
  type OptionQuote,
  type PricedLeg,
  positionCash,
} from "@tj/core";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ESTIMATE_STYLE, estimateTitle, signedUsd } from "../components/Estimate.js";
import { Money, Panel } from "../components/ui.js";
import {
  openContracts,
  TICKER,
  todayNy,
  useChain,
  useCompanyName,
  useOptionQuotes,
  useQuotes,
  useSettled,
} from "../market.js";
import { ExpirySelect, nearestStrike, StrikeSelect } from "./ChainPickers.js";

/** The four legs of a short iron butterfly, in the order oQuants shows them. */
const LEG_ROLES = [
  { key: "shortCall", label: "Short call", right: "C", short: true },
  { key: "shortPut", label: "Short put", right: "P", short: true },
  { key: "longCall", label: "Long call", right: "C", short: false },
  { key: "longPut", label: "Long put", right: "P", short: false },
] as const;

type LegKey = (typeof LEG_ROLES)[number]["key"];

const FIELD_LABEL = "flex flex-col gap-1 text-[10px] text-muted uppercase tracking-wider";
const NO_QUOTES = new Map<string, OptionQuote>();

export interface LegFields {
  strike: string;
  size: string;
  entry: string;
  exit: string;
}

export interface IronFlyFormValues {
  underlying: string;
  underlyingName: string;
  structureLabel: string;
  book: "live" | "paper";
  openedAt: string;
  closedAt: string;
  expiry: string;
  feesOpen: string;
  feesClose: string;
  notes: string;
  legs: Record<LegKey, LegFields>;
}

const EMPTY_LEG: LegFields = { strike: "", size: "", entry: "", exit: "" };

const EMPTY: IronFlyFormValues = {
  underlying: "",
  underlyingName: "",
  structureLabel: "Short Iron Butterfly",
  book: "live",
  openedAt: "",
  closedAt: "",
  expiry: "",
  feesOpen: "0",
  feesClose: "0",
  notes: "",
  legs: { shortCall: EMPTY_LEG, shortPut: EMPTY_LEG, longCall: EMPTY_LEG, longPut: EMPTY_LEG },
};

const num = (value: string): number => (value.trim() === "" ? Number.NaN : Number(value));
const zeroIfBlank = (value: string): number => (Number.isNaN(num(value)) ? 0 : num(value));
const millis = (value: string): number => (value ? new Date(value).getTime() : Number.NaN);
const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

const isBlank = (fields: LegFields) => Object.values(fields).every((value) => value.trim() === "");

/** Legs are only priced once strike, size and entry are all present. */
function toPricedLegs(values: IronFlyFormValues): PricedLeg[] | null | "fractional-size" {
  const legs: PricedLeg[] = [];
  for (const role of LEG_ROLES) {
    const fields = values.legs[role.key];
    // A 1-wing trade leaves one long leg blank; the structure check rejects both.
    if (!role.short && isBlank(fields)) continue;
    const strike = num(fields.strike);
    const size = num(fields.size);
    const entry = num(fields.entry);
    if (Number.isNaN(strike) || Number.isNaN(size) || size <= 0 || Number.isNaN(entry)) return null;
    if (!Number.isInteger(size)) return "fractional-size";
    const exit = num(fields.exit);
    legs.push({
      right: role.right,
      strike,
      quantity: role.short ? -size : size,
      multiplier: 100,
      openPrice: entry,
      closePrice: Number.isNaN(exit) ? null : exit,
    });
  }
  return legs;
}

export interface IronFlyFormProps {
  initial?: Partial<IronFlyFormValues>;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (payload: Record<string, unknown>) => void;
}

export function IronFlyForm({ initial, submitLabel, busy, error, onSubmit }: IronFlyFormProps) {
  const [values, setValues] = useState<IronFlyFormValues>({
    ...EMPTY,
    ...initial,
    legs: { ...EMPTY.legs, ...initial?.legs },
  });
  const [problem, setProblem] = useState<string | null>(null);
  /** The user chose to type the expiry and strikes although a chain is available. */
  const [typed, setTyped] = useState(false);
  const [cleared, setCleared] = useState<string | null>(null);

  const set = (key: keyof IronFlyFormValues) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  const setLegValue = (key: LegKey, field: keyof LegFields, value: string) =>
    setValues((current) => ({
      ...current,
      legs: { ...current.legs, [key]: { ...current.legs[key], [field]: value } },
    }));

  const setLeg = (key: LegKey, field: keyof LegFields) => (event: { target: { value: string } }) =>
    setLegValue(key, field, event.target.value);

  // The chain from the open date on, so an old trade can still pick its expired contracts (spec §8).
  const symbol = useSettled(values.underlying.trim().toUpperCase());
  const today = todayNy();
  const openedOn = values.openedAt ? values.openedAt.slice(0, 10) : today;
  const chain = useChain(symbol, openedOn < today ? openedOn : undefined);
  const expirations = chain.data?.expirations ?? [];
  const pickers = !typed && expirations.length > 0;
  const strikes = expirations.find((expiration) => expiration.date === values.expiry)?.strikes ?? [];
  const { data: stockQuotes } = useQuotes(pickers && openedOn === today ? [symbol] : []);
  const atm = nearestStrike(strikes, stockQuotes?.[symbol]?.price);

  // Fill a blank Company from Alpaca, or replace a name this form filled in for another symbol, clearing
  // it when the new symbol has none. A name typed by hand is never touched.
  const company = useCompanyName(symbol);
  const autoName = useRef<string | null>(null);
  const companySettled = !TICKER.test(symbol) || company.isSuccess || company.isError;
  const companyName = company.isSuccess ? company.data : null;
  useEffect(() => {
    if (!companySettled) return;
    const previous = autoName.current;
    autoName.current = companyName;
    setValues((current) => {
      const untouched =
        current.underlyingName.trim() === "" || (previous !== null && current.underlyingName === previous);
      const next = companyName ?? "";
      return untouched && current.underlyingName !== next ? { ...current, underlyingName: next } : current;
    });
  }, [companySettled, companyName]);

  /** Switching expiry keeps the strikes it lists and clears the others, naming them. */
  function pickExpiry(expiry: string) {
    const listed = new Set(
      (expirations.find((expiration) => expiration.date === expiry)?.strikes ?? []).map(String),
    );
    const dropped = expiry
      ? LEG_ROLES.filter((role) => {
          const strike = values.legs[role.key].strike;
          return strike !== "" && !listed.has(strike);
        })
      : [];
    setValues((current) => {
      const legs = { ...current.legs };
      for (const role of dropped) legs[role.key] = { ...legs[role.key], strike: "" };
      return { ...current, expiry, legs };
    });
    setCleared(
      dropped.length > 0
        ? `Cleared strikes not listed for ${expiry}: ${dropped.map((role) => role.label.toLowerCase()).join(", ")}.`
        : null,
    );
  }

  const derived = useMemo(() => {
    const legs = toPricedLegs(values);
    if (!legs || legs === "fractional-size") return null;
    const cash = positionCash(legs, {
      open: zeroIfBlank(values.feesOpen),
      close: zeroIfBlank(values.feesClose),
    });
    const structure = ironFlyStructureFromLegs(legs);
    const callWingStrike = structure?.callWingStrike ?? null;
    // Without a call wing the upside is uncapped, so there is no max loss to show.
    const metrics =
      structure && callWingStrike !== null
        ? ironFlyMetrics({
            ...structure,
            callWingStrike,
            contracts: cash.contracts,
            creditPerShare: -(cash.netCost - cash.fees) / cash.shares,
            fees: cash.fees,
          })
        : null;
    return { legs, cash, structure, metrics };
  }, [values]);

  // What closing the open legs now would realise: exit-field hints and a Derived row, never a value (spec §8).
  const markLegs = useMemo<MarkableLeg[]>(
    () =>
      values.expiry && derived
        ? derived.legs.map((leg) => ({
            right: leg.right,
            strike: leg.strike,
            expiry: values.expiry,
            quantity: leg.quantity,
            multiplier: leg.multiplier ?? 100,
            openPrice: leg.openPrice,
            closePrice: leg.closePrice ?? null,
          }))
        : [],
    [derived, values.expiry],
  );
  const markTrade = {
    underlying: symbol,
    legs: markLegs,
    fees: derived?.cash.fees ?? 0,
    feesOpen: zeroIfBlank(values.feesOpen),
    feesClose: zeroIfBlank(values.feesClose),
  };
  const { data: optionQuotes } = useOptionQuotes(openContracts(markTrade, today));
  const estimate =
    markLegs.length > 0 ? closeEstimate(markTrade, optionQuotes?.quotes ?? NO_QUOTES, today) : null;
  const markFor = (role: (typeof LEG_ROLES)[number]) => {
    if (estimate?.kind !== "estimate") return undefined;
    const index = markLegs.findIndex((leg) => leg.right === role.right && leg.quantity < 0 === role.short);
    return estimate.legs.find((marked) => marked.index === index)?.mark.toFixed(2);
  };

  function submit() {
    if (toPricedLegs(values) === "fractional-size") {
      setProblem("Sizes are whole contracts.");
      return;
    }
    if (!derived?.structure) {
      setProblem("Every leg needs a strike, a size and an entry price, and at least one wing is required.");
      return;
    }
    if (!values.expiry) {
      setProblem("An expiry is required.");
      return;
    }
    setProblem(null);
    const { cash, structure, legs } = derived;
    onSubmit({
      strategy: "iron_fly",
      book: values.book,
      underlying: values.underlying,
      underlyingName: values.underlyingName || null,
      structureLabel: values.structureLabel || "Short Iron Butterfly",
      openedAt: Number.isNaN(millis(values.openedAt)) ? Date.now() : millis(values.openedAt),
      closedAt: Number.isNaN(millis(values.closedAt)) ? null : millis(values.closedAt),
      netPnl: cash.netPnl,
      fees: cash.fees,
      feesOpen: zeroIfBlank(values.feesOpen),
      feesClose: zeroIfBlank(values.feesClose),
      notes: values.notes || null,
      legs: legs.map((leg) => ({
        right: leg.right,
        strike: leg.strike,
        expiry: values.expiry,
        quantity: leg.quantity,
        multiplier: 100,
        openPrice: leg.openPrice,
        closePrice: leg.closePrice ?? null,
      })),
      ironFly: {
        ...structure,
        contracts: cash.contracts,
        creditPerShare: -(cash.netCost - cash.fees) / cash.shares,
        netCost: cash.netCost,
      },
    });
  }

  const input = (
    label: string,
    value: string,
    onChange: (e: { target: { value: string } }) => void,
    type = "text",
  ) => (
    <label className="flex flex-col gap-1 text-[10px] text-muted uppercase tracking-wider">
      {label}
      <input
        aria-label={label}
        type={type}
        value={value}
        onChange={onChange}
        className="num rounded-sm border border-line bg-[#0e1118] px-2 py-1 text-[13px] text-fg outline-none focus:border-accent"
      />
    </label>
  );

  const legInput = (key: LegKey, label: string, field: keyof LegFields, placeholder?: string) => (
    <input
      aria-label={label}
      type="number"
      step={field === "size" ? "1" : "0.01"}
      min={field === "size" ? 1 : undefined}
      value={values.legs[key][field]}
      placeholder={placeholder}
      onChange={setLeg(key, field)}
      className="num w-full rounded-sm border border-line bg-[#0e1118] px-2 py-1 text-right text-[13px] text-fg outline-none placeholder:text-[#4a5163] placeholder:italic focus:border-accent"
    />
  );

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
      <div className="flex flex-col gap-3">
        <Panel title="Trade">
          <div className="grid grid-cols-3 gap-2">
            {input("Underlying", values.underlying, set("underlying"))}
            {input("Company", values.underlyingName, set("underlyingName"))}
            {pickers ? (
              <div className="flex flex-col gap-1">
                <label htmlFor="expiry-select" className={FIELD_LABEL}>
                  Expiry
                  <ExpirySelect
                    id="expiry-select"
                    value={values.expiry}
                    expirations={expirations}
                    from={openedOn}
                    onChange={pickExpiry}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setTyped(true)}
                  className="self-start text-[10px] text-accent"
                >
                  type instead
                </button>
              </div>
            ) : (
              input("Expiry", values.expiry, set("expiry"), "date")
            )}
            {input("Opened", values.openedAt, set("openedAt"), "datetime-local")}
            {input("Closed", values.closedAt, set("closedAt"), "datetime-local")}
            <label className="flex flex-col gap-1 text-[10px] text-muted uppercase tracking-wider">
              Book
              <select
                aria-label="Book"
                value={values.book}
                onChange={set("book")}
                className="rounded-sm border border-line bg-[#0e1118] px-2 py-1 text-[13px] text-fg outline-none focus:border-accent"
              >
                <option value="live">Live</option>
                <option value="paper">Paper</option>
              </select>
            </label>
          </div>
          {!typed && chain.data?.unavailable && (
            <p className="mt-2 text-[10px] text-muted">{chain.data.unavailable.message}</p>
          )}
          {typed && expirations.length > 0 && (
            <p className="mt-2 text-[10px] text-muted">
              Typing the expiry and strikes.{" "}
              <button type="button" onClick={() => setTyped(false)} className="text-accent">
                pick from the chain
              </button>
            </p>
          )}
          {pickers && cleared && <p className="mt-2 text-[10px] text-muted">{cleared}</p>}
        </Panel>

        <Panel title="Position">
          <table className="w-full border-collapse text-[11px]">
            <thead className="text-[9px] text-muted uppercase tracking-wider">
              <tr>
                <th className="w-28 py-1 text-left font-medium">Leg</th>
                <th className="text-right font-medium">Strike</th>
                <th className="text-right font-medium">Size</th>
                <th className="text-right font-medium">Entry premium</th>
                <th className="text-right font-medium">Exit premium</th>
                <th className="w-24 text-right font-medium">Cash</th>
              </tr>
            </thead>
            <tbody>
              {LEG_ROLES.map((role) => {
                const leg = derived?.legs.find(
                  (candidate) => candidate.right === role.right && candidate.quantity < 0 === role.short,
                );
                return (
                  <tr key={role.key} className="border-line border-t">
                    <td className={`py-1 ${role.short ? "text-down" : "text-up"}`}>{role.label}</td>
                    <td className="px-1">
                      {pickers ? (
                        <StrikeSelect
                          label={`${role.label} strike`}
                          value={values.legs[role.key].strike}
                          strikes={strikes}
                          atm={atm}
                          onChange={(strike) => setLegValue(role.key, "strike", strike)}
                        />
                      ) : (
                        legInput(role.key, `${role.label} strike`, "strike")
                      )}
                    </td>
                    <td className="px-1">{legInput(role.key, `${role.label} size`, "size")}</td>
                    <td className="px-1">{legInput(role.key, `${role.label} entry`, "entry")}</td>
                    <td className="px-1">
                      {legInput(role.key, `${role.label} exit`, "exit", markFor(role))}
                    </td>
                    <td className="text-right">
                      <Money value={leg ? leg.quantity * 100 * leg.openPrice : null} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-1 text-[10px] text-muted">
            Leave one long leg blank for a 1-wing trade: a missing put wing counts as strike 0, a missing call
            wing leaves max loss empty.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {input("Entry fees", values.feesOpen, set("feesOpen"), "number")}
            {input("Exit fees", values.feesClose, set("feesClose"), "number")}
          </div>
          <label className="mt-2 flex flex-col gap-1 text-[10px] text-muted uppercase tracking-wider">
            Notes
            <textarea
              aria-label="Notes"
              value={values.notes}
              onChange={set("notes")}
              className="min-h-16 rounded-sm border border-line bg-[#0e1118] px-2 py-1 text-[13px] text-fg outline-none focus:border-accent"
            />
          </label>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="mt-3 rounded-sm bg-accent px-3 py-1.5 text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : submitLabel}
          </button>
          {problem && <p className="mt-2 text-down">{problem}</p>}
          {error && <p className="mt-2 text-down">{error}</p>}
        </Panel>
      </div>

      <Panel title="Derived">
        {!derived && <p className="text-muted">Price the legs to see the numbers.</p>}
        {derived && (
          <dl className="grid gap-1" data-testid="derived">
            <Row label="Net cost">
              <Money value={derived.cash.netCost} />
            </Row>
            <Row label="Credit / share">{derived.cash.creditPerShare.toFixed(2)}</Row>
            <Row label="P&L before fees">
              <Money value={derived.cash.grossPnl} />
            </Row>
            <Row label="Fees">{usd(derived.cash.fees)}</Row>
            <Row label="Net P&L">
              <span data-testid="derived-net-pnl">
                <Money value={derived.cash.netPnl} />
              </span>
            </Row>
            {estimate?.kind === "estimate" && (
              <Row label="Est. P&L if closed now">
                <span
                  data-testid="derived-estimate"
                  className={ESTIMATE_STYLE}
                  title={estimateTitle(estimate)}
                >
                  est {signedUsd(estimate.netPnl)}
                </span>
              </Row>
            )}
            {derived.metrics && (
              <>
                <Row label="Max profit">{usd(derived.metrics.maxProfit)}</Row>
                <Row label="Max loss">
                  {usd(derived.metrics.maxLoss)} ({derived.metrics.riskySide})
                </Row>
                <Row label="Other side">
                  {usd(
                    derived.metrics.riskySide === "call"
                      ? derived.metrics.putSideRisk
                      : derived.metrics.callSideRisk,
                  )}
                </Row>
                <Row label="Breakevens">
                  {derived.metrics.breakevenLow} / {derived.metrics.breakevenHigh}
                </Row>
                <Row label="Wings">
                  {derived.metrics.putWingWidth} / {derived.metrics.callWingWidth}
                  {derived.metrics.isBrokenWing ? " · broken" : ""}
                </Row>
              </>
            )}
          </dl>
        )}
      </Panel>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="num">{children}</dd>
    </div>
  );
}
