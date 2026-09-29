import { LEVEL_BASES } from "@tj/core";
import { useState } from "react";
import { Panel } from "../components/ui.js";
import { useDefaultBasis } from "../review/prefs.js";
import { useChartPrefs } from "./prefs.js";

const FIELD = "flex flex-col gap-1 text-[10px] text-muted uppercase tracking-wider";
const INPUT =
  "num rounded-sm border border-line bg-[#0e1118] px-2 py-1 text-[13px] text-fg normal-case tracking-normal outline-none focus:border-accent";
const valid = (text: string) => /^\d{1,3}$/.test(text) && Number(text) >= 1 && Number(text) <= 500;

/** The trade charts' EMA lengths (spec §8), kept in this browser with the other chart choices. */
export function ChartSettings() {
  const [prefs, setPrefs] = useChartPrefs();
  const [lengths, setLengths] = useState(prefs.emaLengths.map(String));
  const [saved, setSaved] = useState(false);
  const [levelBasis, setLevelBasis] = useDefaultBasis();
  const ready = lengths.every(valid);
  return (
    <Panel title="Chart">
      <div className="grid grid-cols-4 gap-2">
        {lengths.map((value, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the four EMA slots are fixed
          <label key={index} className={FIELD}>
            EMA {index + 1}
            <input
              aria-label={`EMA ${index + 1}`}
              inputMode="numeric"
              value={value}
              onChange={(event) => {
                setSaved(false);
                setLengths(lengths.map((each, at) => (at === index ? event.target.value : each)));
              }}
              className={INPUT}
            />
          </label>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted">
        Moving-average lengths for the trade charts, kept in this browser. Whole numbers from 1 to 500.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          aria-label="Save chart"
          disabled={!ready}
          onClick={() => {
            setPrefs({ ...prefs, emaLengths: lengths.map(Number) });
            setSaved(true);
          }}
          className="rounded-sm bg-accent px-3 py-1 text-white disabled:opacity-50"
        >
          Save
        </button>
        {saved && <span className="text-muted">Saved</span>}
      </div>
      <div className="mt-3 flex items-center gap-2 border-line border-t pt-2">
        <span className="text-[10px] text-muted uppercase tracking-wider">
          Stop and target levels default to
        </span>
        {LEVEL_BASES.map((basis) => (
          <button
            key={basis}
            type="button"
            aria-pressed={levelBasis === basis}
            onClick={() => setLevelBasis(basis)}
            className={`rounded-[2px] border px-2 py-0.5 ${
              levelBasis === basis
                ? "border-accent bg-accent text-white"
                : "border-line text-muted hover:text-fg"
            }`}
          >
            {basis === "stock" ? "Stock" : "Premium"}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-muted">
        Where a scalp's review starts. A trade that already has a stop or target keeps its own. Kept in this
        browser.
      </p>
    </Panel>
  );
}
