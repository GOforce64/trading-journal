import { LEVEL_BASES, type LevelBasis, type ScalpRisk, type TargetLevel, trimProblem } from "@tj/core";
import { type FocusEvent, type RefObject, useEffect, useRef, useState } from "react";
import type { LineId } from "../chart/drag.js";
import { type Levels, parseContracts, parsePrice, targetId } from "./levels.js";
import { INPUT } from "./Pickers.js";

const BASIS_NAMES: Record<LevelBasis, string> = { stock: "Stock", premium: "Premium" };
const LABEL = "w-16 shrink-0 text-[10px] uppercase tracking-wider";
const ADD = "rounded-sm border border-line border-dashed px-2 py-0.5 text-muted hover:text-fg";

/**
 * The review strip's levels column (scalp-review spec §8, scalp-R spec §9.2): the basis, the stop, and the targets
 * with their trims. `risk` is priced where the lines are now, for the wrong-side flags and the runner.
 */
export function LevelFields({ levels, risk = null }: { levels: Levels; risk?: ScalpRisk | null }) {
  const switchTo = (next: LevelBasis) => {
    if (next === levels.basis) return;
    const set = levels.stop.saved != null || levels.targets.saved.length > 0;
    if (set && !window.confirm(`Switching to ${next} clears the stop and targets.`)) return;
    levels.switchBasis(next);
  };
  const runner = risk?.runner;
  // Saved targets can trim more than the position after a size edit; every drag would then be refused.
  const overTrimmed = trimProblem(levels.targets.saved, levels.size);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <span className={`${LABEL} text-muted`}>Levels on</span>
        {LEVEL_BASES.map((basis) => (
          <button
            key={basis}
            type="button"
            aria-pressed={levels.basis === basis}
            onClick={() => switchTo(basis)}
            className={`rounded-[2px] border px-1.5 py-0.5 text-[11px] ${
              levels.basis === basis
                ? "border-accent bg-accent text-white"
                : "border-line text-muted hover:text-fg"
            }`}
          >
            {BASIS_NAMES[basis]}
          </button>
        ))}
      </div>
      <StopRow levels={levels} />
      {levels.targets.shown.map((target, index) => (
        <TargetRow
          key={targetId(index)}
          index={index}
          target={target}
          levels={levels}
          wrongSide={risk?.targets[index]?.wrongSide === true}
        />
      ))}
      {levels.draft == null ? (
        <div className="flex items-center gap-1">
          <span className={`${LABEL} text-up`}>{levels.targets.shown.length === 0 ? "Targets" : ""}</span>
          <button type="button" onClick={() => levels.startTarget()} className={ADD}>
            + Target
          </button>
        </div>
      ) : (
        <DraftRow levels={levels} />
      )}
      {runner && (
        <p className="text-[10px] text-muted">
          {runner.contracts} runner{runner.contracts === 1 ? "" : "s"}, counted at T{runner.atTarget}
        </p>
      )}
      {levels.basis === "premium" && (
        <p className="max-w-60 text-[10px] text-muted">
          Premium levels aren't drawn yet: there's no option chart.
        </p>
      )}
      {overTrimmed && !levels.problem && (
        <p className="max-w-60 text-[11px] text-down">
          {overTrimmed} Lower a target's contracts or remove one.
        </p>
      )}
      {levels.problem && <p className="text-[11px] text-down">{levels.problem}</p>}
      {levels.error && <p className="text-[11px] text-down">Couldn't save: {levels.error}</p>}
    </div>
  );
}

