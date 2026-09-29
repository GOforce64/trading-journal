import { Fragment, type KeyboardEvent, useState } from "react";
import { Section } from "../analytics/Section.js";
import {
  useCreateSetup,
  useCreateTag,
  useSetups,
  useTags,
  useUpdateSetup,
  useUpdateTag,
} from "../review/data.js";
import { INPUT, NameField } from "../review/Pickers.js";

type Strategy = "scalp" | "iron_fly" | null;
const STRATEGIES: { value: Strategy; label: string }[] = [
  { value: "scalp", label: "Scalps" },
  { value: "iron_fly", label: "Iron flies" },
  { value: null, label: "Both" },
];
const strategyLabel = (value: string | null) =>
  STRATEGIES.find((each) => each.value === value)?.label ?? "Both";
const BUTTON = "rounded-sm border border-line px-2 py-0.5 text-muted hover:border-accent hover:text-fg";
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

interface Draft {
  name: string;
  strategy: Strategy;
  description: string;
}

/** Setups and tags (scalp-review spec §10). The per-setup stat cards come with R. */
export function Playbook() {
  return (
    <div className="flex flex-col gap-3">
      <SetupsPanel />
      <TagsPanel />
    </div>
  );
}

function ShowArchived({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-1 normal-case tracking-normal">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      Show archived
    </label>
  );
}

function SetupsPanel() {
  const { data: setups = [], isLoading } = useSetups();
  const create = useCreateSetup();
  const update = useUpdateSetup();
  const [showArchived, setShowArchived] = useState(false);
  // The row being edited: a setup's id, "new" for + New setup, or none.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", strategy: "scalp", description: "" });
  const [problem, setProblem] = useState<string | null>(null);
  const shown = setups.filter((setup) => showArchived || !setup.archived);

  const edit = (id: string, from: Draft) => {
    setEditing(id);
    setDraft(from);
    setProblem(null);
  };
  const close = () => {
    setEditing(null);
    setProblem(null);
  };
  const save = () => {
    const input = {
      name: draft.name.trim(),
      strategy: draft.strategy,
      description: draft.description.trim() || null,
    };
    if (!input.name || !editing) return;
    const request =
      editing === "new" ? create.mutateAsync(input) : update.mutateAsync({ id: editing, patch: input });
    request.then(close, (error: unknown) => setProblem(messageOf(error)));
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key === "Enter") save();
    if (event.key === "Escape") close();
  };

  const editor = (
    <tr className="border-line border-t">
      <td className="py-1 pr-2">
        <input
          aria-label="Setup name"
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          onKeyDown={keys}
          className={`w-full ${INPUT}`}
        />
      </td>
      <td className="pr-2">
        <select
          aria-label="Strategy"
          value={draft.strategy ?? ""}
          onChange={(event) => setDraft({ ...draft, strategy: (event.target.value || null) as Strategy })}
          className={INPUT}
        >
          {STRATEGIES.map((each) => (
            <option key={each.label} value={each.value ?? ""}>
              {each.label}
            </option>
          ))}
        </select>
      </td>
      <td className="pr-2">
        <input
          aria-label="Description"
          value={draft.description}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          onKeyDown={keys}
          className={`w-full ${INPUT}`}
        />
      </td>
      <td />
      <td className="whitespace-nowrap text-right">
        <button type="button" onClick={save} className={BUTTON}>
          Save
        </button>{" "}
        <button type="button" onClick={close} className={BUTTON}>
          Cancel
        </button>
        {problem && <div className="text-[11px] text-down">{problem}</div>}
      </td>
    </tr>
  );

  return (
    <Section
      title="Setups"
      right={
        <span className="flex items-center gap-3">
          <ShowArchived checked={showArchived} onChange={setShowArchived} />
          <button
            type="button"
            onClick={() => edit("new", { name: "", strategy: "scalp", description: "" })}
            className="rounded-[2px] bg-accent px-2 py-0.5 text-white normal-case tracking-normal"
          >
            + New setup
          </button>
        </span>
      }
    >
      {isLoading && <p className="text-muted">Loading…</p>}
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="text-[9px] text-muted uppercase tracking-wider">
            <th className="w-48 py-1 text-left font-medium">Name</th>
            <th className="w-28 text-left font-medium">Strategy</th>
            <th className="text-left font-medium">Description</th>
            <th className="w-16 text-right font-medium">Trades</th>
            <th className="w-44" />
          </tr>
        </thead>
        <tbody>
          {shown.map((setup) =>
            editing === setup.id ? (
              <Fragment key={setup.id}>{editor}</Fragment>
            ) : (
              <tr
                key={setup.id}
                data-testid={`setup-${setup.id}`}
                className={`border-line border-t ${setup.archived ? "opacity-50" : ""}`}
              >
                <td className="py-1 text-fg">{setup.name}</td>
                <td className="text-muted">{strategyLabel(setup.strategy)}</td>
                <td className="text-muted">{setup.description ?? ""}</td>
                <td className="num text-right">{setup.tradeCount}</td>
                <td className="whitespace-nowrap text-right">
                  <button
                    type="button"
                    onClick={() =>
                      edit(setup.id, {
                        name: setup.name,
                        strategy: setup.strategy as Strategy,
                        description: setup.description ?? "",
                      })
                    }
                    className={BUTTON}
                  >
                    Edit
                  </button>{" "}
                  <button
                    type="button"
                    onClick={() => update.mutate({ id: setup.id, patch: { archived: !setup.archived } })}
                    className={BUTTON}
                  >
                    {setup.archived ? "Restore" : "Archive"}
                  </button>
                </td>
              </tr>
            ),
          )}
          {editing === "new" && editor}
        </tbody>
      </table>
    </Section>
  );
}

