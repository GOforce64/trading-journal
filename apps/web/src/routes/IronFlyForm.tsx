import { ironFlyMetrics, ironFlyStructureFromLegs, type PricedLeg, positionCash } from "@tj/core";
import { type ReactNode, useMemo, useState } from "react";
import { Money, Panel } from "../components/ui.js";

/** The four legs of a short iron butterfly, in the order oQuants shows them. */
const LEG_ROLES = [
  { key: "shortCall", label: "Short call", right: "C", short: true },
  { key: "shortPut", label: "Short put", right: "P", short: true },
  { key: "longCall", label: "Long call", right: "C", short: false },
  { key: "longPut", label: "Long put", right: "P", short: false },
] as const;

type LegKey = (typeof LEG_ROLES)[number]["key"];

export interface LegFields {
  strike: string;
  size: string;
  entry: string;
  exit: string;
}

export interface IronFlyFormValues {
  underlying: string;
  underlyingName: string;
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

/** Legs are only priced once strike, size and entry are all present. */
function toPricedLegs(values: IronFlyFormValues): PricedLeg[] | null {
  const legs: PricedLeg[] = [];
  for (const role of LEG_ROLES) {
    const fields = values.legs[role.key];
    const strike = num(fields.strike);
    const size = num(fields.size);
    const entry = num(fields.entry);
    if (Number.isNaN(strike) || Number.isNaN(size) || size <= 0 || Number.isNaN(entry)) return null;
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

  const set = (key: keyof IronFlyFormValues) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  const setLeg = (key: LegKey, field: keyof LegFields) => (event: { target: { value: string } }) =>
    setValues((current) => ({
      ...current,
      legs: { ...current.legs, [key]: { ...current.legs[key], [field]: event.target.value } },
    }));

  const derived = useMemo(() => {
    const legs = toPricedLegs(values);
    if (!legs) return null;
    const cash = positionCash(legs, {
      open: zeroIfBlank(values.feesOpen),
      close: zeroIfBlank(values.feesClose),
    });
    const structure = ironFlyStructureFromLegs(legs);
    const metrics = structure
      ? ironFlyMetrics({
          ...structure,
          contracts: cash.contracts,
          creditPerShare: -(cash.netCost - cash.fees) / cash.shares,
          fees: cash.fees,
        })
      : null;
    return { legs, cash, structure, metrics };
  }, [values]);

  function submit() {
    if (!derived || !derived.structure) {
      setProblem("Every leg needs a strike, a size and an entry price.");
      return;
    }
    setProblem(null);
    const { cash, structure, legs } = derived;
    onSubmit({
      strategy: "iron_fly",
      book: values.book,
      underlying: values.underlying,
      underlyingName: values.underlyingName || null,
      structureLabel: "Short Iron Butterfly",
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
        expiry: values.expiry || "2100-01-01",
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

  const legInput = (key: LegKey, label: string, field: keyof LegFields) => (
    <input
      aria-label={label}
      type="number"
      step="0.01"
      value={values.legs[key][field]}
      onChange={setLeg(key, field)}
      className="num w-full rounded-sm border border-line bg-[#0e1118] px-2 py-1 text-right text-[13px] text-fg outline-none focus:border-accent"
    />
  );

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
      <div className="flex flex-col gap-3">
        <Panel title="Trade">
          <div className="grid grid-cols-3 gap-2">
            {input("Underlying", values.underlying, set("underlying"))}
            {input("Company", values.underlyingName, set("underlyingName"))}
            {input("Expiry", values.expiry, set("expiry"), "date")}
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
                    <td className="px-1">{legInput(role.key, `${role.label} strike`, "strike")}</td>
                    <td className="px-1">{legInput(role.key, `${role.label} size`, "size")}</td>
                    <td className="px-1">{legInput(role.key, `${role.label} entry`, "entry")}</td>
                    <td className="px-1">{legInput(role.key, `${role.label} exit`, "exit")}</td>
                    <td className="text-right">
                      <Money value={leg ? leg.quantity * 100 * leg.openPrice : null} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
        {!derived && <p className="text-muted">Price all four legs to see the numbers.</p>}
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
