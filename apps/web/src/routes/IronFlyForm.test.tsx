import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IronFlyForm, type IronFlyFormValues } from "./IronFlyForm.js";

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** The sample fly, priced leg by leg: short 50 straddle, wings 45 / 58, 4 lots. */
function priceTheSampleFly() {
  fill("Underlying", "XYZ");
  fill("Expiry", "2026-10-16");
  fill("Short call strike", "50");
  fill("Short call size", "4");
  fill("Short call entry", "2.10");
  fill("Short call exit", "1.00");
  fill("Short put strike", "50");
  fill("Short put size", "4");
  fill("Short put entry", "1.60");
  fill("Short put exit", "0.80");
  fill("Long call strike", "58");
  fill("Long call size", "4");
  fill("Long call entry", "0.35");
  fill("Long call exit", "0.05");
  fill("Long put strike", "45");
  fill("Long put size", "4");
  fill("Long put entry", "0.35");
  fill("Long put exit", "0.05");
  fill("Entry fees", "5");
  fill("Exit fees", "3");
}

const NO_KEY = {
  symbol: "XYZ",
  expirations: [],
  unavailable: { reason: "no_key", message: "Add an Alpaca key in Settings to pick from the chain." },
};

interface Stub {
  /** The body /api/chains answers with. */
  chain?: unknown;
  /** Stock prices by symbol. */
  quotes?: Record<string, { price: number; at: number }>;
  /** Bid and ask by contract code. */
  optionQuotes?: Record<string, { bid: number | null; ask: number | null; at: number }>;
  /** Company names by symbol. */
  companies?: Record<string, string>;
}

/** Answers the market-data calls the builder makes. Without a chain it behaves as if no key were set up. */
function stubApi({ chain = NO_KEY, quotes = {}, optionQuotes = {}, companies = {} }: Stub = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    let body: unknown = {};
    if (path.startsWith("/api/chains/")) body = chain;
    else if (path === "/api/option-quotes") body = { quotes: optionQuotes, available: true };
    else if (path === "/api/quotes") body = { quotes };
    else if (path.startsWith("/api/company/"))
      body = { name: companies[path.slice("/api/company/".length)] ?? null };
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function setup(initial?: Partial<IronFlyFormValues>, stub?: Stub) {
  const fetchMock = stubApi(stub);
  const onSubmit = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <IronFlyForm initial={initial} submitLabel="Save trade" onSubmit={onSubmit} />
    </QueryClientProvider>,
  );
  return { onSubmit, fetchMock };
}

afterEach(() => vi.unstubAllGlobals());

/** M's chain for two far-off Fridays, so the tests never go stale. */
const M_CHAIN = {
  symbol: "M",
  expirations: [
    { date: "2099-10-02", expired: false, strikes: [20, 21, 22, 22.5, 23, 26] },
    { date: "2099-10-09", expired: false, strikes: [20, 22, 23, 26] },
  ],
  unavailable: null,
};

const isSelect = (label: string) => screen.getByLabelText(label).tagName === "SELECT";
const options = (label: string) =>
  [...(screen.getByLabelText(label) as HTMLSelectElement).options].map((option) => option.textContent);
const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

/** The open M fly from the design mockup, built from the chain: 3 lots, body 22.5, wings 20 / 26. */
async function priceFromTheChain() {
  fill("Underlying", "M");
  await waitFor(() => expect(isSelect("Expiry")).toBe(true));
  fill("Expiry", "2099-10-02");
  for (const [leg, strike, entry] of [
    ["Short call", "22.5", "0.52"],
    ["Short put", "22.5", "0.41"],
    ["Long call", "26", "0.05"],
    ["Long put", "20", "0.03"],
  ] as const) {
    fill(`${leg} strike`, strike);
    fill(`${leg} size`, "3");
    fill(`${leg} entry`, entry);
  }
}

