import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Shell } from "./Shell.js";

const DESTINATIONS = [
  "Dashboard",
  "Journal",
  "Analytics",
  "Iron Flies",
  "Scalps",
  "Missed",
  "Playbook",
  "Import / Sync",
  "Settings",
];

describe("Shell", () => {
  it("offers the palette's Search button only when given a way to open it", () => {
    const onSearch = vi.fn();
    const { rerender } = render(
      <Shell activePath="/" onSearch={onSearch}>
        <p>page</p>
      </Shell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Search · Ctrl K" }));
    expect(onSearch).toHaveBeenCalledOnce();
    rerender(
      <Shell activePath="/">
        <p>page</p>
      </Shell>,
    );
    expect(screen.queryByRole("button", { name: "Search · Ctrl K" })).toBeNull();
  });

  it("renders every primary nav destination and its children", () => {
    render(
      <Shell activePath="/journal">
        <p>content</p>
      </Shell>,
    );
    for (const label of DESTINATIONS) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText("content")).toBeTruthy();
  });

  it("marks the active destination", () => {
    render(
      <Shell activePath="/journal">
        <p>content</p>
      </Shell>,
    );
    expect(screen.getByText("Journal").getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Settings").getAttribute("aria-current")).toBeNull();
  });

  it("shows a spinner beside Import / Sync while IBKR syncs", () => {
    const { rerender } = render(
      <Shell activePath="/" syncing>
        <p>content</p>
      </Shell>,
    );
    expect(screen.getByRole("status", { name: "Syncing with IBKR" })).toBeTruthy();
    rerender(
      <Shell activePath="/">
        <p>content</p>
      </Shell>,
    );
    expect(screen.queryByRole("status", { name: "Syncing with IBKR" })).toBeNull();
  });

  it("counts the scalps waiting for review beside Scalps", () => {
    const { rerender } = render(
      <Shell activePath="/" toReview={5}>
        <p>content</p>
      </Shell>,
    );
    expect(screen.getByLabelText("5 to review").textContent).toBe("5");
    rerender(
      <Shell activePath="/">
        <p>content</p>
      </Shell>,
    );
    expect(screen.queryByLabelText(/to review/)).toBeNull();
  });
});
