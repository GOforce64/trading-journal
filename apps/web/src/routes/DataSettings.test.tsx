import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataSettings, type MergeSummary, mergeSummaryText } from "./DataSettings.js";

const NONE: MergeSummary = {
  added: 0,
  updated: 0,
  kept: 0,
  deleted: 0,
  fillsAdded: 0,
  setupsAdded: 0,
  tagsAdded: 0,
  unchanged: false,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <DataSettings dataDir="/home/t/.local/share/trading-journal" />
    </QueryClientProvider>,
  );
  return { invalidate };
}

const choose = (name = "journal-fedora-2026-10-08-0912.tjbundle") => {
  const file = new File([new Uint8Array([31, 139])], name);
  fireEvent.change(screen.getByLabelText("Merge a bundle…"), { target: { files: [file] } });
  return file;
};

afterEach(() => vi.unstubAllGlobals());

describe("mergeSummaryText", () => {
  it("says what a merge did, leaving out what it didn't", () => {
    const all = { ...NONE, added: 12, updated: 3, kept: 2, deleted: 1, fillsAdded: 140 };
    expect(mergeSummaryText("f.tjbundle", all)).toBe(
      "Merged f.tjbundle: 12 trades added, 3 updated from the bundle, 2 kept as yours, 1 deleted, 140 fills added.",
    );
    expect(mergeSummaryText("f.tjbundle", { ...NONE, added: 1, fillsAdded: 1 })).toBe(
      "Merged f.tjbundle: 1 trade added, 1 fill added.",
    );
    expect(mergeSummaryText("f.tjbundle", { ...NONE, updated: 3 })).toBe(
      "Merged f.tjbundle: 3 trades updated from the bundle.",
    );
    expect(mergeSummaryText("f.tjbundle", { ...NONE, setupsAdded: 2, tagsAdded: 1 })).toBe(
      "Merged f.tjbundle: 2 setups added, 1 tag added.",
    );
    expect(mergeSummaryText("f.tjbundle", { ...NONE, unchanged: true })).toBe(
      "Nothing to merge: this journal already has everything in f.tjbundle.",
    );
  });
});

describe("DataSettings", () => {
  it("shows where the data lives, and exports the journal as a download", () => {
    renderPanel();
    expect(screen.getByText("/home/t/.local/share/trading-journal")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Export journal" });
    expect(link.getAttribute("href")).toBe("/api/bundle");
    expect(link.hasAttribute("download")).toBe(true);
  });

  it("sends a chosen bundle, says it's merging, then what the merge did, and refreshes every page", async () => {
    let answer: (response: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (answer = resolve)));
    vi.stubGlobal("fetch", fetchMock);
    const { invalidate } = renderPanel();
    const file = choose();
    expect(await screen.findByText("Merging…")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/bundle/merge",
      expect.objectContaining({ method: "POST", body: file }),
    );
    answer(json({ ...NONE, added: 2, fillsAdded: 5 }));
    expect(
      await screen.findByText(
        "Merged journal-fedora-2026-10-08-0912.tjbundle: 2 trades added, 5 fills added.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Merging…")).toBeNull();
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });

  it("shows why the server refused a file, in red", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: "invalid", message: "This isn't a journal bundle." }, 400)),
    );
    renderPanel();
    choose("photo.jpg");
    const refusal = await screen.findByText("This isn't a journal bundle.");
    expect(refusal.className).toContain("text-down");
  });
});
