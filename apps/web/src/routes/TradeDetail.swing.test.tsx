import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { nyWallClock } from "@tj/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutsProvider } from "../keys/Shortcuts.js";
import { TradeDetail } from "./TradeDetail.js";

vi.mock("../chart/SwingChart.js", () => ({
  SwingChart: ({ lines }: { lines: { label: string }[] }) => (
    <div data-testid="swing-chart">{lines.map((line) => line.label).join(" ")}</div>
  ),
}));
vi.mock("../review/ReviewPanel.js", () => ({
  ReviewPanel: ({ layout }: { layout: string }) => <div data-testid="review-panel">{layout}</div>,
}));
vi.mock("../review/ScalpWorkspace.js", () => ({
  ScalpWorkspace: () => <div data-testid="scalp-workspace" />,
}));

const leg = (id: string, strike: number, quantity: number, openPrice: number, closePrice: number | null) => ({
  id,
  right: "C",
  strike,
  expiry: "2026-11-06",
  quantity,
  multiplier: 100,
  openPrice,
  closePrice,
});
const spread = {
  id: "t1",
  strategy: "swing",
  chosenStrategy: null,
  book: "paper",
  source: "ibkr_flex",
  factsEditedAt: null,
  underlying: "NVDA",
  underlyingName: "NVIDIA",
  structureLabel: "Call debit spread",
  openedAt: nyWallClock("2026-10-02", 615),
  closedAt: nyWallClock("2026-10-09", 660),
  netPnl: 402.1,
  fees: 2.9,
  feesOpen: 1.45,
  feesClose: 1.45,
  notes: null,
  grade: null,
  excluded: false,
  excludeReason: null,
  setupId: null,
  tagIds: [],
  ironFly: null,
  metrics: null,
  review: null,
  risk: null,
  missedRisk: null,
  scalp: null,
  reviewedAt: null,
  fills: [],
  attachments: [],
  legs: [leg("a", 230, 1, 5.1, 9), leg("b", 240, -1, 1.3, 1.15)],
};
const single = {
  ...spread,
  chosenStrategy: "swing",
  structureLabel: "Long call",
  netPnl: 100,
  legs: [leg("a", 230, 1, 5, 6.02)],
};
const scalp = { ...single, strategy: "scalp", chosenStrategy: null };

function show(body: unknown, patchReply?: Response) {
  const patches: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const json = (payload: unknown) =>
        new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
      if (init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body)));
        return patchReply ?? json(body);
      }
      const url = String(input);
      if (url.includes("/api/option-quotes")) return json({ quotes: {}, available: false });
      if (url.includes("/api/trades/t1")) return json(body);
      return json([]);
    }),
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
    >
      <ShortcutsProvider>
        <TradeDetail tradeId="t1" />
      </ShortcutsProvider>
    </QueryClientProvider>,
  );
  return patches;
}
const press = (key: string) => fireEvent.keyDown(document.body, { key, code: `Key${key.toUpperCase()}` });

afterEach(() => vi.unstubAllGlobals());

describe("a swing's page (swing spec §5)", () => {
  it("shows a call spread's maths, its chart lines and the review panel, with no switch and no Edit", async () => {
    show(spread);
    expect((await screen.findByTestId("swing-chart")).textContent).toBe("230 240 BE 233.80");
    expect(screen.getByTestId("tile-debit").textContent).toContain("$380.00");
    expect(screen.getByTestId("tile-max-profit").textContent).toContain("$620.00");
    expect(screen.getByTestId("tile-max-profit").textContent).toContain("width 10");
    expect(screen.getByTestId("tile-break-even").textContent).toContain("233.80");
    expect(screen.getByTestId("tile-pct-max").textContent).toContain("+64.85%");
    expect(screen.getByTestId("tile-held").textContent).toContain("7 days");
    expect(screen.getByTestId("tile-held").textContent).toContain("5 sessions");
    expect(screen.getByTestId("tile-dte").textContent).toContain("6 Nov 2026");
    expect(screen.getByTestId("header-pct").textContent).toBe("+105.82%");
    expect(screen.getByTestId("review-panel").textContent).toBe("side");
    expect(screen.queryByRole("group", { name: "Scalp or swing" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("gives a single swing the switch, with Swing pressed, and its return on debit", async () => {
    show(single);
    const swing = await screen.findByRole("button", { name: "Swing" });
    expect(swing.getAttribute("aria-pressed")).toBe("true");
    // $100 on a $500 debit.
    expect(screen.getByTestId("tile-return").textContent).toContain("+20.00%");
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("switches with a click and with W", async () => {
    const patches = show(single);
    fireEvent.click(await screen.findByRole("button", { name: "Scalp" }));
    await waitFor(() => expect(patches).toEqual([{ chosenStrategy: "scalp" }]));
    press("w");
    await waitFor(() => expect(patches).toHaveLength(2));
  });

  it("says why a switch was refused", async () => {
    show(
      single,
      new Response(
        JSON.stringify({ error: "invalid", message: "Only a single bought call or put can be switched." }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Scalp" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Only a single bought call or put can be switched.",
    );
  });

  it("notes that IBKR settles a synced swing past its expiry", async () => {
    show({
      ...spread,
      openedAt: nyWallClock("2026-01-05", 615),
      closedAt: null,
      netPnl: null,
      legs: spread.legs.map((each) => ({ ...each, expiry: "2026-01-16", closePrice: null })),
    });
    expect(
      await screen.findByText(
        "IBKR books the expiry overnight: the next sync closes this trade at its expiry values.",
      ),
    ).toBeTruthy();
  });
});

describe("the overnight hint on a scalp (swing spec §5.3)", () => {
  it("asks about a scalp held overnight, and Keep as scalp answers it", async () => {
    const patches = show(scalp);
    expect(await screen.findByText("Held overnight: a swing?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep as scalp" }));
    await waitFor(() => expect(patches).toEqual([{ chosenStrategy: "scalp" }]));
  });

  it("switches from the hint", async () => {
    const patches = show(scalp);
    fireEvent.click(await screen.findByRole("button", { name: "Switch to swing" }));
    await waitFor(() => expect(patches).toEqual([{ chosenStrategy: "swing" }]));
  });

  it("doesn't ask about a same-day scalp", async () => {
    show({ ...scalp, closedAt: scalp.openedAt + 15 * 60_000 });
    await screen.findByTestId("scalp-workspace");
    expect(screen.queryByText("Held overnight: a swing?")).toBeNull();
  });

  it("doesn't ask again once the user kept it as a scalp", async () => {
    show({ ...scalp, chosenStrategy: "scalp" });
    await screen.findByTestId("scalp-workspace");
    expect(screen.queryByText("Held overnight: a swing?")).toBeNull();
  });
});
