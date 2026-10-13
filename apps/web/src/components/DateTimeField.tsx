import { fieldDateTime, parseDayMonthYearTime } from "@tj/core";
import { WallClockField } from "./DateField.js";

/**
 * A date and time on the browser's clock (a trade form's Opened and Closed): shows 28/09/2026 09:31:05, reads
 * 28/9/26 9:31 or ISO, on a 24-hour clock whatever the browser's language. The value is datetime-local's text,
 * "2026-09-28T09:31[:05]", or "" for none.
 */
export function DateTimeField({
  className = "",
  ...props
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <WallClockField
      {...props}
      className={`w-40 ${className}`}
      show={fieldDateTime}
      read={parseDayMonthYearTime}
      nativeType="datetime-local"
      message="Not a date and time: day/month/year hh:mm"
      placeholder="dd/mm/yyyy hh:mm"
    />
  );
}
