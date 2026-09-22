import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewIronFly } from "./NewIronFly.js";

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

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** The sample broken-wing fly: short 50 straddle, wings 45 / 58, 4 lots. */
function fillStructure() {
  fill("Underlying", "XYZ");
  fill("Body strike", "50");
  fill("Put wing", "45");
  fill("Call wing", "58");
  fill("Contracts", "4");
  fill("Credit per share", "3.00");
}

afterEach(() => vi.unstubAllGlobals());

describe("NewIronFly", () => {
  it("previews metrics live as the structure is typed", () => {
    setup();
    fillStructure();
    fill("Fees", "8.00");
    expect(screen.getByTestId("preview-max-loss").textContent).toContain("2,008.00");
    expect(screen.getByTestId("preview-max-loss").textContent).toContain("call");
    expect(screen.getByTestId("preview-breakevens").textContent).toContain("47.02");
    expect(screen.getByTestId("preview-breakevens").textContent).toContain("52.98");
    expect(screen.getByTestId("preview-wings").textContent).toContain("broken");
  });

  it("says nothing until the structure is complete", () => {
    setup();
    fill("Underlying", "XYZ");
    expect(screen.queryByTestId("preview-max-loss")).toBeNull();
  });

  it("posts the trade and reports the new id", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: "new-id" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { onCreated } = setup();
    fillStructure();
    fill("Net P&L", "512.00");
    fireEvent.click(screen.getByRole("button", { name: /save trade/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("new-id"));
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.strategy).toBe("iron_fly");
    expect(body.ironFly.callWingStrike).toBe(58);
    expect(body.ironFly.putWingStrike).toBe(45);
    expect(body.netPnl).toBe(512);
    expect(body.legs).toHaveLength(4);
    expect(body.legs.filter((leg: { quantity: number }) => leg.quantity < 0)).toHaveLength(2);
  });

  it("surfaces a failed save", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad", { status: 400 })),
    );
    setup();
    fillStructure();
    fireEvent.click(screen.getByRole("button", { name: /save trade/i }));
    await waitFor(() => expect(screen.getByText(/save failed/i)).toBeTruthy());
  });
});
