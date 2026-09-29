import { GRADES } from "@tj/core";
import type { ReactNode } from "react";
import type { TradeView } from "../api.js";
import { Panel } from "../components/ui.js";
import { type TradePatchBody, useSaveTrade } from "./data.js";
import { SetupPicker, TagChips } from "./Pickers.js";

const LABEL = "w-16 shrink-0 text-[10px] text-muted uppercase tracking-wider";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className={LABEL}>{label}</span>
      {children}
    </div>
  );
}

/**
 * The review (scalp-review spec §7.3): a strip under a scalp's charts, or a panel beside a fly's legs. Every
 * change saves at once. `levels` is the scalp's stop and target column, first in the strip.
 */
export function ReviewPanel({
  trade,
  layout,
  levels,
}: {
  trade: TradeView;
  layout: "strip" | "side";
  levels?: ReactNode;
}) {
  const save = useSaveTrade(trade.id);
  const pick = (body: TradePatchBody) => save.mutate(body);

  const setup = (
    <Row label="Setup">
      <SetupPicker trade={trade} onPick={(setupId) => pick({ setupId })} />
    </Row>
  );
  const grade = (
    <Row label="Grade">
      {GRADES.map((each) => (
        <button
          key={each}
          type="button"
          aria-pressed={trade.grade === each}
          onClick={() => pick({ grade: trade.grade === each ? null : each })}
          className={`num w-6 rounded-[2px] border py-0.5 ${
            trade.grade === each ? "border-accent bg-accent text-white" : "border-line text-muted"
          }`}
        >
          {each}
        </button>
      ))}
    </Row>
  );
  const mistakes = (
    <Row label="Mistakes">
      <TagChips trade={trade} kind="mistake" onPick={(tagIds) => pick({ tagIds })} />
    </Row>
  );
  const emotion = (
    <Row label="Emotion">
      <TagChips trade={trade} kind="emotion" onPick={(tagIds) => pick({ tagIds })} />
    </Row>
  );
  const notes = (
    <textarea
      key={trade.id}
      aria-label="Notes"
      placeholder="Notes…"
      defaultValue={trade.notes ?? ""}
      onBlur={(event) => {
        if (event.target.value !== (trade.notes ?? "")) pick({ notes: event.target.value });
      }}
      className="min-h-14 w-full rounded-sm border border-line bg-[#0e1118] p-2 text-fg outline-none focus:border-accent"
    />
  );
  const exclude = (
    <label className="flex items-center gap-2 text-muted">
      <input
        type="checkbox"
        checked={trade.excluded}
        onChange={(event) => pick({ excluded: event.target.checked })}
      />
      Exclude from stats
    </label>
  );
  const problem = save.error && <p className="mt-2 text-down">Couldn't save: {save.error.message}</p>;

  if (layout === "side") {
    return (
      <Panel title="Review">
        <div className="flex flex-col gap-1.5">
          {setup}
          {grade}
          {mistakes}
          {emotion}
          {notes}
          {exclude}
        </div>
        {problem}
      </Panel>
    );
  }
  return (
    <Panel title="Review">
      <div className="grid gap-3 min-[900px]:grid-cols-[auto_1fr_1fr]">
        {levels}
        <div className="flex flex-col gap-1.5">
          {setup}
          {grade}
          {emotion}
        </div>
        <div className="flex flex-col gap-1.5">
          {mistakes}
          {notes}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 border-line border-t pt-2">
        {exclude}
        {trade.review && (
          <button
            type="button"
            onClick={() => pick({ reviewed: trade.reviewedAt == null })}
            className="ml-auto rounded-sm border border-line px-2 py-0.5 text-fg hover:border-accent"
          >
            {trade.reviewedAt == null ? "Done reviewing" : "Back to queue"}
          </button>
        )}
      </div>
      {problem}
    </Panel>
  );
}
