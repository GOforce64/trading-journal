import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SCALP_ROWS } from "../analytics/scalps.fixture.js";
import { tradeRow } from "../analytics/testing.js";
import { Playbook, type PlaybookProps } from "./Playbook.js";

const SETUPS = [
  {
    id: "orb",
    name: "ORB breakout",
    description: "Break of the opening range",
    strategy: "scalp",
    archived: false,
    tradeCount: 3,
  },
  {
    id: "crush",
    name: "Earnings IV crush",
    description: null,
    strategy: "iron_fly",
    archived: false,
    tradeCount: 12,
  },
  { id: "old", name: "Old setup", description: null, strategy: null, archived: true, tradeCount: 0 },
];
const TAGS = [
  { id: "fomo", name: "FOMO entry", kind: "mistake", archived: false, tradeCount: 4 },
  { id: "calm", name: "Calm", kind: "emotion", archived: false, tradeCount: 7 },
  { id: "bored", name: "Bored", kind: "emotion", archived: true, tradeCount: 1 },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Answers the lists and `trades`; creations and changes succeed, or are refused with `refusal` (409). */
function stubApi(refusal?: string, trades: unknown[] = []) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? "GET").toUpperCase();
    if (url.includes("/api/trades")) return json(trades);
    if (url.includes("/api/risk/fill")) return json({ filled: 0, missing: [], unavailable: null });
    if (method !== "GET") {
      if (refusal) return json({ error: "duplicate", message: refusal }, 409);
      return json({ id: "new", ...JSON.parse(String(init?.body)) }, method === "POST" ? 201 : 200);
    }
    return json(url.includes("/api/tags") ? TAGS : SETUPS);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sent = (fetchMock: ReturnType<typeof stubApi>, method: string) =>
  fetchMock.mock.calls
    .filter((call) => String(call[1]?.method).toUpperCase() === method)
    .map((call) => [String(call[0]), JSON.parse(String(call[1]?.body))]);

function renderPlaybook(onOpenSetup?: PlaybookProps["onOpenSetup"]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Playbook onOpenSetup={onOpenSetup} />
    </QueryClientProvider>,
  );
}

const setupsPanel = () => screen.getByRole("region", { name: "Setups" });
const tagsPanel = () => screen.getByRole("region", { name: "Tags" });

afterEach(() => vi.unstubAllGlobals());