describe("IronFlyForm", () => {
  it("saves a 1-wing trade when the long put is left blank", () => {
    const { onSubmit } = setup();
    priceTheSampleFly();
    for (const field of ["strike", "size", "entry", "exit"]) fill(`Long put ${field}`, "");
    fireEvent.click(screen.getByRole("button", { name: /save trade/i }));

    const payload = onSubmit.mock.calls[0]?.[0];
    expect(payload.legs).toHaveLength(3);
    expect(payload.ironFly.putWingStrike).toBe(0);
  });

  it("saves a trade with no call wing when the long call is left blank", () => {
    const { onSubmit } = setup();
    priceTheSampleFly();
    for (const field of ["strike", "size", "entry", "exit"]) fill(`Long call ${field}`, "");
    fireEvent.click(screen.getByRole("button", { name: /save trade/i }));

    const payload = onSubmit.mock.calls[0]?.[0];
    expect(payload.legs).toHaveLength(3);
    expect(payload.ironFly.callWingStrike).toBeNull();
  });

  it("keeps the structure label it was given", () => {
    const { onSubmit } = setup({ structureLabel: "Short Iron Condor" });
    priceTheSampleFly();
    fireEvent.click(screen.getByRole("button", { name: /save trade/i }));
    expect(onSubmit.mock.calls[0]?.[0].structureLabel).toBe("Short Iron Condor");
  });

  it("derives the cash from the leg prices instead of asking for it", () => {
    setup();
    priceTheSampleFly();
    const summary = screen.getByTestId("derived");
    expect(summary.textContent).toContain("1,192.00"); // net cost: credit less fees
    expect(summary.textContent).toContain("520.00"); // P&L before fees
    expect(summary.textContent).toContain("512.00"); // net P&L
    expect(summary.textContent).toContain("2,008.00"); // max loss, call side
    expect(summary.textContent).toContain("47.02"); // breakevens
  });

  it("leaves P&L open while an exit price is missing", () => {
    setup();
    priceTheSampleFly();
    fill("Short put exit", "");
    expect(screen.getByTestId("derived-net-pnl").textContent).toContain("—");
  });

  it("submits legs, structure and derived cash", () => {
    const { onSubmit } = setup();
    priceTheSampleFly();
    fireEvent.click(screen.getByRole("button", { name: /save trade/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0]?.[0];
    expect(payload.underlying).toBe("XYZ");
    expect(payload.legs).toHaveLength(4);
    expect(payload.legs.filter((leg: { quantity: number }) => leg.quantity === -4)).toHaveLength(2);
    expect(payload.legs.filter((leg: { quantity: number }) => leg.quantity === 4)).toHaveLength(2);
    expect(payload.netPnl).toBe(512);
    expect(payload.fees).toBe(8);
    expect(payload.feesOpen).toBe(5);
    expect(payload.feesClose).toBe(3);
    expect(payload.ironFly.bodyCallStrike).toBe(50);
    expect(payload.ironFly.callWingStrike).toBe(58);
    expect(payload.ironFly.putWingStrike).toBe(45);
    expect(payload.ironFly.contracts).toBe(4);
    expect(payload.ironFly.netCost).toBe(-1192);
  });

  it("refuses to submit an incomplete structure", () => {
    const { onSubmit } = setup();
    fill("Underlying", "XYZ");
    fireEvent.click(screen.getByRole("button", { name: /save trade/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/every leg needs a strike, a size and an entry price/i)).toBeTruthy();
  });

  it("starts from an existing trade when editing", () => {
    setup({
      underlying: "ACME",
      expiry: "2026-09-18",
      legs: {
        shortCall: { strike: "30", size: "3", entry: "1.40", exit: "2.60" },
        shortPut: { strike: "30", size: "3", entry: "1.10", exit: "0.20" },
        longCall: { strike: "35", size: "3", entry: "0.20", exit: "0.50" },
        longPut: { strike: "25", size: "3", entry: "0.20", exit: "0.02" },
      },
    });
    expect((screen.getByLabelText("Underlying") as HTMLInputElement).value).toBe("ACME");
    expect((screen.getByLabelText("Short call strike") as HTMLInputElement).value).toBe("30");
    expect((screen.getByLabelText("Long put exit") as HTMLInputElement).value).toBe("0.02");
  });

  it("refuses a fractional contract size", () => {
    const { onSubmit } = setup();
    priceTheSampleFly();
    fill("Short call size", "4.5");
    fireEvent.click(screen.getByRole("button", { name: /save trade/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/whole contracts/i)).toBeTruthy();
  });

  it("asks for whole contracts in the size inputs", () => {
    setup();
    expect(screen.getByLabelText("Short call size").getAttribute("step")).toBe("1");
    expect(screen.getByLabelText("Short call entry").getAttribute("step")).toBe("0.01");
  });
});

describe("IronFlyForm with an option chain", () => {
  it("turns expiry and strikes into lists of what is listed", async () => {
    setup(undefined, { chain: M_CHAIN });
    fill("Underlying", "M");
    await waitFor(() => expect(isSelect("Expiry")).toBe(true));
    expect(options("Expiry")[1]).toMatch(/^Oct 2 · Fri · \d+d$/);
    fill("Expiry", "2099-10-02");
    expect(options("Short call strike")).toEqual(["—", "20", "21", "22", "22.5", "23", "26"]);
  });

  it("saves a 1-wing trade when a long leg's strike is left blank", async () => {
    const { onSubmit } = setup(undefined, { chain: M_CHAIN });
    await priceFromTheChain();
    for (const field of ["strike", "size", "entry"]) fill(`Long put ${field}`, "");
    fireEvent.click(screen.getByRole("button", { name: /save trade/i }));

    const payload = onSubmit.mock.calls[0]?.[0];
    expect(payload.legs).toHaveLength(3);
    expect(payload.legs[0].expiry).toBe("2099-10-02");
    expect(payload.ironFly.putWingStrike).toBe(0);
  });

  it("keeps the strikes a new expiry lists and clears the rest, saying which", async () => {
    setup(undefined, { chain: M_CHAIN });
    await priceFromTheChain();
    fill("Expiry", "2099-10-09");
    expect(value("Short call strike")).toBe("");
    expect(value("Short put strike")).toBe("");
    expect(value("Long call strike")).toBe("26");
    expect(value("Long put strike")).toBe("20");
    expect(
      screen.getByText("Cleared strikes not listed for 2099-10-09: short call, short put."),
    ).toBeTruthy();
  });

  it("keeps a saved strike the chain does not list, marked not listed, and saves it unchanged", async () => {
    const { onSubmit } = setup(
      {
        underlying: "M",
        expiry: "2099-10-02",
        legs: {
          shortCall: { strike: "22.25", size: "3", entry: "0.52", exit: "" },
          shortPut: { strike: "22.25", size: "3", entry: "0.41", exit: "" },
          longCall: { strike: "26", size: "3", entry: "0.05", exit: "" },
          longPut: { strike: "20", size: "3", entry: "0.03", exit: "" },
        },
      },
      { chain: M_CHAIN },
    );
    await waitFor(() => expect(isSelect("Short call strike")).toBe(true));
    const select = screen.getByLabelText("Short call strike") as HTMLSelectElement;
    expect(select.value).toBe("22.25");
    expect(select.selectedOptions[0]?.textContent).toBe("22.25 · not listed");
    fireEvent.click(screen.getByRole("button", { name: /save trade/i }));
    expect(onSubmit.mock.calls[0]?.[0].legs[0].strike).toBe(22.25);
  });

  it("keeps an expiry typed before the chain arrived", async () => {
    setup(undefined, { chain: M_CHAIN });
    fill("Underlying", "M");
    fill("Expiry", "2099-10-09");
    await waitFor(() => expect(isSelect("Expiry")).toBe(true));
    expect(value("Expiry")).toBe("2099-10-09");
  });

  it("falls back to typing, with the reason, when there is no chain", async () => {
    setup(undefined, { chain: NO_KEY });
    fill("Underlying", "M");
    expect(await screen.findByText("Add an Alpaca key in Settings to pick from the chain.")).toBeTruthy();
    expect(isSelect("Expiry")).toBe(false);
  });

  it("switches to typing on request, and back", async () => {
    setup(undefined, { chain: M_CHAIN });
    fill("Underlying", "M");
    await waitFor(() => expect(isSelect("Expiry")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "type instead" }));
    expect(isSelect("Expiry")).toBe(false);
    expect(isSelect("Short call strike")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "pick from the chain" }));
    expect(isSelect("Expiry")).toBe(true);
  });

  it("labels the strike nearest the stock's price for a trade opened today", async () => {
    setup(undefined, { chain: M_CHAIN, quotes: { M: { price: 22.64, at: Date.UTC(2026, 8, 25, 19, 59) } } });
    fill("Underlying", "M");
    await waitFor(() => expect(isSelect("Expiry")).toBe(true));
    fill("Expiry", "2099-10-02");
    await waitFor(() => expect(options("Short call strike")).toContain("22.5 (ATM)"));
  });

  it("refuses to save without an expiry", () => {
    const { onSubmit } = setup();
    priceTheSampleFly();
    fill("Expiry", "");
    fireEvent.click(screen.getByRole("button", { name: /save trade/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("An expiry is required.")).toBeTruthy();
  });

  it("fills Company from the symbol, and follows the symbol while the name is its own", async () => {
    setup(undefined, { companies: { M: "Macy's Inc.", NVDA: "NVIDIA Corporation" } });
    fill("Underlying", "M");
    await waitFor(() => expect(value("Company")).toBe("Macy's Inc."));
    fill("Underlying", "NVDA");
    await waitFor(() => expect(value("Company")).toBe("NVIDIA Corporation"));
  });

  it("clears an auto-filled company when the new symbol has no name", async () => {
    setup(undefined, { companies: { M: "Macy's Inc." } });
    fill("Underlying", "M");
    await waitFor(() => expect(value("Company")).toBe("Macy's Inc."));
    fill("Underlying", "ZZZZ");
    await waitFor(() => expect(value("Company")).toBe(""));
  });

  it("never replaces a company name typed by hand", async () => {
    const { fetchMock } = setup(undefined, { companies: { M: "Macy's Inc." } });
    fill("Company", "Macy's");
    fill("Underlying", "M");
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/company/M"))).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(value("Company")).toBe("Macy's");
  });

  it("shows each open leg's mark as a hint in its empty exit, and never saves it", async () => {
    const at = Date.UTC(2026, 8, 25, 19, 59, 51);
    const { onSubmit } = setup(undefined, {
      chain: M_CHAIN,
      optionQuotes: {
        M991002C00022500: { bid: 0.44, ask: 0.58, at },
        M991002P00022500: { bid: 0.31, ask: 0.42, at },
        M991002C00026000: { bid: 0.01, ask: 0.06, at },
        M991002P00020000: { bid: 0.01, ask: 0.05, at },
      },
    });
    await priceFromTheChain();
    fill("Entry fees", "7.80");
    await waitFor(() =>
      expect(screen.getByLabelText("Short call exit").getAttribute("placeholder")).toBe("0.58"),
    );
    expect(screen.getByLabelText("Long put exit").getAttribute("placeholder")).toBe("0.01");
    expect(screen.getByTestId("derived-estimate").textContent).toBe("est -$46.80");

    fireEvent.click(screen.getByRole("button", { name: /save trade/i }));
    const payload = onSubmit.mock.calls[0]?.[0];
    expect(payload.legs.map((leg: { closePrice: number | null }) => leg.closePrice)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(payload.netPnl).toBeNull();
  });
});
