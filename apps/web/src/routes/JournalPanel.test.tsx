import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Stopped } from "../components/Stopped.js";
import { resetStopped, useStopped } from "../stopped.js";
import { JournalPanel } from "./JournalPanel.js";

function Probe() {
  return <span data-testid="stopped">{String(useStopped())}</span>;
}

function renderPanel(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <JournalPanel />
      <Probe />
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetStopped();
});

describe("Stop the journal", () => {
  it("asks the server to stop, then the app says it has stopped", async () => {
    const fetchMock = renderPanel(200, { ok: true });
    fireEvent.click(screen.getByRole("button", { name: "Stop the journal" }));
    await waitFor(() => expect(screen.getByTestId("stopped").textContent).toBe("true"));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("/api/shutdown");
    expect(init.method).toBe("POST");
  });

  it("says so when this server can't be stopped", async () => {
    renderPanel(404, { error: "not found" });
    fireEvent.click(screen.getByRole("button", { name: "Stop the journal" }));
    expect(await screen.findByText("stop failed: 404")).toBeTruthy();
    expect(screen.getByTestId("stopped").textContent).toBe("false");
  });

  it("the stopped screen says how to start it again", () => {
    render(<Stopped />);
    expect(screen.getByRole("main").textContent).toBe(
      "The journal has stopped. Open it again from its icon, or run pnpm start.",
    );
  });
});