function TagsPanel() {
  const [showArchived, setShowArchived] = useState(false);
  return (
    <Section title="Tags" right={<ShowArchived checked={showArchived} onChange={setShowArchived} />}>
      <div className="grid gap-4 md:grid-cols-2">
        <TagList kind="mistake" title="Mistakes" showArchived={showArchived} />
        <TagList kind="emotion" title="Emotions" showArchived={showArchived} />
      </div>
    </Section>
  );
}

function TagList({
  kind,
  title,
  showArchived,
}: {
  kind: "mistake" | "emotion";
  title: string;
  showArchived: boolean;
}) {
  const { data: tags = [] } = useTags();
  const create = useCreateTag();
  const update = useUpdateTag();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const shown = tags.filter((tag) => tag.kind === kind && (showArchived || !tag.archived));
  return (
    <div>
      <div className="mb-1 text-[10px] text-muted uppercase tracking-wider">{title}</div>
      <ul aria-label={title} className="flex flex-col">
        {shown.map((tag) => (
          <li
            key={tag.id}
            className={`flex items-center gap-2 border-line border-t py-1 ${tag.archived ? "opacity-50" : ""}`}
          >
            {renaming === tag.id ? (
              <NameField
                label={`Rename ${tag.name}`}
                initial={tag.name}
                onClose={() => setRenaming(null)}
                onSubmit={(name) => update.mutateAsync({ id: tag.id, patch: { name } })}
              />
            ) : (
              <span className="text-fg">{tag.name}</span>
            )}
            <span className="num ml-auto text-muted">{tag.tradeCount}</span>
            <button type="button" onClick={() => setRenaming(tag.id)} className={BUTTON}>
              Rename
            </button>
            <button
              type="button"
              onClick={() => update.mutate({ id: tag.id, patch: { archived: !tag.archived } })}
              className={BUTTON}
            >
              {tag.archived ? "Restore" : "Archive"}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-1">
        {adding ? (
          <NameField
            label={`New ${kind} tag`}
            onClose={() => setAdding(false)}
            onSubmit={(name) => create.mutateAsync({ name, kind })}
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className={BUTTON}>
            + New
          </button>
        )}
      </div>
    </div>
  );
}
