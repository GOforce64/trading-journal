import { type ChosenStrategy, canSwitchStrategy, showsSwingHint } from "@tj/core";
import type { TradeView } from "../api.js";
import { useSaveTrade } from "./data.js";

const BUTTON = "rounded-[2px] border px-1.5 py-0.5 text-[10px]";
const on = (pressed: boolean) =>
  pressed ? "border-accent bg-[#2962ff22] text-fg" : "border-line text-muted hover:text-fg";
const CHOICES: readonly { id: ChosenStrategy; label: string }[] = [
  { id: "scalp", label: "Scalp" },
  { id: "swing", label: "Swing" },
];

/** The Scalp | Swing switch beside a single bought option's chip (swing spec §5.2); nothing on other trades. */
export function StrategySwitch({ trade }: { trade: TradeView }) {
  const save = useSaveTrade(trade.id);
  if (!canSwitchStrategy(trade)) return null;
  return (
    <>
      <fieldset aria-label="Scalp or swing" className="flex gap-1">
        {CHOICES.map((choice) => (
          <button
            key={choice.id}
            type="button"
            aria-pressed={trade.strategy === choice.id}
            onClick={() => {
              if (trade.strategy !== choice.id) save.mutate({ chosenStrategy: choice.id });
            }}
            className={`${BUTTON} ${on(trade.strategy === choice.id)}`}
          >
            {choice.label}
          </button>
        ))}
      </fieldset>
      {save.error && (
        <p role="alert" className="basis-full text-[11px] text-down">
          {save.error.message}
        </p>
      )}
    </>
  );
}

/** "Held overnight: a swing?" at the top of a scalp's page (swing spec §5.3), until the user answers it. */
export function OvernightHint({ trade, now = Date.now() }: { trade: TradeView; now?: number }) {
  const save = useSaveTrade(trade.id);
  if (!showsSwingHint(trade, now)) return null;
  return (
    <div
      data-testid="swing-hint"
      className="flex flex-wrap items-center gap-2 rounded-sm border border-[#ec407a55] bg-[#ec407a14] px-3 py-1.5 text-[12px]"
    >
      <span className="text-fg">Held overnight: a swing?</span>
      <button
        type="button"
        onClick={() => save.mutate({ chosenStrategy: "swing" })}
        className="rounded-sm border border-[#f48fb1] px-2 py-0.5 text-[#f48fb1] hover:bg-[#ec407a22]"
      >
        Switch to swing
      </button>
      <button
        type="button"
        onClick={() => save.mutate({ chosenStrategy: "scalp" })}
        className="rounded-sm border border-line px-2 py-0.5 text-muted hover:text-fg"
      >
        Keep as scalp
      </button>
      {save.error && (
        <span role="alert" className="text-down">
          {save.error.message}
        </span>
      )}
    </div>
  );
}
