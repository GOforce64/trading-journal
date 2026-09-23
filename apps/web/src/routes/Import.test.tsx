import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Import } from "./Import.js";

const preview = {
  warnings: ["Collected 2 trades, the page counter said 3. Some rows may be missing."],
  counts: { new: 1, existing: 0, skipped: 1 },
  rows: [
    {
      status: "new",
      ticker: "XYZ",
      structure: "Short Straddle",
      openedAt: 1_788_000_000_000,
      closedAt: 1_788_086_400_000,
      netPnl: 200,
      flags: ["1 wing"],
      reason: null,
    },
    {
      status: "skipped",
      ticker: "SPY",
      structure: "Short Iron Condor",
      openedAt: null,
      closedAt: null,
      netPnl: null,
      flags: [],
      reason: "strategy VRP",
    },
  ],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Import />
    </QueryClientProvider>,
  );
}

const paste = (text: string) =>
  fireEvent.change(screen.getByLabelText("Snippet output"), { target: { value: text } });

afterEach(() => vi.unstubAllGlobals());

describe("Import", () => {
  it("previews the pasted export, then imports the new trades", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(preview))
      .mockResolvedValueOnce(json({ imported: 1, backupFile: "/data/backups/journal-x.db" }));
    vi.stubGlobal("fetch", fetchMock);
    setup();

    paste('{"format":"oquants-cells/1"}');
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => expect(screen.getByText("strategy VRP")).toBeTruthy());
    expect(screen.getByText("1 wing")).toBeTruthy();
    expect(screen.getByText(/page counter said 3/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Import 1" }));
    await waitFor(() => expect(screen.getByText(/1 trade imported/)).toBeTruthy());
    expect(screen.getByText(/journal-x\.db/)).toBeTruthy();
  });

  it("says so, without calling the server, when the paste is not JSON", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setup();

    paste("Copied 12 trades");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByText(/isn't the snippet's output/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's reason when oQuants changed its table", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: 'the "Cost" column is missing' }, 422)));
    setup();

    paste('{"format":"oquants-cells/1"}');
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => expect(screen.getByText(/"Cost" column is missing/)).toBeTruthy());
  });
});
