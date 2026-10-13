import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DateTimeField } from "./DateTimeField.js";

const field = () => screen.getByRole("textbox", { name: "Opened" }) as HTMLInputElement;
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });

function Form({ onSubmitted }: { onSubmitted: (value: string) => void }) {
  const [value, setValue] = useState("2026-09-28T09:35");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmitted(value);
      }}
    >
      <DateTimeField label="Opened" value={value} onChange={setValue} />
    </form>
  );
}

describe("DateTimeField", () => {
  it("shows the date day first and the time on a 24-hour clock, seconds kept", () => {
    render(<DateTimeField label="Opened" value="2026-09-28T15:57:05" onChange={() => {}} />);
    expect(field().value).toBe("28/09/2026 15:57:05");
  });

  it("reads 28/9/26 9:35 on blur, and tidies the text", () => {
    const onChange = vi.fn();
    render(<DateTimeField label="Opened" value="" onChange={onChange} />);
    type("28/9/26 9:35");
    fireEvent.blur(field());
    expect(onChange).toHaveBeenCalledWith("2026-09-28T09:35");
    expect(field().value).toBe("28/09/2026 09:35");
  });

  it("submits its form on Enter with the time just typed, and not a bad one", () => {
    const onSubmitted = vi.fn();
    render(<Form onSubmitted={onSubmitted} />);
    type("9/28/2026 09:35");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Not a date and time: day/month/year hh:mm");
    type("28/9/2026 10:02");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSubmitted).toHaveBeenCalledWith("2026-09-28T10:02");
  });

  it("clears to no time, as an open trade's Closed is", () => {
    const onChange = vi.fn();
    render(<DateTimeField label="Opened" value="2026-09-28T09:35" onChange={onChange} />);
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
    const { container } = render(<DateTimeField label="Opened" value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Pick opened" }));
    expect(showPicker).toHaveBeenCalledOnce();
    const native = container.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(native, { target: { value: "2026-09-28T09:41" } });
    expect(onChange).toHaveBeenCalledWith("2026-09-28T09:41");
  });
});
