import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Shell } from "./Shell.js";

const DESTINATIONS = [
  "Dashboard",
  "Journal",
  "Analytics",
  "Iron Flies",
  "Missed",
  "Playbook",
  "Import / Sync",
  "Settings",
];

describe("Shell", () => {
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
});
