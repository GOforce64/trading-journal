import { holidayName, round2, WEEKDAYS } from "@tj/core";
import { monthOf, monthWeeks } from "./dates.js";
import { dollars } from "./format.js";

export interface CalendarDay {
  net: number;
  trades: readonly unknown[];
}

const tone = (net: number) => (net > 0 ? "text-up" : net < 0 ? "text-down" : "text-muted");

/**
 * One month, Monday to Friday, with a week-total column (spec §6). A week's total covers all seven of its days
 * inside the month, so a close dated on a weekend still counts and the weeks add up to the month.
 */
export function PnlCalendar({
  month,
  days,
  selected,
  onSelect,
}: {
  month: string;
  days: ReadonlyMap<string, CalendarDay>;
  selected: string | null;
  onSelect: (date: string) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(5,minmax(0,1fr))_minmax(0,1.1fr)] gap-1">
      {[...WEEKDAYS.slice(0, 5), "Week"].map((head) => (
        <div key={head} className="text-center text-[9px] text-muted uppercase">
          {head}
        </div>
      ))}
      {monthWeeks(month).flatMap((week) => {
        const inMonth = week.filter((date) => monthOf(date) === month);
        const traded = inMonth.some((date) => days.has(date));
        const total = round2(inMonth.reduce((sum, date) => sum + (days.get(date)?.net ?? 0), 0));
        return [
          ...week
            .slice(0, 5)
            .map((date) => (
              <DayCell
                key={date}
                date={date}
                inMonth={monthOf(date) === month}
                day={days.get(date)}
                selected={selected === date}
                onSelect={onSelect}
              />
            )),
          <div
            key={`total-${week[0]}`}
            data-testid={`week-${week[0]}`}
            className="rounded-[2px] border border-line bg-panel p-1 text-[10px]"
          >
            <div className="text-[8px] text-muted">total</div>
            <div className={`num ${tone(total)}`}>{traded ? dollars(total) : "—"}</div>
          </div>,
        ];
      })}
    </div>
  );
}

function DayCell({
  date,
  inMonth,
  day,
  selected,
  onSelect,
}: {
  date: string;
  inMonth: boolean;
  day: CalendarDay | undefined;
  selected: boolean;
  onSelect: (date: string) => void;
}) {
  if (!inMonth) return <div className="min-h-9 rounded-[2px] border border-line opacity-30" />;
  const holiday = holidayName(date);
  const number = <div className="text-[8px] text-muted">{Number(date.slice(8))}</div>;
  if (!day) {
    return (
      <div
        title={holiday ?? undefined}
        className={`min-h-9 rounded-[2px] border border-line bg-[#0e1118] p-1 text-[10px] ${holiday ? "opacity-40" : ""}`}
      >
        {number}
      </div>
    );
  }
  const fill =
    day.net > 0
      ? "border-[#26a69a55] bg-[#26a69a1f]"
      : day.net < 0
        ? "border-[#ef535055] bg-[#ef53501f]"
        : "border-line";
  return (
    <button
      type="button"
      aria-label={`${date}: ${dollars(day.net)}, ${day.trades.length} trades`}
      aria-pressed={selected}
      onClick={() => onSelect(date)}
      className={`min-h-9 rounded-[2px] border p-1 text-left text-[10px] ${fill} ${selected ? "outline outline-accent" : ""}`}
    >
      {number}
      <div className={`num ${tone(day.net)}`}>{dollars(day.net)}</div>
      <div className="text-[8px] text-muted">{day.trades.length} tr</div>
    </button>
  );
}
