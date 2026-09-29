import { type PricedLeg, positionCash } from "@tj/core";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Money, Panel, Pct } from "../components/ui.js";
import { todayNy, useChain, useCompanyName, useSettled } from "../market.js";
import { ExpirySelect, StrikeSelect } from "./ChainPickers.js";

export interface ScalpFormValues {
  underlying: string;
  underlyingName: string;
  right: "C" | "P";
  expiry: string;
  strike: string;
  size: string;
  entry: string;
  exit: string;
  openedAt: string;
  closedAt: string;
  feesOpen: string;
  feesClose: string;
  book: "live" | "paper";
  notes: string;
}

const EMPTY: ScalpFormValues = {
  underlying: "",
  underlyingName: "",
  right: "C",
  expiry: "",
  strike: "",
  size: "1",
  entry: "",
  exit: "",
  openedAt: "",
  closedAt: "",
  feesOpen: "0",
  feesClose: "0",
  book: "paper",
  notes: "",
};

const FIELD = "flex flex-col gap-1 text-[10px] text-muted uppercase tracking-wider";
const INPUT =
  "num rounded-sm border border-line bg-[#0e1118] px-2 py-1 text-[13px] text-fg outline-none focus:border-accent";
const num = (value: string): number => (value.trim() === "" ? Number.NaN : Number(value));
const zeroIfBlank = (value: string): number => (Number.isNaN(num(value)) ? 0 : num(value));
const millis = (value: string): number => (value ? new Date(value).getTime() : Number.NaN);
const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

export interface ScalpFormProps {
  initial?: Partial<ScalpFormValues>;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  /** Shown above the form, e.g. that a synced trade's edits are kept. */
  notice?: ReactNode;
  onSubmit: (payload: Record<string, unknown>) => void;
}

