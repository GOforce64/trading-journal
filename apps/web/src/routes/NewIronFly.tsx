import { useMutation } from "@tanstack/react-query";
import { ironFlyMetrics } from "@tj/core";
import { type ReactNode, useMemo, useState } from "react";
import { api } from "../api.js";
import { Panel } from "../components/ui.js";

interface FormState {
  underlying: string;
  underlyingName: string;
  book: "live" | "paper";
  openedAt: string;
  closedAt: string;
  bodyStrike: string;
  putWing: string;
  callWing: string;
  expiry: string;
  contracts: string;
  creditPerShare: string;
  fees: string;
  netPnl: string;
  notes: string;
}

const EMPTY: FormState = {
  underlying: "",
  underlyingName: "",
  book: "live",
  openedAt: "",
  closedAt: "",
  bodyStrike: "",
  putWing: "",
  callWing: "",
  expiry: "",
  contracts: "",
  creditPerShare: "",
  fees: "0",
  netPnl: "",
  notes: "",
};

const num = (value: string): number => (value.trim() === "" ? Number.NaN : Number(value));
const millis = (value: string): number => (value ? new Date(value).getTime() : Number.NaN);
const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** The four contracts of a short iron butterfly, derived from the structure fields. */
function buildLegs(form: FormState) {
  const size = num(form.contracts);
  const body = num(form.bodyStrike);
  const expiry = form.expiry || "2100-01-01";
  const leg = (right: "C" | "P", strike: number, quantity: number) => ({
    right,
    strike,
    expiry,
    quantity,
    multiplier: 100,
    openPrice: 0,
    closePrice: null,
  });
  return [
    leg("C", body, -size),
    leg("P", body, -size),
    leg("C", num(form.callWing), size),
    leg("P", num(form.putWing), size),
  ];
}

export function NewIronFly({ onCreated }: { onCreated?: (id: string) => void }) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const set = (key: keyof FormState) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const preview = useMemo(() => {
    const input = {
      bodyPutStrike: num(form.bodyStrike),
      bodyCallStrike: num(form.bodyStrike),
      putWingStrike: num(form.putWing),
      callWingStrike: num(form.callWing),
      contracts: num(form.contracts),
      creditPerShare: num(form.creditPerShare),
      fees: Number.isNaN(num(form.fees)) ? 0 : num(form.fees),
    };
    return Object.values(input).some(Number.isNaN) ? null : ironFlyMetrics(input);
  }, [form]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.api.trades.$post({
        json: {
          strategy: "iron_fly",
          book: form.book,
          underlying: form.underlying,
          underlyingName: form.underlyingName || null,
          structureLabel: "Short Iron Butterfly",
          openedAt: Number.isNaN(millis(form.openedAt)) ? Date.now() : millis(form.openedAt),
          closedAt: Number.isNaN(millis(form.closedAt)) ? null : millis(form.closedAt),
          netPnl: Number.isNaN(num(form.netPnl)) ? null : num(form.netPnl),
          fees: Number.isNaN(num(form.fees)) ? 0 : num(form.fees),
          notes: form.notes || null,
          source: "manual",
          legs: buildLegs(form),
          ironFly: {
            bodyPutStrike: num(form.bodyStrike),
            bodyCallStrike: num(form.bodyStrike),
            putWingStrike: num(form.putWing),
            callWingStrike: num(form.callWing),
            contracts: num(form.contracts),
            creditPerShare: num(form.creditPerShare),
            netCost: null,
          },
        },
      });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      return (await res.json()) as { id: string };
    },
    onSuccess: (created) => onCreated?.(created.id),
  });

  const field = (label: string, key: keyof FormState, type = "text") => (
    <label className="flex flex-col gap-1 text-[10px] text-muted uppercase tracking-wider">
      {label}
      <input
        aria-label={label}
        type={type}
        value={form[key]}
        onChange={set(key)}
        className="num rounded-sm border border-line bg-[#0e1118] px-2 py-1 text-[13px] text-fg outline-none focus:border-accent"
      />
    </label>
  );

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
      <Panel title="New iron fly">
        <div className="grid grid-cols-3 gap-2">
          {field("Underlying", "underlying")}
          {field("Company", "underlyingName")}
          {field("Expiry", "expiry", "date")}
          {field("Opened", "openedAt", "datetime-local")}
          {field("Closed", "closedAt", "datetime-local")}
          {field("Contracts", "contracts", "number")}
          {field("Body strike", "bodyStrike", "number")}
          {field("Put wing", "putWing", "number")}
          {field("Call wing", "callWing", "number")}
          {field("Credit per share", "creditPerShare", "number")}
          {field("Fees", "fees", "number")}
          {field("Net P&L", "netPnl", "number")}
        </div>
        <label className="mt-2 flex flex-col gap-1 text-[10px] text-muted uppercase tracking-wider">
          Notes
          <textarea
            aria-label="Notes"
            value={form.notes}
            onChange={set("notes")}
            className="min-h-16 rounded-sm border border-line bg-[#0e1118] px-2 py-1 text-[13px] text-fg outline-none focus:border-accent"
          />
        </label>
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="mt-3 rounded-sm bg-accent px-3 py-1.5 text-white disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Save trade"}
        </button>
        {save.error && <p className="mt-2 text-down">{String(save.error)}</p>}
      </Panel>

      <Panel title="Live preview">
        {!preview && <p className="text-muted">Fill in the structure to see the risk.</p>}
        {preview && (
          <dl className="grid gap-1">
            <Row label="Wings">
              <span data-testid="preview-wings">
                {preview.putWingWidth} / {preview.callWingWidth}
                {preview.isBrokenWing ? " · broken" : ""}
              </span>
            </Row>
            <Row label="Max profit">{usd(preview.maxProfit)}</Row>
            <Row label="Max loss">
              <span data-testid="preview-max-loss">
                {usd(preview.maxLoss)} ({preview.riskySide} side)
              </span>
            </Row>
            <Row label="Other side">
              {usd(preview.riskySide === "call" ? preview.putSideRisk : preview.callSideRisk)}
            </Row>
            <Row label="Breakevens">
              <span data-testid="preview-breakevens">
                {preview.breakevenLow} / {preview.breakevenHigh}
              </span>
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
