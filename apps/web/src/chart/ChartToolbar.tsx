import type { ReactNode } from "react";
import type { ChartView } from "./option.js";
import { type ChartPrefs, TIMEFRAMES, type Toggle, timeframeLabel } from "./prefs.js";

const BUTTON = "rounded-[2px] border px-1.5 py-0.5 text-[10px]";
const on = (pressed: boolean) =>
  pressed ? "border-accent bg-[#2962ff22] text-fg" : "border-line text-muted hover:text-fg";

/** Timeframes, the Stock | Option switch, indicator toggles and Fit trade, above the charts (spec §8). */
export function ChartToolbar({
  prefs,
  onChange,
  hiddenEmas,
  onFit,
  view,
  showDay = false,
  extra,
}: {
  prefs: ChartPrefs;
  onChange: (next: ChartPrefs) => void;
  /** EMAs (by index) with too little history to draw. */
  hiddenEmas: readonly number[];
  onFit: () => void;
  /** A scalp's view and its switch (premium-chart spec §6.1); none on other trades. */
  view?: { current: ChartView; onChange: (next: ChartView) => void };
  /** A missed trade's chart: the Day's trades toggle (missed-trades spec §6.4). */
  showDay?: boolean;
  /** The page's own buttons, before Fit trade, such as a scalp's + Missed. */
  extra?: ReactNode;
}) {
  const onOption = view?.current === "option";
  const toggles: { toggle: Toggle; label: string; title?: string; disabled?: boolean }[] = [
    ...prefs.emaLengths.map((length, index) => ({
      toggle: `ema${index}` as Toggle,
      label: `EMA ${length}`,
      title: hiddenEmas.includes(index) ? "needs more history" : undefined,
    })),
    { toggle: "vwap", label: "VWAP" },
    {
      toggle: "pm",
      label: "PM levels",
      title: onOption ? "Options don't trade premarket" : undefined,
      disabled: onOption,
    },
    { toggle: "pd", label: "PD levels" },
    { toggle: "volume", label: "Volume" },
    ...(showDay ? [{ toggle: "day" as const, label: "Day's trades" }] : []),
  ];
  return (
    // The timeframes and toggles wrap among themselves; Fit trade and the page's buttons stay top right.
    <div className="flex items-start gap-1">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
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
        {view && (
          <>
            <span className="mx-1 h-4 w-px bg-line" />
            {(["stock", "option"] as const).map((each) => (
              <button
                key={each}
                type="button"
                aria-pressed={view.current === each}
                onClick={() => view.onChange(each)}
                className={`${BUTTON} ${on(view.current === each)}`}
              >
                {each === "stock" ? "Stock" : "Option"}
              </button>
            ))}
          </>
        )}
        <span className="mx-1 h-4 w-px bg-line" />
        {toggles.map(({ toggle, label, title, disabled }) => (
          <button
            key={toggle}
            type="button"
            title={title}
            disabled={disabled}
            aria-pressed={prefs.show[toggle]}
            onClick={() => onChange({ ...prefs, show: { ...prefs.show, [toggle]: !prefs.show[toggle] } })}
            className={`${BUTTON} ${on(prefs.show[toggle])} disabled:opacity-40`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {extra}
        <button type="button" onClick={onFit} className={`${BUTTON} border-line text-fg hover:border-accent`}>
          Fit trade
        </button>
      </div>
    </div>
  );
}
