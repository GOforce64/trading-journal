import { fieldDate, parseDayMonthYear } from "@tj/core";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

interface FieldProps {
  label: string;
  /** The value: ISO, or "" for none. */
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * A date (or date and time) typed day first (launcher-keys-palette spec §8.2), whatever the browser's language.
 * It commits on Enter or blur: a value that doesn't read keeps its text and a message, and changes nothing. 📅
 * opens the browser's own picker, whose pick can't be misread.
 */
export function WallClockField({
  label,
  value,
  onChange,
  className = "",
  show,
  read,
  nativeType,
  message,
  placeholder,
}: FieldProps & {
  show: (value: string) => string;
  read: (text: string) => string | null;
  nativeType: string;
  message: string;
  placeholder: string;
}) {
  const shown = value ? show(value) : "";
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  // A value from outside (a pick, a preset, a save) replaces what's shown.
  useEffect(() => {
    setText(shown);
    setBad(false);
  }, [shown]);

  /** The typed value, or "" when empty; null when it doesn't read, which keeps the text and the value. */
  const commit = (): string | null => {
    const typed = text.trim() === "" ? "" : read(text);
    if (typed === null) {
      setBad(true);
      return null;
    }
    setBad(false);
    setText(typed ? show(typed) : "");
    if (typed !== value) onChange(typed);
    return typed;
  };

  return (
    <span className="inline-flex items-center gap-1">
      <input
        aria-label={label}
        aria-invalid={bad || undefined}
        inputMode="numeric"
        placeholder={placeholder}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setBad(false);
        }}
        onBlur={() => commit()}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          // Commit first and let the form see the new value; one that doesn't read doesn't submit.
          event.preventDefault();
          const form = event.currentTarget.form;
          const result = { value: null as string | null };
          flushSync(() => {
            result.value = commit();
          });
          if (result.value !== null) form?.requestSubmit();
        }}
        className={`num ${className}`}
      />
      <button
        type="button"
        aria-label={`Pick ${label.toLowerCase()}`}
        onClick={() => picker.current?.showPicker?.()}
        className="text-muted hover:text-fg"
      >
        📅
      </button>
      <input
        ref={picker}
        type={nativeType}
        // Times to the second, as a synced fill has them.
        step={nativeType === "date" ? undefined : 1}
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value);
        }}
        className="pointer-events-none absolute h-px w-px opacity-0"
      />
      {bad && (
        <span role="alert" className="text-[11px] text-down">
          {message}
        </span>
      )}
    </span>
  );
}

/** A date: shows 09/12/2026, reads 9/12/26, 9.12.26, 9-12-2026 or ISO. */
export function DateField({ className = "", ...props }: FieldProps) {
  return (
    <WallClockField
      {...props}
      className={`w-24 ${className}`}
      show={fieldDate}
      read={parseDayMonthYear}
      nativeType="date"
      message="Not a date: day/month/year"
      placeholder="dd/mm/yyyy"
    />
  );
}
