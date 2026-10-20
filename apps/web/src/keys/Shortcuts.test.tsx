import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ShortcutsProvider, useModalLayer, useShortcut } from "./Shortcuts.js";

function Page({ run, modal = false }: { run: (key: string) => void; modal?: boolean }) {
  useShortcut("j", "Next trade", "Review", () => run("j"));
  useShortcut("Enter", "Done, then next", "Review", () => run("Enter"));
  return (
    <div>
      <textarea aria-label="Notes" data-key-target="notes" />
      <input aria-label="Search" />
      <button type="button">B</button>
      {modal && <Modal />}
    </div>
  );
}
function Modal() {
  useModalLayer(true);
  return null;
}
function Later({ run }: { run: (key: string) => void }) {
  useShortcut("j", "Later J", "Review", () => run("later"));
  return null;
}

const press = (key: string, init: Partial<KeyboardEventInit> = {}, target: Element = document.body) =>
  fireEvent.keyDown(target, { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, ...init });

describe("the shortcut layer", () => {
  it("runs a registered key, also from another layout", () => {
    const run = vi.fn();
    render(
      <ShortcutsProvider>
        <Page run={run} />
      </ShortcutsProvider>,
    );
    press("j");
    fireEvent.keyDown(document.body, { key: "ξ", code: "KeyJ" });
    expect(run.mock.calls).toEqual([["j"], ["j"]]);
  });

  it("leaves typing alone, and Esc in a review field gives the keys back", () => {
    const run = vi.fn();
    render(
      <ShortcutsProvider>
        <Page run={run} />
      </ShortcutsProvider>,
    );
    const notes = screen.getByRole("textbox", { name: "Notes" });
    notes.focus();
    press("j", {}, notes);
    press("j", {}, screen.getByRole("textbox", { name: "Search" }));
    expect(run).not.toHaveBeenCalled();
    press("Escape", {}, notes);
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves modifier keys and handled keys alone", () => {
    const run = vi.fn();
    render(
      <ShortcutsProvider>
        <Page run={run} />
      </ShortcutsProvider>,
    );
    press("j", { ctrlKey: true });
    press("j", { altKey: true });
    const handled = new KeyboardEvent("keydown", { key: "j", code: "KeyJ", bubbles: true, cancelable: true });
    handled.preventDefault();
    document.body.dispatchEvent(handled);
    expect(run).not.toHaveBeenCalled();
  });

  it("is off while a modal layer is up", () => {
    const run = vi.fn();
    const { rerender } = render(
      <ShortcutsProvider>
        <Page run={run} modal />
      </ShortcutsProvider>,
    );
    press("j");
    expect(run).not.toHaveBeenCalled();
    rerender(
      <ShortcutsProvider>
        <Page run={run} />
      </ShortcutsProvider>,
    );
    press("j");
    expect(run).toHaveBeenCalledOnce();
  });

  it("takes Enter from a button the mouse focused, not from one reached by Tab", () => {
    const run = vi.fn();
    render(
      <ShortcutsProvider>
        <Page run={run} />
      </ShortcutsProvider>,
    );
    const button = screen.getByRole("button", { name: "B" });
    fireEvent.pointerDown(button);
    button.focus();
    press("Enter", {}, button);
    expect(run).toHaveBeenCalledWith("Enter");
    run.mockClear();
    button.blur();
    press("Tab");
    button.focus();
    press("Enter", {}, button);
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps Enter from clicking a mouse-focused button again where Enter does nothing", () => {
    render(
      <ShortcutsProvider>
        <button type="button">B</button>
      </ShortcutsProvider>,
    );
    const button = screen.getByRole("button", { name: "B" });
    fireEvent.pointerDown(button);
    button.focus();
    // fireEvent returns false when the default (the button's click) was prevented.
    expect(press("Enter", {}, button)).toBe(false);
    button.blur();
    press("Tab");
    button.focus();
    expect(press("Enter", {}, button)).toBe(true);
  });

  it("counts a click on a button Tab already focused as the mouse's (launcher spec §14)", () => {
    render(
      <ShortcutsProvider>
        <button type="button">B</button>
      </ShortcutsProvider>,
    );
    const button = screen.getByRole("button", { name: "B" });
    press("Tab");
    button.focus();
    // Already focused: the click fires no focus event of its own.
    fireEvent.pointerDown(button);
    expect(press("Enter", {}, button)).toBe(false);
  });

  it("lets the latest registration win, and forgets one that unmounts", () => {
    const run = vi.fn();
    function Both() {
      const [later, setLater] = useState(true);
      return (
        <>
          <Page run={run} />
          {later && <Later run={run} />}
          <button type="button" onClick={() => setLater(false)}>
            drop
          </button>
        </>
      );
    }
    render(
      <ShortcutsProvider>
        <Both />
      </ShortcutsProvider>,
    );
    press("j");
    fireEvent.click(screen.getByRole("button", { name: "drop" }));
    press("j");
    expect(run.mock.calls).toEqual([["later"], ["j"]]);
  });

  it("? shows every key by group, and page keys stay off until it closes", () => {
    const run = vi.fn();
    render(
      <ShortcutsProvider>
        <Page run={run} />
      </ShortcutsProvider>,
    );
    fireEvent.keyDown(document.body, { key: "?", code: "Slash" });
    const help = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    // Focus moves into the help, so Enter can't click a button behind it.
    expect(document.activeElement).toBe(help);
    expect(help.textContent).toContain("Next trade");
    expect(help.textContent).toContain("Search pages and trades");
    expect(help.textContent).toContain("Review");
    press("j");
    expect(run).not.toHaveBeenCalled();
    press("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    press("j");
    expect(run).toHaveBeenCalledOnce();
  });
});
