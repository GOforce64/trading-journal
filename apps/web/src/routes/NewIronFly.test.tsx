import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewIronFly } from "./NewIronFly.js";

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onCreated = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <NewIronFly onCreated={onCreated} />
    </QueryClientProvider>,
  );
  return { onCreated };
}

/** The sample fly, priced leg by leg. */
function priceTheSampleFly() {
  fill("Underlying", "XYZ");
  fill("Expiry", "2026-10-16");
  for (const [leg, strike, entry, exit] of [
    ["Short call", "50", "2.10", "1.00"],
    ["Short put", "50", "1.60", "0.80"],
    ["Long call", "58", "0.35", "0.05"],
    ["Long put", "45", "0.35", "0.05"],
  ] as const) {
    fill(`${leg} strike`, strike);
    fill(`${leg} size`, "4");
    fill(`${leg} entry`, entry);
    fill(`${leg} exit`, exit);
  }
  fill("Entry fees", "5");
  fill("Exit fees", "3");
}

afterEach(() => vi.unstubAllGlobals());

describe("NewIronFly", () => {
  it("posts the built position and reports the new id", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: "new-id" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { onCreated } = setup();
    priceTheSampleFly();
    fireEvent.click(screen.getByRole("button", { name: /save trade/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("new-id"));
    const post = fetchMock.mock.calls.find((call) => String(call[1]?.method).toUpperCase() === "POST");
    const body = JSON.parse(String(post?.[1]?.body));
    expect(body.strategy).toBe("iron_fly");
    expect(body.netPnl).toBe(512);
    expect(body.fees).toBe(8);
    expect(body.legs).toHaveLength(4);
    expect(body.ironFly.netCost).toBe(-1192);
  });

  it("surfaces a failed save", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad", { status: 400 })),
    );
    setup();
    priceTheSampleFly();
    fireEvent.click(screen.getByRole("button", { name: /save trade/i }));
    await waitFor(() => expect(screen.getByText(/save failed/i)).toBeTruthy());
  });
});