/** The stop: + Stop until there is one, then its price field (scalp-review spec §8.2, §8.4). */
function StopRow({ levels }: { levels: Levels }) {
  const [opened, setOpened] = useState(false);
  const value = levels.stop.shown;
  const label = <span className={`${LABEL} text-down`}>Stop</span>;
  if (value == null && !opened) {
    return (
      <div className="flex items-center gap-1">
        {label}
        <button
          type="button"
          onClick={() => {
            setOpened(true);
            if (levels.basis === "stock") levels.setPlacing("stop");
          }}
          className={ADD}
        >
          + Stop
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {label}
      <PriceInput
        id="stop"
        name="Stop"
        value={value}
        saved={levels.stop.saved}
        levels={levels}
        startOpen={opened}
        onSave={levels.saveStop}
        onClose={() => setOpened(false)}
        onClear={() => levels.saveStop(null)}
        clearLabel="Clear stop"
      />
    </div>
  );
}

/** A saved target: T1 [price] × [contracts] ✕ (scalp-R spec §9.2). */
function TargetRow({
  index,
  target,
  levels,
  wrongSide,
}: {
  index: number;
  target: TargetLevel;
  levels: Levels;
  wrongSide: boolean;
}) {
  const name = `T${index + 1}`;
  const replace = (next: TargetLevel) =>
    levels.saveTargets(levels.targets.saved.map((each, at) => (at === index ? next : each)));
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className={`${LABEL} text-up`}>{name}</span>
      <PriceInput
        id={targetId(index)}
        name={`${name} price`}
        value={target.price}
        saved={levels.targets.saved[index]?.price ?? null}
        levels={levels}
        onSave={(price) => replace({ ...target, price })}
      />
      <ContractsInput
        name={`${name} contracts`}
        value={target.contracts}
        onSave={(contracts) => replace({ ...target, contracts })}
      />
      <button
        type="button"
        aria-label={`Remove ${name}`}
        onClick={() => levels.saveTargets(levels.targets.saved.filter((_, at) => at !== index))}
        className="text-muted hover:text-down"
      >
        ✕
      </button>
      {wrongSide && <span className="w-full text-[10px] text-down">on the wrong side</span>}
    </div>
  );
}

/**
 * The target being added: its price, typed or clicked on the chart, and its contracts. Tab from the price to the
 * contracts keeps the typed price; leaving the row saves the two together, and Esc in either field drops it.
 */
function DraftRow({ levels }: { levels: Levels }) {
  const row = useRef<HTMLDivElement>(null);
  const commitPrice = useRef<(() => void) | null>(null);
  const index = levels.targets.saved.length;
  const name = `T${index + 1}`;
  const contracts = levels.draft ?? levels.nextContracts;
  return (
    <div ref={row} className="flex flex-wrap items-center gap-1">
      <span className={`${LABEL} text-up`}>{name}</span>
      <PriceInput
        id={targetId(index)}
        name={`${name} price`}
        value={null}
        saved={null}
        levels={levels}
        startOpen
        within={row}
        commit={commitPrice}
        onSave={(price) => levels.saveTargets([...levels.targets.saved, { price, contracts }])}
        onClose={() => levels.cancelDraft()}
      />
      <ContractsInput
        name={`${name} contracts`}
        value={contracts}
        live
        within={row}
        onLeave={() => commitPrice.current?.()}
        onCancel={() => levels.cancelDraft()}
        onSave={levels.setDraft}
      />
    </div>
  );
}

/**
 * A level's price field (scalp-review spec §8.4). It saves on Enter or when it loses focus, and Esc puts the saved
 * price back. A place or drag on the chart wins over what was typed before it.
 */
