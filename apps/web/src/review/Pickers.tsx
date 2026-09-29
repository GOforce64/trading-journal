import { useEffect, useRef, useState } from "react";
import type { TradeView } from "../api.js";
import { type Tag, useCreateSetup, useCreateTag, useSetups, useTags } from "./data.js";

export const INPUT =
  "rounded-sm border border-line bg-[#0e1118] px-1.5 py-0.5 text-fg outline-none focus:border-accent";
const NEW = "__new";

const chipClass = (on: boolean, archived: boolean) =>
  `rounded-[2px] border px-1.5 py-0.5 text-[11px] ${
    on ? "border-accent bg-accent text-white" : "border-line text-muted hover:text-fg"
  } ${archived ? "opacity-50" : ""}`;

/**
 * A name typed inline (scalp-review spec §9.1, §10): Enter submits, Esc gives up. A refusal, such as a name
 * already taken, shows beside it and keeps the text.
 */
export function NameField({
  label,
  initial = "",
  onSubmit,
  onClose,
}: {
  label: string;
  initial?: string;
  onSubmit: (name: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus();
  }, []);
  return (
    <span className="inline-flex items-center gap-1">
      <input
        ref={field}
        aria-label={label}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setProblem(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
          if (event.key !== "Enter" || !name.trim()) return;
          onSubmit(name.trim()).then(onClose, (error: unknown) =>
            setProblem(error instanceof Error ? error.message : String(error)),
          );
        }}
        className={`w-36 ${INPUT}`}
      />
      {problem && <span className="text-[11px] text-down">{problem}</span>}
    </span>
  );
}

/** The setup (spec §9.1): this strategy's active setups and those for both, None, and + New setup…. */
export function SetupPicker({
  trade,
  onPick,
}: {
  trade: TradeView;
  onPick: (setupId: string | null) => void;
}) {
  const { data: setups = [] } = useSetups();
  const create = useCreateSetup();
  const [adding, setAdding] = useState(false);
  const strategy = trade.strategy === "iron_fly" ? "iron_fly" : "scalp";
  const offered = setups.filter(
    (setup) => !setup.archived && (setup.strategy == null || setup.strategy === strategy),
  );
  // The trade's own setup stays shown when it's archived, or for the other strategy.
  const current = setups.find((setup) => setup.id === trade.setupId);
  const kept = current && !offered.includes(current) ? current : null;
  if (adding) {
    return (
      <NameField
        label="New setup name"
        onClose={() => setAdding(false)}
        onSubmit={async (name) => {
          onPick((await create.mutateAsync({ name, strategy })).id);
        }}
      />
    );
  }
  return (
    <select
      aria-label="Setup"
      value={trade.setupId ?? ""}
      onChange={(event) => {
        if (event.target.value === NEW) setAdding(true);
        else onPick(event.target.value || null);
      }}
      className={INPUT}
    >
      <option value="">None</option>
      {kept && (
        <option value={kept.id}>
          {kept.name}
          {kept.archived ? " (archived)" : ""}
        </option>
      )}
      {offered.map((setup) => (
        <option key={setup.id} value={setup.id}>
          {setup.name}
        </option>
      ))}
      <option value={NEW}>+ New setup…</option>
    </select>
  );
}

/** Mistake or emotion chips (spec §9.1). Mistakes toggle freely; an emotion replaces the one the trade had. */
export function TagChips({
  trade,
  kind,
  onPick,
}: {
  trade: TradeView;
  kind: "mistake" | "emotion";
  onPick: (tagIds: string[]) => void;
}) {
  const { data: tags = [] } = useTags();
  const create = useCreateTag();
  const [adding, setAdding] = useState(false);
  const mine = new Set(trade.tagIds);
  const kindOf = new Map(tags.map((tag) => [tag.id, tag.kind]));
  // An archived tag shows only on a trade that has it, and can only be taken off.
  const shown = tags.filter((tag) => tag.kind === kind && (!tag.archived || mine.has(tag.id)));
  const add = (id: string) =>
    onPick([...trade.tagIds.filter((each) => kind === "mistake" || kindOf.get(each) !== "emotion"), id]);
  const toggle = (tag: Tag) =>
    mine.has(tag.id) ? onPick(trade.tagIds.filter((id) => id !== tag.id)) : add(tag.id);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((tag) => (
        <button
          key={tag.id}
          type="button"
          aria-pressed={mine.has(tag.id)}
          onClick={() => toggle(tag)}
          className={chipClass(mine.has(tag.id), tag.archived)}
        >
          {tag.name}
          {tag.archived ? " (archived)" : ""}
        </button>
      ))}
      {adding ? (
        <NameField
          label={`New ${kind} tag`}
          onClose={() => setAdding(false)}
          onSubmit={async (name) => {
            add((await create.mutateAsync({ name, kind })).id);
          }}
        />
      ) : (
        <button
          type="button"
          aria-label={kind === "emotion" ? "Add an emotion tag" : "Add a mistake tag"}
          onClick={() => setAdding(true)}
          className={chipClass(false, false)}
        >
          +
        </button>
      )}
    </span>
  );
}