describe("Playbook", () => {
  it("lists the setups with their strategy, description and trade count, archived ones on request", async () => {
    stubApi();
    renderPlaybook();
    const orb = await screen.findByTestId("setup-orb");
    expect(orb.textContent).toContain("ORB breakout");
    expect(orb.textContent).toContain("Scalps");
    expect(orb.textContent).toContain("Break of the opening range");
    expect(orb.textContent).toContain("3");
    expect(screen.getByTestId("setup-crush").textContent).toContain("Iron flies");
    expect(screen.queryByTestId("setup-old")).toBeNull();
    fireEvent.click(within(setupsPanel()).getByLabelText("Show archived"));
    expect(screen.getByTestId("setup-old").textContent).toContain("Both");
  });

  it("adds a setup from + New setup", async () => {
    const fetchMock = stubApi();
    renderPlaybook();
    fireEvent.click(await screen.findByRole("button", { name: "+ New setup" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Setup name" }), {
      target: { value: "Gap and go" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Strategy" }), { target: { value: "" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Setup name" }), { key: "Enter" });
    await waitFor(() =>
      expect(sent(fetchMock, "POST")).toEqual([
        [expect.stringContaining("/api/setups"), { name: "Gap and go", strategy: null, description: null }],
      ]),
    );
  });

  it("edits a setup inline: Enter saves, Esc gives up", async () => {
    const fetchMock = stubApi();
    renderPlaybook();
    fireEvent.click(within(await screen.findByTestId("setup-orb")).getByRole("button", { name: "Edit" }));
    const name = screen.getByRole("textbox", { name: "Setup name" }) as HTMLInputElement;
    expect(name.value).toBe("ORB breakout");
    fireEvent.change(name, { target: { value: "Opening range break" } });
    fireEvent.keyDown(name, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Setup name" })).toBeNull();
    expect(sent(fetchMock, "PATCH")).toEqual([]);
    fireEvent.click(within(screen.getByTestId("setup-orb")).getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
      target: { value: "First 5 minutes" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Description" }), { key: "Enter" });
    await waitFor(() =>
      expect(sent(fetchMock, "PATCH")).toEqual([
        [
          expect.stringContaining("/api/setups/orb"),
          { name: "ORB breakout", strategy: "scalp", description: "First 5 minutes" },
        ],
      ]),
    );
  });

  it("archives and restores a setup", async () => {
    const fetchMock = stubApi();
    renderPlaybook();
    fireEvent.click(within(await screen.findByTestId("setup-orb")).getByRole("button", { name: "Archive" }));
    fireEvent.click(within(setupsPanel()).getByLabelText("Show archived"));
    fireEvent.click(within(screen.getByTestId("setup-old")).getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(sent(fetchMock, "PATCH")).toEqual([
        [expect.stringContaining("/api/setups/orb"), { archived: true }],
        [expect.stringContaining("/api/setups/old"), { archived: false }],
      ]),
    );
  });

  it("says why archiving a setup or a tag failed", async () => {
    stubApi("The server is read-only");
    renderPlaybook();
    fireEvent.click(within(await screen.findByTestId("setup-orb")).getByRole("button", { name: "Archive" }));
    expect(
      await within(setupsPanel()).findByText("Couldn't archive ORB breakout: The server is read-only"),
    ).toBeTruthy();
    const fomo = (await screen.findByText("FOMO entry")).closest("li") as HTMLElement;
    fireEvent.click(within(fomo).getByRole("button", { name: "Archive" }));
    expect(
      await within(tagsPanel()).findByText("Couldn't archive FOMO entry: The server is read-only"),
    ).toBeTruthy();
  });

  it("shows why a name was refused beside the row, keeping the draft", async () => {
    stubApi("A setup with that name exists");
    renderPlaybook();
    fireEvent.click(await screen.findByRole("button", { name: "+ New setup" }));
    const name = screen.getByRole("textbox", { name: "Setup name" }) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "orb breakout" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(await screen.findByText("A setup with that name exists")).toBeTruthy();
    expect(name.value).toBe("orb breakout");
  });

  it("lists mistakes and emotions side by side, and adds, renames and archives a tag", async () => {
    const fetchMock = stubApi();
    renderPlaybook();
    const mistakes = await screen.findByRole("list", { name: "Mistakes" });
    await waitFor(() => expect(mistakes.textContent).toContain("FOMO entry"));
    expect(mistakes.textContent).toContain("4");
    const emotions = screen.getByRole("list", { name: "Emotions" });
    expect(emotions.textContent).toContain("Calm");
    expect(emotions.textContent).not.toContain("Bored");
    fireEvent.click(within(tagsPanel()).getByLabelText("Show archived"));
    expect(screen.getByRole("list", { name: "Emotions" }).textContent).toContain("Bored");

    fireEvent.click(within(tagsPanel()).getAllByRole("button", { name: "+ New" })[0] as HTMLElement);
    const added = screen.getByRole("textbox", { name: "New mistake tag" });
    fireEvent.change(added, { target: { value: "Chased" } });
    fireEvent.keyDown(added, { key: "Enter" });
    await waitFor(() =>
      expect(sent(fetchMock, "POST")).toEqual([
        [expect.stringContaining("/api/tags"), { name: "Chased", kind: "mistake" }],
      ]),
    );

    const fomo = within(mistakes).getByText("FOMO entry").closest("li") as HTMLElement;
    fireEvent.click(within(fomo).getByRole("button", { name: "Rename" }));
    const renamed = screen.getByRole("textbox", { name: "Rename FOMO entry" });
    fireEvent.change(renamed, { target: { value: "FOMO" } });
    fireEvent.keyDown(renamed, { key: "Enter" });
    await waitFor(() => expect(sent(fetchMock, "PATCH")).toHaveLength(1));
    fireEvent.click(within(fomo).getByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(sent(fetchMock, "PATCH")).toEqual([
        [expect.stringContaining("/api/tags/fomo"), { name: "FOMO" }],
        [expect.stringContaining("/api/tags/fomo"), { archived: true }],
      ]),
    );
  });

  it("shows a card per setup with trades above the table, archived ones on request", async () => {
    const old = tradeRow({
      id: "o1",
      strategy: "scalp",
      underlying: "AMD",
      opened: "2026-09-21 09:40",
      closed: "2026-09-21 09:45",
      netPnl: 20,
      setupId: "old",
    });
    stubApi(undefined, [...SCALP_ROWS, old]);
    const onOpenSetup = vi.fn();
    renderPlaybook(onOpenSetup);
    const cards = await screen.findByRole("region", { name: "Setup stats · all time" });
    await waitFor(() => expect(within(cards).getByRole("article", { name: "ORB breakout" })).toBeTruthy());
    // VWAP reclaim isn't one of this page's setups, and Old setup is archived.
    expect(within(cards).getAllByRole("article")).toHaveLength(1);
    fireEvent.click(within(cards).getByRole("button", { name: "3 trades →" }));
    expect(onOpenSetup).toHaveBeenCalledWith("orb", "scalps");
    fireEvent.click(within(setupsPanel()).getByLabelText("Show archived"));
    expect(within(cards).getByRole("article", { name: "Old setup" })).toBeTruthy();
  });

  it("fetches the stock prices the scalps lack, once", async () => {
    const missing = tradeRow({
      id: "m1",
      strategy: "scalp",
      underlying: "NVDA",
      opened: "2026-09-21 09:40",
      closed: "2026-09-21 09:45",
      netPnl: 20,
      scalpPrices: null,
    });
    const fetchMock = stubApi(undefined, [missing]);
    renderPlaybook();
    await waitFor(() =>
      expect(sent(fetchMock, "POST")).toEqual([
        [expect.stringContaining("/api/risk/fill"), { tradeIds: ["m1"] }],
      ]),
    );
  });
});
