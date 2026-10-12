import { fieldDate, parseDayMonthYear } from "@tj/core";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

/**
 * A date typed day/month/year (launcher-keys-palette spec §8.2). It shows 09/12/2026 whatever the browser's
 * language, reads 9/12/26, 9.12.26, 9-12-2026 or ISO, and commits on Enter or blur. 📅 opens the browser's picker.
 */
export function DateField({
  label,
  value,
  onChange,
  className = "",
}: {
  label: string;
  /** ISO ("2026-12-09"), or "" for none. */
  value: string;
  onChange: (date: string) => void;
  className?: string;
}) {
  const shown = value ? fieldDate(value) : "";
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  // A value from outside (a pick, a preset, a save) replaces what's shown.
  useEffect(() => {
    setText(shown);
    setBad(false);
  }, [shown]);

  /** The typed date, or "" when empty; null when it isn't a date, which keeps the text and the value. */
  const commit = (): string | null => {
    const date = text.trim() === "" ? "" : parseDayMonthYear(text);
    if (date === null) {
      setBad(true);
      return null;
    }
    setBad(false);
    setText(date ? fieldDate(date) : "");
    if (date !== value) onChange(date);
    return date;
  };

  return (
    <span className="inline-flex items-center gap-1">
      <input
        aria-label={label}
        aria-invalid={bad || undefined}
        inputMode="numeric"
        placeholder="dd/mm/yyyy"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setBad(false);
        }}
        onBlur={() => commit()}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          // Commit first and let the form see the new date; a bad date doesn't submit.
          event.preventDefault();
          const form = event.currentTarget.form;
          const result = { date: null as string | null };
          flushSync(() => {
            result.date = commit();
          });
          if (result.date !== null) form?.requestSubmit();
        }}
        className={`num w-24 ${className}`}
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
        type="date"
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
          Not a date: day/month/year
        </span>
      )}
    </span>
  );
}
