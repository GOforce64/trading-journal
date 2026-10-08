import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Screenshots, type Shot } from "./Screenshots.js";

const shot = (id: string, sha: string, caption: string | null = null): Shot => ({
  id,
  sha256: sha.repeat(64),
  ext: "png",
  caption,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const png = () => new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" });

function stub(reply: () => Response = () => json({ id: "new" }, 201)) {
  const fetchMock = vi.fn(async () => reply());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPanel(shots: Shot[] = [], confirm: (text: string) => boolean = () => true) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <Screenshots trade={{ id: "t1", attachments: shots }} confirm={confirm} />
    </QueryClientProvider>,
  );
  return { invalidate };
}

/** A paste or drop event carrying `files`, as the browser sends it. */
function carrying(
  type: "paste" | "drop",
  files: File[],
  text = "",
  types = files.length ? ["Files"] : ["text/plain"],
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const data = { files, getData: () => text, types };
  Object.defineProperty(event, type === "paste" ? "clipboardData" : "dataTransfer", { value: data });
  return event;
}

afterEach(() => vi.unstubAllGlobals());

describe("Screenshots", () => {
  it("says how to add one when there are none", () => {
    renderPanel();
    expect(screen.getByText("Paste (Ctrl+V), drop an image here, or Add screenshot.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add screenshot" })).toBeTruthy();
  });

  it("uploads an image pasted anywhere on the page, and refreshes the trade", async () => {
    const fetchMock = stub();
    const { invalidate } = renderPanel();
    const file = png();
    act(() => {
      window.dispatchEvent(carrying("paste", [file]));
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/trades/t1/attachments",
        expect.objectContaining({ method: "POST", body: file, headers: { "content-type": "image/png" } }),
      ),
    );
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });

  it("leaves a paste of text alone, so typing notes is never interrupted", () => {
    const fetchMock = stub();
    renderPanel();
    const event = carrying("paste", [], "hello");
    act(() => {
      window.dispatchEvent(event);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves an Office paste into a text field to the field, though it carries a picture of the cells", () => {
    const fetchMock = stub();
    renderPanel();
    const notes = document.body.appendChild(document.createElement("textarea"));
    notes.focus();
    const event = carrying("paste", [png()], "AAPL\t1.25", ["text/plain", "text/html", "Files"]);
    act(() => {
      notes.dispatchEvent(event);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    notes.remove();
  });

  it("keeps a dropped file of another kind from leaving the page, and says which kinds a screenshot can be", () => {
    const fetchMock = stub();
    renderPanel();
    const gif = new File([new Uint8Array([71, 73, 70])], "move.gif", { type: "image/gif" });
    const event = carrying("drop", [gif]);
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Screenshots can be PNG, JPEG or WebP.")).toBeTruthy();
  });

  it("saves a caption being typed when Esc or the backdrop closes the lightbox", async () => {
    const fetchMock = stub(() => json({}));
    renderPanel([shot("s1", "a")]);
    const typeCaption = (text: string) => {
      fireEvent.click(screen.getByRole("button", { name: "Open screenshot 1" }));
      const caption = screen.getByRole("textbox", { name: "Caption" });
      caption.focus();
      fireEvent.change(caption, { target: { value: text } });
      return caption;
    };
    fireEvent.keyDown(typeCaption("opening drive"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    typeCaption("failed breakout");
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/attachments/s1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ caption: "opening drive" }) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/attachments/s1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ caption: "failed breakout" }) }),
    );
  });

  it("uploads an image dropped on the page, and says why one was refused", async () => {
    const fetchMock = stub(() => json({ error: "too_large", message: "That image is over 20 MB." }, 413));
    renderPanel();
    act(() => {
      window.dispatchEvent(carrying("drop", [png()]));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("That image is over 20 MB.")).toBeTruthy();
  });

  it("shows the trade's screenshots, and opens one in a lightbox to step, caption and remove", async () => {
    const fetchMock = stub(() => json({}));
    renderPanel([shot("s1", "a", "the flush"), shot("s2", "b")]);
    expect(screen.getByText("Screenshots · 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open screenshot 1" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(
      `/api/attachments/files/${"a".repeat(64)}.png`,
    );
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("dialog").querySelector("img")?.getAttribute("src")).toBe(
      `/api/attachments/files/${"b".repeat(64)}.png`,
    );
    const caption = screen.getByRole("textbox", { name: "Caption" });
    fireEvent.change(caption, { target: { value: "VWAP reclaim" } });
    fireEvent.blur(caption);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/attachments/s2",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ caption: "VWAP reclaim" }) }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/attachments/s2",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open screenshot 1" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks before removing, and keeps the screenshot when the answer is no", () => {
    const fetchMock = stub(() => json({}));
    const confirm = vi.fn(() => false);
    renderPanel([shot("s1", "a")], confirm);
    fireEvent.click(screen.getByRole("button", { name: "Open screenshot 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(confirm).toHaveBeenCalledWith("Remove this screenshot?");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
