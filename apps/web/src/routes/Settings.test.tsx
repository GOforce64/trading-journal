import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Settings } from "./Settings.js";

const DATA_DIR = "/home/t/.local/share/trading-journal";
const OFF = { state: "off", message: null, keyIdHint: null };
const ON = { state: "on", message: null, keyIdHint: "PK…7QXA" };
const view = (marketData: unknown) => ({ dataDir: DATA_DIR, marketData });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** GET answers `state.current`; PUT and DELETE answer `reply`, or move to `after` when it is a 200. */
function stubApi(initial: unknown, reply?: { status: number; body: unknown }) {
  const state = { current: view(initial) };
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(init?.method ?? "GET").toUpperCase();
    if (method === "GET") return json(state.current);
    if (!reply) throw new Error(`unexpected ${method}`);
    if (reply.status === 200) state.current = reply.body as ReturnType<typeof view>;
    return json(reply.body, reply.status);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof stubApi>, method: string) =>
  fetchMock.mock.calls.filter((call) => String(call[1]?.method).toUpperCase() === method);

function renderSettings(confirm: (text: string) => boolean = () => true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Settings confirm={confirm} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Settings", () => {
  it("says market data is off and where the data lives", async () => {
    stubApi(OFF);
    renderSettings();
    expect(await screen.findByText("Not set up: live prices, chains and marks are off")).toBeTruthy();
    expect(screen.getByText(DATA_DIR)).toBeTruthy();
  });

  it("shows a saved key only as a hint, and hides what is typed as the secret", async () => {
    stubApi(ON);
    renderSettings();
    expect(await screen.findByText("Connected · key PK…7QXA · paper account")).toBeTruthy();
    const secret = screen.getByLabelText("Secret key") as HTMLInputElement;
    expect(secret.type).toBe("password");
    expect(secret.value).toBe("");
  });

  it("tests and saves a key, then shows the new status and clears the fields", async () => {
    const fetchMock = stubApi(OFF, { status: 200, body: view(ON) });
    renderSettings();
    await screen.findByText(/Not set up/);
    fireEvent.change(screen.getByLabelText("Key ID"), { target: { value: "PKTESTKEY7QXA" } });
    fireEvent.change(screen.getByLabelText("Secret key"), { target: { value: "test-secret-do-not-log" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and test" }));

    expect(await screen.findByText("Connected · key PK…7QXA · paper account")).toBeTruthy();
    const put = calls(fetchMock, "PUT")[0];
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({
      keyId: "PKTESTKEY7QXA",
      secretKey: "test-secret-do-not-log",
    });
    expect((screen.getByLabelText("Secret key") as HTMLInputElement).value).toBe("");
  });

  it("shows why a key was refused and keeps what was typed", async () => {
    const message =
      "Alpaca accepted this key for prices but not for option chains. It looks like a live-account key, so use your Paper account's key instead.";
    stubApi(OFF, { status: 400, body: { error: "not_paper", message } });
    renderSettings();
    await screen.findByText(/Not set up/);
    fireEvent.change(screen.getByLabelText("Key ID"), { target: { value: "AKLIVEKEY" } });
    fireEvent.change(screen.getByLabelText("Secret key"), { target: { value: "live-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and test" }));

    expect(await screen.findByText(message)).toBeTruthy();
    expect((screen.getByLabelText("Key ID") as HTMLInputElement).value).toBe("AKLIVEKEY");
  });

  it("asks before removing the key", async () => {
    const confirm = vi.fn(() => false);
    const fetchMock = stubApi(ON, { status: 200, body: view(OFF) });
    renderSettings(confirm);
    fireEvent.click(await screen.findByRole("button", { name: "Remove key" }));
    expect(confirm).toHaveBeenCalled();
    expect(calls(fetchMock, "DELETE")).toHaveLength(0);

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
    expect(await screen.findByText("Not set up: live prices, chains and marks are off")).toBeTruthy();
    expect(calls(fetchMock, "DELETE")).toHaveLength(1);
  });

  it("shows the message when Alpaca has rejected the saved key", async () => {
    stubApi({
      state: "error",
      message: "Alpaca rejected the saved key. Save a new one below.",
      keyIdHint: "PK…7QXA",
    });
    renderSettings();
    expect(await screen.findByText("Alpaca rejected the saved key. Save a new one below.")).toBeTruthy();
  });
});