function PriceInput({
  id,
  name,
  value,
  saved,
  levels,
  startOpen = false,
  within,
  commit,
  onSave,
  onClose,
  onClear,
  clearLabel,
}: {
  id: LineId;
  /** The field's name, e.g. "Stop" or "T2 price". */
  name: string;
  /** The saved price, or where the chart has the line. */
  value: number | null;
  saved: number | null;
  levels: Levels;
  /** Opened by + Stop or + Target: empty and focused. */
  startOpen?: boolean;
  /** A row whose other fields may take the focus without this field saving or closing. */
  within?: RefObject<HTMLElement | null>;
  /** Set to save what's typed, for the row to call when the focus leaves it from another field. */
  commit?: RefObject<(() => void) | null>;
  onSave(price: number): void;
  /** It closed without a save: Esc, left empty, or placing ended. */
  onClose?(): void;
  /** Offered as ✕ while there's a price and nothing is typed. */
  onClear?(): void;
  clearLabel?: string;
}) {
  // The text being typed; null shows the level itself, which follows a drag on the chart.
  const [text, setText] = useState<string | null>(startOpen ? "" : null);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const escaped = useRef(false);
  const armed = levels.placing === id;
  const wasArmed = useRef(armed);
  const chartEdits = levels.chartEdits[id] ?? 0;
  const seenEdits = useRef(chartEdits);

  useEffect(() => {
    if (startOpen) field.current?.focus();
  }, [startOpen]);
  // A place or drag on the chart wins over what was typed before it. The field keeps its focus through a press
  // on the chart, so its old text would otherwise be saved over the chart's when it loses focus.
  useEffect(() => {
    if (seenEdits.current === chartEdits) return;
    seenEdits.current = chartEdits;
    setText(null);
    setProblem(null);
  }, [chartEdits]);
  // Placing ended, by a click on the chart or Esc: a field left empty closes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the end of placing triggers this
  useEffect(() => {
    const ended = wasArmed.current && !armed;
    wasArmed.current = armed;
    if (!ended) return;
    setText((typed) => (typed?.trim() ? typed : null));
    onClose?.();
  }, [armed]);

  const close = () => {
    setText(null);
    setProblem(null);
    if (levels.placing === id) levels.setPlacing(null);
    onClose?.();
  };
  const settle = (typed: string | null, wasEscaped: boolean) => {
    if (wasEscaped || !typed) {
      close();
      return;
    }
    const price = parsePrice(typed, levels.basis);
    if (typeof price === "string") {
      setProblem(price);
      return;
    }
    close();
    if (price !== saved) onSave(price);
  };
  // Enter and Esc only blur the field, so a save happens here, once.
  const finish = (event: FocusEvent<HTMLInputElement>) => {
    const typed = text?.trim() ?? null;
    const wasEscaped = escaped.current;
    escaped.current = false;
    // Moving to the new target's own contracts field keeps what's typed, or leaves the empty field open.
    if (!wasEscaped && within?.current?.contains(event.relatedTarget as Node | null)) return;
    settle(typed, wasEscaped);
  };
  if (commit) {
    commit.current = () => {
      const typed = text?.trim() ?? null;
      if (typed) settle(typed, false);
    };
  }

  return (
    <>
      <input
        ref={field}
        aria-label={name}
        inputMode="decimal"
        value={text ?? (value == null ? "" : value.toFixed(2))}
        onFocus={() => setText((typed) => typed ?? (value == null ? "" : value.toFixed(2)))}
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
      {onClear && value != null && text === null && (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={onClear}
          className="text-muted hover:text-down"
        >
          ✕
        </button>
      )}
      {armed && <span className="text-[10px] text-muted">or click the chart</span>}
      {problem && <span className="w-full text-[11px] text-down">{problem}</span>}
    </>
  );
}

/**
 * A target's whole contracts. With `live`, as in the new target's row, each valid keystroke saves, so a click on the
 * chart with this field focused uses what's typed.
 */
function ContractsInput({
  name,
  value,
  live = false,
  within,
  onLeave,
  onCancel,
  onSave,
}: {
  name: string;
  value: number;
  live?: boolean;
  /** The row this field sits in; `onLeave` runs when the focus leaves it from here. */
  within?: RefObject<HTMLElement | null>;
  onLeave?(): void;
  /** Esc: drops what the row was adding, as Esc in its price field does, instead of leaving it. */
  onCancel?(): void;
  onSave(contracts: number): void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const escaped = useRef(false);
  const finish = (event: FocusEvent<HTMLInputElement>) => {
    const typed = text?.trim() ?? "";
    const wasEscaped = escaped.current;
    escaped.current = false;
    const left = !within?.current?.contains(event.relatedTarget as Node | null);
    if (wasEscaped || typed === "") {
      setText(null);
      setProblem(null);
      if (wasEscaped && onCancel) onCancel();
      else if (left) onLeave?.();
      return;
    }
    const contracts = parseContracts(typed);
    if (typeof contracts === "string") {
      setProblem(contracts);
      return;
    }
    setText(null);
    setProblem(null);
    if (contracts !== value) onSave(contracts);
    if (left) onLeave?.();
  };
  return (
    <>
      <span className="text-muted">×</span>
      <input
        ref={field}
        aria-label={name}
        inputMode="numeric"
        value={text ?? String(value)}
        onChange={(event) => {
          setText(event.target.value);
          setProblem(null);
          const contracts = parseContracts(event.target.value.trim());
          if (live && typeof contracts === "number") onSave(contracts);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") field.current?.blur();
          if (event.key === "Escape") {
            escaped.current = true;
            field.current?.blur();
          }
        }}
        onBlur={finish}
        className={`num w-9 ${INPUT}`}
      />
      {problem && <span className="w-full text-[11px] text-down">{problem}</span>}
    </>
  );
}
