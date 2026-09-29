import { LEVEL_BASES, type LevelBasis } from "@tj/core";
import { useEffect, useRef, useState } from "react";
import type { LevelKind } from "../chart/drag.js";
import { type Levels, parsePrice } from "./levels.js";
import { INPUT } from "./Pickers.js";

const NAMES = { stop: "Stop", target: "Target" } as const;
const TONES = { stop: "text-down", target: "text-up" } as const;
const BASIS_NAMES: Record<LevelBasis, string> = { stock: "Stock", premium: "Premium" };
const LABEL = "w-16 shrink-0 text-[10px] uppercase tracking-wider";

/** The review strip's stop and target column (scalp-review spec §7.3, §8). */
export function LevelFields({ levels }: { levels: Levels }) {
  const switchTo = (next: LevelBasis) => {
    if (next === levels.basis) return;
    const set = levels.saved.stop != null || levels.saved.target != null;
    if (set && !window.confirm(`Switching to ${next} clears the stop and target.`)) return;
    levels.switchBasis(next);
  };
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
      <LevelRow kind="stop" levels={levels} />
      <LevelRow kind="target" levels={levels} />
      {levels.basis === "premium" && (
        <p className="max-w-60 text-[10px] text-muted">
          Premium levels aren't drawn yet: there's no option chart.
        </p>
      )}
      {levels.error && <p className="text-[11px] text-down">Couldn't save: {levels.error}</p>}
    </div>
  );
}

/** One level: + Stop until there is one, then a field that saves on Enter or when it loses focus (spec §8.4). */
function LevelRow({ kind, levels }: { kind: LevelKind; levels: Levels }) {
  const value = levels.shown[kind];
  // The text being typed; null shows the level itself, which follows a drag on the chart.
  const [text, setText] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const escaped = useRef(false);
  const armed = levels.placing === kind;

  useEffect(() => {
    if (opened) field.current?.focus();
  }, [opened]);
  // Placing ended, by a click on the chart or Esc: a field left empty closes.
  useEffect(() => {
    if (armed) return;
    setText((typed) => (typed === "" ? null : typed));
    setOpened(false);
  }, [armed]);

  const close = () => {
    setText(null);
    setProblem(null);
    setOpened(false);
    if (levels.placing === kind) levels.setPlacing(null);
  };
  // Enter and Esc only blur the field, so a save happens here, once.
  const finish = () => {
    const typed = text?.trim() ?? null;
    if (escaped.current || typed === null || typed === "") {
      escaped.current = false;
      close();
      return;
    }
    const price = parsePrice(typed, levels.basis);
    if (typeof price === "string") {
      setProblem(price);
      return;
    }
    close();
    if (price !== levels.saved[kind]) levels.save(kind, price);
  };

  const label = <span className={`${LABEL} ${TONES[kind]}`}>{NAMES[kind]}</span>;
  if (value == null && text === null && !opened) {
    return (
      <div className="flex items-center gap-1">
        {label}
        <button
          type="button"
          onClick={() => {
            setOpened(true);
            setText("");
            if (levels.basis === "stock") levels.setPlacing(kind);
          }}
          className="rounded-sm border border-line border-dashed px-2 py-0.5 text-muted hover:text-fg"
        >
          + {NAMES[kind]}
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {label}
      <input
        ref={field}
        aria-label={NAMES[kind]}
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
      {value != null && text === null && (
        <button
          type="button"
          aria-label={`Clear ${kind}`}
          onClick={() => levels.save(kind, null)}
          className="text-muted hover:text-down"
        >
          ✕
        </button>
      )}
      {armed && <span className="text-[10px] text-muted">or click the chart</span>}
      {problem && <span className="w-full text-[11px] text-down">{problem}</span>}
    </div>
  );
}
