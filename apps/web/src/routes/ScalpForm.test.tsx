import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewScalp } from "./NewScalp.js";
import { ScalpForm, type ScalpFormValues } from "./ScalpForm.js";

const NO_KEY = {
  symbol: "NVDA",
  expirations: [],
  unavailable: { reason: "no_key", message: "Add an Alpaca key in Settings to pick from the chain." },
};

/** No chain (no key), no company name, and `created` for a POST. */
function stubApi(created: unknown = { id: "new-scalp" }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    const method = String(init?.method ?? "GET").toUpperCase();
    const body = path.startsWith("/api/chains/")
      ? NO_KEY
      : path.startsWith("/api/company/")
        ? { name: null }
        : method === "POST"
          ? created
          : {};
    return new Response(JSON.stringify(body), {
      status: method === "POST" ? 201 : 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

function setup(initial?: Partial<ScalpFormValues>) {
  stubApi();
  const onSubmit = vi.fn();
  render(
    <QueryClientProvider client={client()}>
      <ScalpForm initial={initial} submitLabel="Save scalp" onSubmit={onSubmit} />
    </QueryClientProvider>,
  );
  return { onSubmit };
}

/** This morning's NVDA scalp, typed in. */
function typeNvda() {
  fill("Underlying", "NVDA");
  fill("Call or put", "C");
  fill("Expiry", "2026-09-28");
  fill("Strike", "232.5");
  fill("Size", "2");
  fill("Entry price", "1.06");
  fill("Exit price", "1.295");
  fill("Entry fees", "0.93");
  fill("Exit fees", "1.33");
}

afterEach(() => vi.unstubAllGlobals());

describe("ScalpForm", () => {
  it("works out the cost, P&L and return on cost as you type", () => {
    setup();
    typeNvda();
    const derived = screen.getByTestId("scalp-derived").textContent;
    expect(derived).toContain("$212.00"); // cost: 2 × 100 × 1.06
    expect(derived).toContain("+$47.00"); // before fees
    expect(derived).toContain("+$44.74"); // net
    expect(derived).toContain("+21.10%");
  });

  it("saves one long leg, with the P&L the legs imply", () => {
    const { onSubmit } = setup();
    typeNvda();
    fireEvent.click(screen.getByRole("button", { name: "Save scalp" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      strategy: "scalp",
      book: "paper",
      underlying: "NVDA",
      structureLabel: "Long call",
      netPnl: 44.74,
      fees: 2.26,
      feesOpen: 0.93,
      feesClose: 1.33,
      legs: [
        {
          right: "C",
          strike: 232.5,
          expiry: "2026-09-28",
          quantity: 2,
          multiplier: 100,
          openPrice: 1.06,
          closePrice: 1.295,
        },
      ],
    });
  });

  it("keeps a scalp with no exit open", () => {
    const { onSubmit } = setup();
    typeNvda();
    fill("Exit price", "");
    fireEvent.click(screen.getByRole("button", { name: "Save scalp" }));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      netPnl: null,
      legs: [expect.objectContaining({ closePrice: null })],
    });
  });

  it("refuses a fractional size, and a scalp without a strike", () => {
    const { onSubmit } = setup();
    typeNvda();
    fill("Size", "1.5");
    fireEvent.click(screen.getByRole("button", { name: "Save scalp" }));
    expect(screen.getByText("Sizes are whole contracts.")).toBeTruthy();
    fill("Size", "2");
    fill("Strike", "");
    fireEvent.click(screen.getByRole("button", { name: "Save scalp" }));
    expect(screen.getByText("A strike, an expiry, a size and an entry price are required.")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("starts from a scalp being edited", () => {
    setup({ underlying: "TSLA", right: "P", strike: "365", size: "2", entry: "1.64", exit: "3.155" });
    expect((screen.getByLabelText("Underlying") as HTMLInputElement).value).toBe("TSLA");
    expect((screen.getByLabelText("Call or put") as HTMLSelectElement).value).toBe("P");
  });

  it("shows a notice above the form", () => {
    stubApi();
    render(
      <QueryClientProvider client={client()}>
        <ScalpForm submitLabel="Save" onSubmit={vi.fn()} notice={<p>Synced from IBKR.</p>} />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Synced from IBKR.")).toBeTruthy();
  });
});

describe("NewScalp", () => {
  it("posts the scalp and reports the new id", async () => {
    const fetchMock = stubApi({ id: "new-scalp" });
    const onCreated = vi.fn();
    render(
      <QueryClientProvider client={client()}>
        <NewScalp onCreated={onCreated} />
      </QueryClientProvider>,
    );
    typeNvda();
    fireEvent.click(screen.getByRole("button", { name: "Save scalp" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("new-scalp"));
    const post = fetchMock.mock.calls.find((call) => String(call[1]?.method).toUpperCase() === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ strategy: "scalp", netPnl: 44.74 });
  });

  it("refreshes the trade lists and the review queue, so the new scalp shows up in them", async () => {
    stubApi({ id: "new-scalp" });
    const listed = vi.fn(async () => []);
    function Lists() {
      useQuery({ queryKey: ["trades", { review: "pending" }], queryFn: listed });
      return null;
    }
    const onCreated = vi.fn();
    render(
      <QueryClientProvider client={client()}>
        <Lists />
        <NewScalp onCreated={onCreated} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(listed).toHaveBeenCalledTimes(1));
    typeNvda();
    fireEvent.click(screen.getByRole("button", { name: "Save scalp" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    await waitFor(() => expect(listed).toHaveBeenCalledTimes(2));
  });
});
