import type { ScalpRisk } from "@tj/core";
import { useEffect, useRef, useState } from "react";
import type { TradeView } from "../api.js";
import { type Levels, parseAmount, parsePrice } from "./levels.js";
import { INPUT } from "./Pickers.js";
import { usePriceNote } from "./prices.js";
import { liveLine, problemText } from "./riskText.js";

const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * The strip's R (scalp-R spec §9.2): the live "Risk · R · R:R" line, priced where the lines are right now, and the
 * typed stock at entry and planned risk.
 */
export function RiskLine({
  trade,
  levels,
  risk,
}: {
  trade: TradeView;
  levels: Levels;
  risk: ScalpRisk | null;
}) {
  const note = usePriceNote(trade.id);
  if (!risk) return null;
  const line = (
    <p data-testid="live-risk" className="num text-[11px] text-fg">
      {liveLine(risk, trade.closedAt == null) ?? problemText(risk, note)}
    </p>
  );
  if (risk.problem === "not_single_long") return <div className="border-line border-t pt-1.5">{line}</div>;
  const stock = risk.stockAtEntry;
  return (
    <div className="flex flex-col gap-1 border-line border-t pt-1.5">
      {line}
      <Override
        label="Stock at entry"
        shown={stock ? stock.price.toFixed(2) : "—"}
        typed={stock?.typed === true}
        editLabel="Type the stock at entry"
        clearLabel="Use the fetched stock price"
        start={stock ? stock.price.toFixed(2) : ""}
        parse={(text) => parsePrice(text, "stock")}
        onSave={(value) => levels.saveOverride("stockEntryOverride", value)}
      />
      <Override
        label="Planned risk"
        shown={risk.riskTyped && risk.plannedRisk != null ? usd(risk.plannedRisk) : null}
        typed={risk.riskTyped}
        editLabel="Type the planned risk"
        clearLabel="Use the model's planned risk"
        start={risk.plannedRisk == null ? "" : risk.plannedRisk.toFixed(2)}
        parse={parseAmount}
        onSave={(value) => levels.saveOverride("riskOverride", value)}
      />
    </div>
  );
}

/** A typed override: ✎ opens a field that saves on Enter or when it loses focus; ✕ goes back to what's worked out. */
function Override({
  label,
  shown,
  typed,
  editLabel,
  clearLabel,
  start,
  parse,
  onSave,
}: {
  label: string;
  /** The value beside the label, or null for none. */
  shown: string | null;
  typed: boolean;
  editLabel: string;
  clearLabel: string;
  /** What the field starts with. */
  start: string;
  parse(text: string): number | string;
  onSave(value: number | null): void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const escaped = useRef(false);
  const editing = text !== null;
  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);
  // Enter and Esc only blur the field, so a save happens here, once.
  const finish = () => {
    const entered = text?.trim() ?? "";
    const wasEscaped = escaped.current;
    escaped.current = false;
    if (wasEscaped || entered === "") {
      setText(null);
      setProblem(null);
      return;
    }
    const value = parse(entered);
    if (typeof value === "string") {
      setProblem(value);
      return;
    }
    setText(null);
    setProblem(null);
    onSave(value);
  };
  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px]">
      <span className="text-muted">{label}</span>
      {editing ? (
        <input
          ref={field}
          aria-label={label}
          inputMode="decimal"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setProblem(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") field.current?.blur();
            if (event.key === "Escape") {
              escaped.current = true;
              field.current?.blur();
            }
          }}
          onBlur={finish}
          className={`num w-20 ${INPUT}`}
        />
      ) : (
        <>
          {shown != null && <span className="num text-fg">{shown}</span>}
          {typed && <span className="text-muted">(typed)</span>}
          <button
            type="button"
            aria-label={editLabel}
            onClick={() => setText(start)}
            className="text-muted hover:text-fg"
          >
            ✎
          </button>
          {typed && (
            <button
              type="button"
              aria-label={clearLabel}
              onClick={() => onSave(null)}
              className="text-muted hover:text-down"
            >
              ✕
            </button>
          )}
        </>
      )}
      {problem && <span className="w-full text-down">{problem}</span>}
    </div>
  );
}
