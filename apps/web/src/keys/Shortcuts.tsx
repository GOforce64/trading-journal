import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { keyName } from "./keyName.js";

/** A registered key, as the help lists it. */
export interface ShortcutInfo {
  key: string;
  label: string;
  group: string;
}
interface Entry extends ShortcutInfo {
  run: () => void;
}

/** The keys pages have registered, and how many modal layers are up (spec §4). */
class Registry {
  private entries: Entry[] = [];
  private listeners = new Set<() => void>();
  private snapshot: readonly ShortcutInfo[] = [];
  layers = 0;

  add(entry: Entry): () => void {
    this.entries.push(entry);
    this.changed();
    return () => {
      this.entries = this.entries.filter((each) => each !== entry);
      this.changed();
    };
  }

  /** The latest registration of a key. */
  find(key: string): Entry | undefined {
    return this.entries.findLast((each) => each.key === key);
  }

  list = (): readonly ShortcutInfo[] => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private changed() {
    // One line a key: the one that runs.
    const seen = new Set<string>();
    this.snapshot = [...this.entries]
      .reverse()
      .filter((each) => !seen.has(each.key) && seen.add(each.key))
      .reverse()
      .map(({ key, label, group }) => ({ key, label, group }));
    for (const listener of this.listeners) listener();
  }
}

const RegistryContext = createContext<Registry | null>(null);

const TYPING =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable=""], [contenteditable="true"]';
const ACTIVATES = 'button, a[href], [role="button"], summary';

export function useShortcut(key: string | null, label: string, group: string, run: () => void): void {
  const registry = useContext(RegistryContext);
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    if (!registry || key == null) return;
    return registry.add({ key, label, group, run: () => latest.current() });
  }, [registry, key, label, group]);
}

export function useModalLayer(active: boolean): void {
  const registry = useContext(RegistryContext);
  useEffect(() => {
    if (!registry || !active) return;
    registry.layers += 1;
    return () => {
      registry.layers -= 1;
    };
  }, [registry, active]);
}

const KEY_TEXT: Record<string, string> = { Enter: "Enter", Escape: "Esc", "?": "?" };

function Help({ registry, onClose }: { registry: Registry; onClose: () => void }) {
  const list = useSyncExternalStore(registry.subscribe, registry.list);
  useModalLayer(true);
  // Focus comes in, so Enter can't click the button behind; on close it goes to the page, not back to that button.
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => dialog.current?.focus(), []);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "?") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [onClose]);
  const groups = new Map<string, ShortcutInfo[]>([["General", []]]);
  for (const each of list) groups.set(each.group, [...(groups.get(each.group) ?? []), each]);
  const row = (key: string, label: string) => (
    <div key={key} className="flex gap-3 py-0.5">
      <dt className="w-14 shrink-0">
        <kbd className="num rounded-[2px] border border-line px-1 text-fg">{key}</kbd>
      </dt>
      <dd className="text-muted">{label}</dd>
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        className="relative w-96 rounded-sm border border-line bg-panel p-4 text-[12px] outline-none"
      >
        <h2 className="mb-2 font-semibold text-fg">Keyboard shortcuts</h2>
        {[...groups].map(([group, items]) => (
          <section key={group} className="mb-2">
            <h3 className="text-[10px] text-muted uppercase tracking-wider">{group}</h3>
            <dl>
              {group === "General" && row("Ctrl K", "Search pages and trades")}
              {items.map((each) => row(KEY_TEXT[each.key] ?? each.key.toUpperCase(), each.label))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}

/** The app's one key listener (spec §4): pages register keys; fields, modifiers and modal layers keep them off. */
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const registry = useMemo(() => new Registry(), []);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    // Enter belongs to the layer on a button the mouse focused, so a click then Enter doesn't click it again.
    let lastInput: "pointer" | "key" = "key";
    let pointerFocus = false;
    const onPointer = () => {
      lastInput = "pointer";
    };
    const onFocus = () => {
      pointerFocus = lastInput === "pointer";
    };
    const onKey = (event: KeyboardEvent) => {
      lastInput = "key";
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const name = keyName(event);
      if (!name) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.matches(TYPING)) {
        // Esc gives a review field's focus back to the page, so the keys work again (spec §6.3).
        if (name === "Escape" && target instanceof HTMLElement && target.closest("[data-key-target]"))
          target.blur();
        return;
      }
      if (registry.layers > 0) return;
      const onButton = name === "Enter" && target?.matches(ACTIVATES) === true;
      if (onButton && !pointerFocus) return;
      const entry = registry.find(name);
      // Even where Enter does nothing, it mustn't click again the button the mouse just clicked (a grade would clear).
      if (!entry && !onButton) return;
      event.preventDefault();
      entry?.run();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("focus", onFocus, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("focus", onFocus, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [registry]);

  return (
    <RegistryContext.Provider value={registry}>
      <HelpKey onOpen={() => setHelp(true)} />
      {children}
      {help && <Help registry={registry} onClose={() => setHelp(false)} />}
    </RegistryContext.Provider>
  );
}

function HelpKey({ onOpen }: { onOpen: () => void }) {
  useShortcut("?", "Show shortcuts", "General", onOpen);
  return null;
}
