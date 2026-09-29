import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Settings } from "./Settings.js";

const NOT_SET = {
  configured: false,
  tokenHint: null,
  activityQueryId: null,
  todayQueryId: null,
  since: null,
};
const SET = {
  configured: true,
  tokenHint: "12…9012",
  activityQueryId: "1653145",
  todayQueryId: "1653147",
  since: "2026-09-28",
};
const view = (ibkr: unknown) => ({
  dataDir: "/data",
  marketData: { state: "off", message: null, keyIdHint: null },
  ibkr,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** GET answers the current view; PUT and DELETE answer `reply`, and a 200 reply becomes the new view. */
function stub(initial: unknown, reply?: { status: number; body: unknown }) {
  let current = view(initial);
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(init?.method ?? "GET").toUpperCase();
    if (method === "GET") return json(current);
    if (!reply) throw new Error(`unexpected ${method}`);
    if (reply.status === 200) current = reply.body as ReturnType<typeof view>;
    return json(reply.body, reply.status);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderSettings(confirm: (text: string) => boolean = () => true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Settings confirm={confirm} />
    </QueryClientProvider>,
  );
}

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

afterEach(() => vi.unstubAllGlobals());

describe("IBKR Flex settings", () => {
  it("says it isn't set up, and saves the token, both query IDs and the start date", async () => {
    const fetchMock = stub(NOT_SET, { status: 200, body: view(SET) });
    renderSettings();
    expect(await screen.findByText("Not set up: scalps and flies from IBKR won't sync")).toBeTruthy();
    expect(screen.getByText("Both machines need the same start date.")).toBeTruthy();
    fill("Flex token", "1234567890123456789012");
    fill("Activity query ID", "1653145");
    fill("Today query ID", "1653147");
    fill("Start date", "2026-09-28");
    fireEvent.click(screen.getByRole("button", { name: "Save IBKR" }));
    await waitFor(() => expect(screen.getByText(/Set up · token 12…9012/)).toBeTruthy());
    const put = fetchMock.mock.calls.find((call) => String(call[1]?.method).toUpperCase() === "PUT");
    expect(String(put?.[0])).toContain("/api/settings/ibkr");
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({
      token: "1234567890123456789012",
      activityQueryId: "1653145",
      todayQueryId: "1653147",
      since: "2026-09-28",
    });
    expect((screen.getByLabelText("Flex token") as HTMLInputElement).value).toBe("");
  });

  it("keeps the saved token when the field is left blank", async () => {
    const fetchMock = stub(SET, { status: 200, body: view(SET) });
    renderSettings();
    await screen.findByText(/Set up · token 12…9012/);
    expect((screen.getByLabelText("Activity query ID") as HTMLInputElement).value).toBe("1653145");
    expect(screen.getByLabelText("Flex token").getAttribute("placeholder")).toBe(
      "saved; leave blank to keep it",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save IBKR" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[1]?.method).toUpperCase() === "PUT")).toBe(true),
    );
    const put = fetchMock.mock.calls.find((call) => String(call[1]?.method).toUpperCase() === "PUT");
    expect(JSON.parse(String(put?.[1]?.body))).not.toHaveProperty("token");
  });

  it("shows why IBKR refused", async () => {
    const message =
      "IBKR rejected the token. Check it was copied in full, or generate a new one in Client Portal.";
    stub(NOT_SET, { status: 400, body: { error: "token_rejected", message } });
    renderSettings();
    await screen.findByText("Not set up: scalps and flies from IBKR won't sync");
    fill("Flex token", "1234567890123456789012");
    fill("Activity query ID", "1653145");
    fill("Today query ID", "1653147");
    fireEvent.click(screen.getByRole("button", { name: "Save IBKR" }));
    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("removes the IBKR setup after asking", async () => {
    const fetchMock = stub(SET, { status: 200, body: view(NOT_SET) });
    const confirm = vi.fn(() => true);
    renderSettings(confirm);
    await screen.findByText(/Set up · token 12…9012/);
    fireEvent.click(screen.getByRole("button", { name: "Remove IBKR" }));
    await screen.findByText("Not set up: scalps and flies from IBKR won't sync");
    expect(confirm).toHaveBeenCalled();
    expect(fetchMock.mock.calls.some((call) => String(call[1]?.method).toUpperCase() === "DELETE")).toBe(
      true,
    );
  });
});
