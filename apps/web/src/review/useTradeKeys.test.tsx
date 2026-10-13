import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TradeView } from "../api.js";
import { ShortcutsProvider } from "../keys/Shortcuts.js";
import { listOf, type OpenTrade } from "../nav/tradeList.js";
import type { TradeNav } from "../nav/useTradeNav.js";
import { ReviewPanel } from "./ReviewPanel.js";
import { useTradeKeys } from "./useTradeKeys.js";

const TAGS = [
  { id: "m1", name: "FOMO", kind: "mistake", archived: false },
  { id: "m2", name: "Late", kind: "mistake", archived: false },
  { id: "e1", name: "Calm", kind: "emotion", archived: false },
];
const scalp = (extra: Record<string, unknown> = {}) =>
  ({
    id: "t1",
    strategy: "scalp",
    book: "live",
    grade: null,
    excluded: false,
    notes: null,
    tagIds: [],
    setupId: null,
    reviewedAt: null,
    review: { status: "pending", missing: ["stop"] },
    ...extra,
  }) as unknown as TradeView;
const LIST = listOf([{ id: "t0" }, { id: "t1" }, { id: "t2" }], "Journal");
const NAV: TradeNav = {
  next: "t2",
  prev: "t0",
  place: { position: 2, total: 3, label: "Journal" },
  list: LIST,
};

function Harness({
  trade,
  onOpenTrade,
  chart,
  placeStop,
}: {
  trade: TradeView;
  onOpenTrade: OpenTrade;
  chart: boolean;
  placeStop: () => void;
}) {
  const keys = useTradeKeys({ trade, nav: NAV, onOpenTrade, chart });
  return (
    <>
      <ReviewPanel
        trade={trade}
        layout="strip"
        levels={
          <button type="button" data-key-target="place-stop" onClick={placeStop}>
            + Stop
          </button>
        }
      />
      {keys.error && <p data-testid="key-error">{keys.error}</p>}
    </>
  );
}

function setup(trade: TradeView, { chart = true, patchStatus = 200 } = {}) {
  const patches: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body)));
        return patchStatus === 200 ? json(trade) : json({ message: "nope" }, patchStatus);
      }
      if (url.includes("/api/tags")) return json(TAGS);
      return json([]);
    }),
  );
  const onOpenTrade = vi.fn();
  const placeStop = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ShortcutsProvider>
        <Harness trade={trade} onOpenTrade={onOpenTrade} chart={chart} placeStop={placeStop} />
      </ShortcutsProvider>
    </QueryClientProvider>,
  );
  return { patches, onOpenTrade, placeStop };
}
const press = (key: string, target: Element = document.body) =>
  fireEvent.keyDown(target, { key, code: /^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : key });

afterEach(() => vi.unstubAllGlobals());

describe("a trade's keys", () => {
  it("J and K move through the list", () => {
    const { onOpenTrade } = setup(scalp());
    press("j");
    press("k");
    expect(onOpenTrade.mock.calls).toEqual([
      ["t2", LIST],
      ["t0", LIST],
    ]);
  });

  it("1–5 set the grade, and the trade's own grade clears it", async () => {
    const first = setup(scalp());
    press("1");
    await waitFor(() => expect(first.patches).toEqual([{ grade: "A" }]));
    cleanup();
    vi.unstubAllGlobals();
    const again = setup(scalp({ grade: "F" }));
    press("5");
    await waitFor(() => expect(again.patches).toEqual([{ grade: null }]));
  });

  it("X toggles exclude", async () => {
    const { patches } = setup(scalp());
    press("x");
    await waitFor(() => expect(patches).toEqual([{ excluded: true }]));
  });

  it("Enter marks a queued scalp done, then opens the next", async () => {
    const { patches, onOpenTrade } = setup(scalp());
    press("Enter");
    await waitFor(() => expect(onOpenTrade).toHaveBeenCalledWith("t2", LIST));
    expect(patches).toEqual([{ reviewed: true }]);
  });

  it("Enter on a complete scalp only opens the next", async () => {
    const { patches, onOpenTrade } = setup(scalp({ review: { status: "done", missing: [] } }));
    press("Enter");
    expect(onOpenTrade).toHaveBeenCalledWith("t2", LIST);
    expect(patches).toEqual([]);
  });

  it("Enter after clicking grade B doesn't click B again", async () => {
    const { patches, onOpenTrade } = setup(scalp());
    const b = screen.getByRole("button", { name: "B" });
    fireEvent.pointerDown(b);
    b.focus();
    fireEvent.click(b);
    press("Enter", b);
    await waitFor(() => expect(onOpenTrade).toHaveBeenCalledWith("t2", LIST));
    expect(patches).toEqual([{ grade: "B" }, { reviewed: true }]);
  });

  it("stays, with the reason, when Enter's save fails", async () => {
    const { onOpenTrade } = setup(scalp(), { patchStatus: 400 });
    press("Enter");
    expect((await screen.findByTestId("key-error")).textContent).toBe("nope");
    expect(onOpenTrade).not.toHaveBeenCalled();
  });

  it("S opens the setup list, M and E reach the chips, arrows move, Esc gives the keys back", async () => {
    const showPicker = vi.fn();
    Object.defineProperty(HTMLSelectElement.prototype, "showPicker", {
      value: showPicker,
      configurable: true,
    });
    setup(scalp());
    press("s");
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Setup" }));
    expect(showPicker).toHaveBeenCalledOnce();
    await screen.findByRole("button", { name: "FOMO" });
    press("m");
    expect(document.activeElement?.textContent).toBe("FOMO");
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
    expect(document.activeElement?.textContent).toBe("Late");
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(document.activeElement).toBe(document.body);
    press("e");
    expect(document.activeElement?.textContent).toBe("Calm");
  });

  it("N puts the cursor after the notes already there, to add to them", () => {
    setup(scalp({ notes: "Took it early" }));
    press("n");
    const notes = screen.getByRole("textbox", { name: "Notes" }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(notes);
    expect([notes.selectionStart, notes.selectionEnd]).toEqual([13, 13]);
  });

  it("N focuses the notes, where J types instead of moving", () => {
    const { onOpenTrade } = setup(scalp());
    press("n");
    const notes = screen.getByRole("textbox", { name: "Notes" });
    expect(document.activeElement).toBe(notes);
    press("j", notes);
    expect(onOpenTrade).not.toHaveBeenCalled();
  });

  it("J goes on past a trade that's gone", () => {
    function Gone({ onOpenTrade }: { onOpenTrade: OpenTrade }) {
      useTradeKeys({ trade: undefined, nav: NAV, onOpenTrade, chart: false });
      return null;
    }
    const onOpenTrade = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ShortcutsProvider>
          <Gone onOpenTrade={onOpenTrade} />
        </ShortcutsProvider>
      </QueryClientProvider>,
    );
    press("j");
    expect(onOpenTrade).toHaveBeenCalledWith("t2", LIST);
  });

  it("P places the stop on a page with a chart, and not on one without", () => {
    const withChart = setup(scalp());
    press("p");
    expect(withChart.placeStop).toHaveBeenCalledOnce();
    cleanup();
    vi.unstubAllGlobals();
    const without = setup(scalp(), { chart: false });
    press("p");
    expect(without.placeStop).not.toHaveBeenCalled();
  });
});
