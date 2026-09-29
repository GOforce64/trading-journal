import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TradeView } from "../api.js";
import { ReviewPanel } from "./ReviewPanel.js";

const SETUPS = [
  { id: "orb", name: "ORB breakout", description: null, strategy: "scalp", archived: false, tradeCount: 3 },
  { id: "vwap", name: "VWAP reclaim", description: null, strategy: null, archived: false, tradeCount: 0 },
  {
    id: "crush",
    name: "Earnings IV crush",
    description: null,
    strategy: "iron_fly",
    archived: false,
    tradeCount: 9,
  },
  { id: "old", name: "Old ORB", description: null, strategy: "scalp", archived: true, tradeCount: 1 },
];
const TAGS = [
  { id: "fomo", name: "FOMO entry", kind: "mistake", archived: false, tradeCount: 0 },
  { id: "early", name: "Exited early", kind: "mistake", archived: false, tradeCount: 0 },
  { id: "moved", name: "Moved stop", kind: "mistake", archived: true, tradeCount: 2 },
  { id: "calm", name: "Calm", kind: "emotion", archived: false, tradeCount: 0 },
  { id: "rushed", name: "Rushed", kind: "emotion", archived: false, tradeCount: 0 },
];
/** The Sep 28 NVDA scalp, closed and waiting in the queue. */
const SCALP = {
  id: "t1",
  strategy: "scalp",
  book: "paper",
  underlying: "NVDA",
  openedAt: Date.UTC(2026, 8, 28, 13, 31),
  closedAt: Date.UTC(2026, 8, 28, 13, 46),
  netPnl: 44.74,
  fees: 2.26,
  notes: null,
  grade: null,
  setupId: null,
  excluded: false,
  reviewedAt: null,
  tagIds: [],
  legs: [],
  ironFly: null,
  scalp: null,
  metrics: null,
  review: { status: "pending", missing: ["setup", "grade", "stop"] },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface Replies {
  trade?: unknown;
  patch?: (body: Record<string, unknown>) => Response | Promise<Response>;
  created?: (url: string, body: Record<string, unknown>) => Response;
}

/** Answers the trade, the setups and tags, creations (201 unless `created` says otherwise) and patches. */
function stubApi({ trade = SCALP, patch = () => json(trade), created }: Replies = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? "GET").toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (method === "PATCH") return patch(body);
    if (method === "POST") {
      if (created) return created(url, body);
      return json({ id: url.includes("/api/tags") ? "new-tag" : "new-setup", archived: false, ...body }, 201);
    }
    if (url.includes("/api/setups")) return json(SETUPS);
    if (url.includes("/api/tags")) return json(TAGS);
    return json(trade);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const bodies = (fetchMock: ReturnType<typeof stubApi>, method: string) =>
  fetchMock.mock.calls
    .filter((call) => String(call[1]?.method).toUpperCase() === method)
    .map((call) => JSON.parse(String(call[1]?.body)));

/** The panel over the trade page's own query, as TradeDetail holds it. */
function Harness({ layout }: { layout: "strip" | "side" }) {
  const { data } = useQuery({
    queryKey: ["trade", "t1"],
    queryFn: async () => (await (await fetch("/api/trades/t1")).json()) as TradeView,
  });
  return data ? <ReviewPanel trade={data} layout={layout} /> : null;
}

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

function renderPanel(layout: "strip" | "side" = "strip", client = newClient()) {
  render(
    <QueryClientProvider client={client}>
      <Harness layout={layout} />
    </QueryClientProvider>,
  );
  return client;
}

const optionNames = (select: HTMLElement) =>
  within(select)
    .getAllByRole("option")
    .map((option) => option.textContent);

afterEach(() => vi.unstubAllGlobals());

describe("ReviewPanel", () => {
  it("saves a grade, and clears it when the same grade is pressed again", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, grade: "B" } });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "B" }));
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ grade: null }]));
  });

  it("offers this strategy's setups and those for both, with None and + New setup…", async () => {
    const fetchMock = stubApi();
    renderPanel();
    const select = await screen.findByRole("combobox", { name: "Setup" });
    await waitFor(() =>
      expect(optionNames(select)).toEqual(["None", "ORB breakout", "VWAP reclaim", "+ New setup…"]),
    );
    fireEvent.change(select, { target: { value: "vwap" } });
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ setupId: "vwap" }]));
  });

  it("keeps an archived setup the trade has, marked as archived", async () => {
    stubApi({ trade: { ...SCALP, setupId: "old" } });
    renderPanel();
    const select = (await screen.findByRole("combobox", { name: "Setup" })) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("old"));
    expect(optionNames(select)).toContain("Old ORB (archived)");
  });

  it("creates a setup inline, for this trade's strategy, and picks it", async () => {
    const fetchMock = stubApi();
    renderPanel();
    fireEvent.change(await screen.findByRole("combobox", { name: "Setup" }), { target: { value: "__new" } });
    const name = screen.getByRole("textbox", { name: "New setup name" });
    fireEvent.change(name, { target: { value: "Gap and go" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ setupId: "new-setup" }]));
    expect(bodies(fetchMock, "POST")).toEqual([{ name: "Gap and go", strategy: "scalp" }]);
  });

  it("shows why a name was refused beside the field, keeping what was typed", async () => {
    stubApi({ created: () => json({ error: "duplicate", message: "A setup with that name exists" }, 409) });
    renderPanel();
    fireEvent.change(await screen.findByRole("combobox", { name: "Setup" }), { target: { value: "__new" } });
    const name = screen.getByRole("textbox", { name: "New setup name" });
    fireEvent.change(name, { target: { value: "orb breakout" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(await screen.findByText("A setup with that name exists")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "New setup name" }) as HTMLInputElement).value).toBe(
      "orb breakout",
    );
  });

  it("adds a mistake to those the trade has", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, tagIds: ["early"] } });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "FOMO entry" }));
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ tagIds: ["early", "fomo"] }]));
  });

  it("removes a mistake the trade has", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, tagIds: ["early", "fomo"] } });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Exited early" }));
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ tagIds: ["fomo"] }]));
  });

  it("keeps one emotion: another replaces it, and the mistakes stay", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, tagIds: ["calm", "fomo"] } });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Rushed" }));
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ tagIds: ["fomo", "rushed"] }]));
  });

  it("builds a second pick on the first while the first is still saving", async () => {
    const fetchMock = stubApi({ patch: () => new Promise<Response>(() => {}) });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "FOMO entry" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "FOMO entry" }).getAttribute("aria-pressed")).toBe("true"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Exited early" }));
    await waitFor(() => expect(bodies(fetchMock, "PATCH").at(-1)).toEqual({ tagIds: ["fomo", "early"] }));
  });

  it("marks an archived tag the trade has, and lets it be removed", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, tagIds: ["moved"] } });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Moved stop (archived)" }));
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ tagIds: [] }]));
  });

  it("creates a tag inline and applies it, replacing the emotion", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, tagIds: ["calm"] } });
    renderPanel();
    await screen.findByRole("button", { name: "Calm" });
    fireEvent.click(screen.getByRole("button", { name: "Add an emotion tag" }));
    const name = screen.getByRole("textbox", { name: "New emotion tag" });
    fireEvent.change(name, { target: { value: "Bored" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ tagIds: ["new-tag"] }]));
    expect(bodies(fetchMock, "POST")).toEqual([{ name: "Bored", kind: "emotion" }]);
  });

  it("saves the notes when they lose focus, and only when they changed", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, notes: "chased" } });
    renderPanel();
    const notes = await screen.findByRole("textbox", { name: "Notes" });
    fireEvent.blur(notes);
    fireEvent.change(notes, { target: { value: "chased the open" } });
    fireEvent.blur(notes);
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ notes: "chased the open" }]));
  });

  it("saves the exclude flag", async () => {
    const fetchMock = stubApi();
    renderPanel();
    fireEvent.click(await screen.findByLabelText(/exclude from stats/i));
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ excluded: true }]));
  });

  it("offers Done reviewing on a scalp in the queue", async () => {
    const fetchMock = stubApi();
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Done reviewing" }));
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ reviewed: true }]));
  });

  it("puts a scalp marked done back in the queue", async () => {
    const fetchMock = stubApi({
      trade: { ...SCALP, reviewedAt: 5_000, review: { status: "done", missing: ["setup", "grade", "stop"] } },
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Back to queue" }));
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ reviewed: false }]));
  });

  it("gives a fly its own setups in the side panel, with no Done reviewing", async () => {
    stubApi({ trade: { ...SCALP, strategy: "iron_fly", review: null } });
    renderPanel("side");
    const select = await screen.findByRole("combobox", { name: "Setup" });
    await waitFor(() =>
      expect(optionNames(select)).toEqual(["None", "VWAP reclaim", "Earnings IV crush", "+ New setup…"]),
    );
    expect(screen.queryByRole("button", { name: "Done reviewing" })).toBeNull();
  });

  it("says why a save failed", async () => {
    stubApi({ patch: () => json({ error: "invalid", message: "A trade has at most one emotion" }, 400) });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "C" }));
    expect(await screen.findByText("Couldn't save: A trade has at most one emotion")).toBeTruthy();
  });

  it("marks the trade lists stale after a change, so Analytics and the lists refetch", async () => {
    stubApi();
    const client = newClient();
    client.setQueryData(["trades", { all: true }], []);
    renderPanel("strip", client);
    fireEvent.click(await screen.findByRole("button", { name: "B" }));
    await waitFor(() => expect(client.getQueryState(["trades", { all: true }])?.isInvalidated).toBe(true));
  });
});