/** One bought call or put, typed in or edited (spec §9.6). Money is derived from the prices, never typed twice. */
export function ScalpForm({ initial, submitLabel, busy, error, notice, onSubmit }: ScalpFormProps) {
  const [values, setValues] = useState<ScalpFormValues>({ ...EMPTY, ...initial });
  const [problem, setProblem] = useState<string | null>(null);
  const set = (key: keyof ScalpFormValues) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));
  const setValue = (key: keyof ScalpFormValues, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  const symbol = useSettled(values.underlying.trim().toUpperCase());
  const today = todayNy();
  const openedOn = values.openedAt ? values.openedAt.slice(0, 10) : today;
  const chain = useChain(symbol, openedOn < today ? openedOn : undefined);
  const expirations = chain.data?.expirations ?? [];
  const strikes = expirations.find((expiration) => expiration.date === values.expiry)?.strikes ?? [];

  // A blank Company is filled in from Alpaca; a typed one is never replaced.
  const company = useCompanyName(symbol);
  const companyName = company.isSuccess ? company.data : null;
  useEffect(() => {
    if (!companyName) return;
    setValues((current) =>
      current.underlyingName.trim() === "" ? { ...current, underlyingName: companyName } : current,
    );
  }, [companyName]);

  const derived = useMemo(() => {
    const size = num(values.size);
    const strike = num(values.strike);
    const entry = num(values.entry);
    if (Number.isNaN(size) || size <= 0 || Number.isNaN(strike) || Number.isNaN(entry)) return null;
    const exit = num(values.exit);
    const leg: PricedLeg = {
      right: values.right,
      strike,
      quantity: size,
      multiplier: 100,
      openPrice: entry,
      closePrice: Number.isNaN(exit) ? null : exit,
    };
    const cash = positionCash([leg], {
      open: zeroIfBlank(values.feesOpen),
      close: zeroIfBlank(values.feesClose),
    });
    const cost = size * 100 * entry;
    return { leg, cash, cost, returnOnCost: cash.netPnl != null && cost > 0 ? cash.netPnl / cost : null };
  }, [values]);

  function submit() {
    const size = num(values.size);
    if (!Number.isNaN(size) && !Number.isInteger(size)) {
      setProblem("Sizes are whole contracts.");
      return;
    }
    if (!derived || !values.expiry) {
      setProblem("A strike, an expiry, a size and an entry price are required.");
      return;
    }
    setProblem(null);
    const { leg, cash } = derived;
    onSubmit({
      strategy: "scalp",
      book: values.book,
      underlying: values.underlying,
      underlyingName: values.underlyingName || null,
      structureLabel: values.right === "C" ? "Long call" : "Long put",
      openedAt: Number.isNaN(millis(values.openedAt)) ? Date.now() : millis(values.openedAt),
      closedAt: Number.isNaN(millis(values.closedAt)) ? null : millis(values.closedAt),
      netPnl: cash.netPnl,
      fees: cash.fees,
      feesOpen: zeroIfBlank(values.feesOpen),
      feesClose: zeroIfBlank(values.feesClose),
      notes: values.notes || null,
      legs: [
        {
          right: leg.right,
          strike: leg.strike,
          expiry: values.expiry,
          quantity: leg.quantity,
          multiplier: 100,
          openPrice: leg.openPrice,
          closePrice: leg.closePrice ?? null,
        },
      ],
    });
  }

  const input = (label: string, key: keyof ScalpFormValues, type = "text") => (
    <label className={FIELD}>
      {label}
      <input aria-label={label} type={type} value={values[key]} onChange={set(key)} className={INPUT} />
    </label>
  );

  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_280px]">
      <Panel title="Scalp">
        {notice}
        <div className="grid grid-cols-3 gap-2">
          {input("Underlying", "underlying")}
          {input("Company", "underlyingName")}
          <label className={FIELD}>
            Call or put
            <select aria-label="Call or put" value={values.right} onChange={set("right")} className={INPUT}>
              <option value="C">Call</option>
              <option value="P">Put</option>
            </select>
          </label>
          {input("Opened", "openedAt", "datetime-local")}
          {expirations.length > 0 ? (
            <label htmlFor="scalp-expiry" className={FIELD}>
              Expiry
              <ExpirySelect
                id="scalp-expiry"
                value={values.expiry}
                expirations={expirations}
                from={openedOn}
                onChange={(expiry) => setValue("expiry", expiry)}
              />
            </label>
          ) : (
            input("Expiry", "expiry", "date")
          )}
          {strikes.length > 0 ? (
            // The select names itself ("Strike"); the caption is only visual.
            <div className={FIELD}>
              Strike
              <StrikeSelect
                label="Strike"
                value={values.strike}
                strikes={strikes}
                atm={null}
                onChange={(strike) => setValue("strike", strike)}
              />
            </div>
          ) : (
            input("Strike", "strike", "number")
          )}
          {input("Size", "size", "number")}
          {input("Entry price", "entry", "number")}
          {input("Exit price", "exit", "number")}
          {input("Closed", "closedAt", "datetime-local")}
          {input("Entry fees", "feesOpen", "number")}
          {input("Exit fees", "feesClose", "number")}
          <label className={FIELD}>
            Book
            <select aria-label="Book" value={values.book} onChange={set("book")} className={INPUT}>
              <option value="paper">Paper</option>
              <option value="live">Live</option>
            </select>
          </label>
        </div>
        {!chain.isLoading && expirations.length === 0 && chain.data?.unavailable && (
          <p className="mt-2 text-[10px] text-muted">{chain.data.unavailable.message}</p>
        )}
        <label className={`${FIELD} mt-2`}>
          Notes
          <textarea
            aria-label="Notes"
            value={values.notes}
            onChange={set("notes")}
            className={`${INPUT} min-h-16`}
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
      <Panel title="Derived">
        {!derived ? (
          <p className="text-muted">Price the contract to see the numbers.</p>
        ) : (
          <dl className="grid gap-1" data-testid="scalp-derived">
            <Row label="Cost">{usd(derived.cost)}</Row>
            <Row label="P&L before fees">
              <Money value={derived.cash.grossPnl} />
            </Row>
            <Row label="Fees">{usd(derived.cash.fees)}</Row>
            <Row label="Net P&L">
              <Money value={derived.cash.netPnl} />
            </Row>
            <Row label="Return on cost">
              <Pct value={derived.returnOnCost} />
            </Row>
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
