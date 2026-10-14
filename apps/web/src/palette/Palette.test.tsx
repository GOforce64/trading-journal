import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ShortcutsProvider, useShortcut } from "../keys/Shortcuts.js";
import { Palette, usePaletteKey } from "./Palette.js";

beforeAll(() => {
  // cmdk scrolls the selected row into view and measures its list; jsdom has no layout.
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const trade = (id: string, iso: string, extra: Record<string, unknown> = {}) => ({
  id,
  openedAt: Date.parse(iso),
  underlying: "NVDA",
  strategy: "scalp",
  book: "live",
  setupId: null,
  netPnl: 100,
  legs: [{ strike: 180, right: "C" }],
  risk: { r: 1.2 },
  missedRisk: null,
  ...extra,
});
const TRADES = [
  trade("t1", "2026-09-28T13:35:00Z"),
  trade("t2", "2026-09-28T14:00:00Z", { book: "paper" }),
  trade("t4", "2026-09-28T15:00:00Z", { book: "missed", netPnl: null }),
];

function stub(trades: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown, code = 200) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: code,
            headers: { "content-type": "application/json" },
          }),
        );
      if (url.includes("/api/trades"))
        return trades === "never" ? new Promise<Response>(() => {}) : json(trades, status);
      return json([]);
    }),
  );
}

function Harness({ onOpenTrade = vi.fn(), onGo = vi.fn(), onJ = vi.fn() }) {
  const [open, setOpen] = useState(false);
  usePaletteKey(() => setOpen((now) => !now));
  useShortcut("j", "Next trade", "Review", onJ);
  return (
    <>
      <input aria-label="Elsewhere" />
      <Palette open={open} onOpenChange={setOpen} onOpenTrade={onOpenTrade} onGo={onGo} />
    </>
  );
}
function renderPalette(props: Parameters<typeof Harness>[0] = {}) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ShortcutsProvider>
        <Harness {...props} />
      </ShortcutsProvider>
    </QueryClientProvider>,
  );
}
const open = () =>
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Elsewhere" }), {
    key: "k",
    code: "KeyK",
    ctrlKey: true,
  });
const input = () => screen.getByRole("combobox");
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });

afterEach(() => vi.unstubAllGlobals());

describe("the palette", () => {
  it("opens with Ctrl+K from a field and closes with it, listing the pages", () => {
    stub(TRADES);
    renderPalette();
    open();
    expect(screen.getAllByRole("option")).toHaveLength(15);
    expect(screen.getByText("↑↓ move · Enter open · Esc close")).toBeTruthy();
    fireEvent.keyDown(input(), { key: "k", code: "KeyK", ctrlKey: true });
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("finds trades newest first, and Enter opens one with every match as its list", async () => {
    stub(TRADES);
    const onOpenTrade = vi.fn();
    renderPalette({ onOpenTrade });
    open();
    type("nvda 28/9");
    await screen.findByText("Trades · 3");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onOpenTrade).toHaveBeenCalledWith("t4", {
      kind: "ids",
      ids: ["t4", "t2", "t1"],
      label: "nvda 28/9",
    });
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("goes to a page", () => {
    stub(TRADES);
    const onGo = vi.fn();
    renderPalette({ onGo });
    open();
    type("an sc");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onGo).toHaveBeenCalledWith("/analytics?tab=scalps");
  });

  it("says which word matches nothing", async () => {
    stub(TRADES);
    renderPalette();
    open();
    type("nvda xyz");
    expect(await screen.findByText("No trades match 'xyz'")).toBeTruthy();
  });

  it("shows the first 50 and says how many more", async () => {
    stub(
      Array.from({ length: 60 }, (_, i) =>
        trade(`s${i}`, `2026-09-${String((i % 28) + 1).padStart(2, "0")}T14:00:00Z`, { underlying: "SPY" }),
      ),
    );
    renderPalette();
    open();
    type("spy");
    expect(await screen.findByText("+10 more · keep typing to narrow")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(50);
  });

  it("types J into its search instead of moving trades", () => {
    stub(TRADES);
    const onJ = vi.fn();
    renderPalette({ onJ });
    open();
    fireEvent.keyDown(input(), { key: "j", code: "KeyJ" });
    fireEvent.keyDown(document.body, { key: "j", code: "KeyJ" });
    expect(onJ).not.toHaveBeenCalled();
  });

  it("says when trades are loading", async () => {
    stub("never");
    renderPalette();
    open();
    type("nvda");
    expect(await screen.findByText("Loading trades…")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("says when trades couldn't load, and the pages still work", async () => {
    stub({ error: "boom" }, 500);
    renderPalette();
    open();
    type("set");
    await waitFor(() => expect(screen.getByText("Couldn't load trades")).toBeTruthy());
    expect(screen.getByRole("option", { name: "Settings" })).toBeTruthy();
  });
});
