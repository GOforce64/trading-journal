import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DateField } from "./DateField.js";

function Form({ initial, onSubmitted }: { initial: string; onSubmitted: (date: string) => void }) {
  const [date, setDate] = useState(initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmitted(date);
      }}
    >
      <DateField label="Date" value={date} onChange={setDate} />
      <button type="submit">Save</button>
    </form>
  );
}

const field = () => screen.getByRole("textbox", { name: "Date" }) as HTMLInputElement;
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });

afterEach(() => vi.restoreAllMocks());

describe("DateField", () => {
  it("shows the date day first", () => {
    render(<DateField label="Date" value="2026-12-09" onChange={() => {}} />);
    expect(field().value).toBe("09/12/2026");
  });

  it("reads 9/12/26 as 9 December 2026 on blur, and tidies the text", () => {
    const onChange = vi.fn();
    render(<DateField label="Date" value="" onChange={onChange} />);
    type("9/12/26");
    fireEvent.blur(field());
    expect(onChange).toHaveBeenCalledWith("2026-12-09");
    expect(field().value).toBe("09/12/2026");
  });

  it("submits its form on Enter with the date just typed", () => {
    const onSubmitted = vi.fn();
    render(<Form initial="2026-09-28" onSubmitted={onSubmitted} />);
    type("9.12.26");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSubmitted).toHaveBeenCalledWith("2026-12-09");
  });

  it("keeps a bad date with its message, changes nothing, and doesn't submit", () => {
    const onSubmitted = vi.fn();
    render(<Form initial="2026-09-28" onSubmitted={onSubmitted} />);
    type("9/28/2026");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Not a date: day/month/year");
    expect(field().value).toBe("9/28/2026");
    fireEvent.blur(field());
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it("keeps its form from submitting on a click while the date doesn't read", () => {
    const onSubmitted = vi.fn();
    render(<Form initial="2026-09-28" onSubmitted={onSubmitted} />);
    type("9/28/2026");
    // A click on Save leaves the field first, as a mouse does.
    fireEvent.blur(field());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmitted).not.toHaveBeenCalled();
    type("28/9/2026");
    fireEvent.blur(field());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmitted).toHaveBeenCalledWith("2026-09-28");
  });

  it("clears to an empty date", () => {
    const onChange = vi.fn();
    render(<DateField label="Date" value="2026-12-09" onChange={onChange} />);
    type("");
    fireEvent.blur(field());
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("opens the browser's picker, and a pick fills the field", () => {
    const showPicker = vi.fn();
    Object.defineProperty(HTMLInputElement.prototype, "showPicker", {
      value: showPicker,
      configurable: true,
    });
    const onChange = vi.fn();
    const { container } = render(<DateField label="Date" value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Pick date" }));
    expect(showPicker).toHaveBeenCalledOnce();
    const native = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(native, { target: { value: "2026-12-24" } });
    expect(onChange).toHaveBeenCalledWith("2026-12-24");
  });

  it("shows a new value from outside", () => {
    const { rerender } = render(<DateField label="Date" value="2026-12-09" onChange={() => {}} />);
    rerender(<DateField label="Date" value="2026-12-24" onChange={() => {}} />);
    expect(field().value).toBe("24/12/2026");
  });
});
