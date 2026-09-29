import { type ChartPrefs, TIMEFRAMES, type Toggle, timeframeLabel } from "./prefs.js";

const BUTTON = "rounded-[2px] border px-1.5 py-0.5 text-[10px]";
const on = (pressed: boolean) =>
  pressed ? "border-accent bg-[#2962ff22] text-fg" : "border-line text-muted hover:text-fg";

/** Timeframes, indicator toggles and Fit trade, above the charts (spec §8). */
export function ChartToolbar({
  prefs,
  onChange,
  hiddenEmas,
  onFit,
}: {
  prefs: ChartPrefs;
  onChange: (next: ChartPrefs) => void;
  /** EMAs (by index) with too little history to draw. */
  hiddenEmas: readonly number[];
  onFit: () => void;
}) {
  const toggles: { toggle: Toggle; label: string; title?: string }[] = [
    ...prefs.emaLengths.map((length, index) => ({
      toggle: `ema${index}` as Toggle,
      label: `EMA ${length}`,
      title: hiddenEmas.includes(index) ? "needs more history" : undefined,
    })),
    { toggle: "vwap", label: "VWAP" },
    { toggle: "pm", label: "PM levels" },
    { toggle: "pd", label: "PD levels" },
    { toggle: "volume", label: "Volume" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1">
      {TIMEFRAMES.map((minutes) => (
        <button
          key={minutes}
          type="button"
          aria-pressed={prefs.minutes === minutes}
          onClick={() => onChange({ ...prefs, minutes })}
          className={`${BUTTON} num ${on(prefs.minutes === minutes)}`}
        >
          {timeframeLabel(minutes)}
        </button>
      ))}
      <span className="mx-1 h-4 w-px bg-line" />
      {toggles.map(({ toggle, label, title }) => (
        <button
          key={toggle}
          type="button"
          title={title}
          aria-pressed={prefs.show[toggle]}
          onClick={() => onChange({ ...prefs, show: { ...prefs.show, [toggle]: !prefs.show[toggle] } })}
          className={`${BUTTON} ${on(prefs.show[toggle])}`}
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        onClick={onFit}
        className={`${BUTTON} ml-auto border-line text-fg hover:border-accent`}
      >
        Fit trade
      </button>
    </div>
  );
}
