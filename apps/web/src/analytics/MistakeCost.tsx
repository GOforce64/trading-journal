import type { GroupStats, MistakeRow } from "@tj/core";
import { dollars, rText, winRateText } from "./format.js";
import { Section } from "./Section.js";

const WITH = "#5b8cff";
const WITHOUT = "#6b7385";

const tone = (value: number | null) => {
  if (value == null || value === 0) return "text-muted";
  return value > 0 ? "text-up" : "text-down";
};

/** The dumbbell's half-width in R: 2, or the next whole R past the largest average (spec §6.5). */
export function dumbbellExtent(rows: readonly MistakeRow[]): number {
  const largest = Math.max(
    0,
    ...rows.flatMap((row) => [row.withTag?.avgR, row.withoutTag?.avgR].map((r) => Math.abs(r ?? 0))),
  );
  return Math.max(2, Math.ceil(largest));
}

/** Where an R sits across the axis, in percent. */
const at = (r: number, extent: number) => 50 + (r / extent) * 50;

/** What hovering a dumbbell says: "Chased entry: −0.62R with, +0.52R without, 1.14R worse". */
export function dumbbellTitle(row: MistakeRow): string {
  const withR = row.withTag?.avgR ?? null;
  const withoutR = row.withoutTag?.avgR ?? null;
  const side = (r: number | null) => (r == null ? "no R" : rText(r));
  let gap = "";
  if (withR != null && withoutR != null) {
    const difference = withR - withoutR;
    gap =
      Math.abs(difference) < 0.005
        ? ", no different"
        : `, ${Math.abs(difference).toFixed(2)}R ${difference < 0 ? "worse" : "better"}`;
  }
  return `${row.label}: ${side(withR)} with, ${side(withoutR)} without${gap}`;
}

function Dumbbell({ row, extent }: { row: MistakeRow; extent: number }) {
  const withR = row.withTag?.avgR ?? null;
  const withoutR = row.withoutTag?.avgR ?? null;
  let link = "";
  if (withR != null && withoutR != null) {
    if (withR < withoutR) link = "bg-down/60";
    else if (withR > withoutR) link = "bg-up/60";
    else link = "bg-muted/60";
  }
  const dot = (r: number, color: string, testId: string) => (
    <span
      data-testid={testId}
      className="absolute top-[2px] size-2.5 rounded-full shadow-[0_0_0_2px_var(--color-panel)]"
      style={{ left: `calc(${at(r, extent)}% - 5px)`, background: color }}
    />
  );
  return (
    <div title={dumbbellTitle(row)} className="relative h-3.5 min-w-32">
      <span className="absolute inset-y-0 left-1/2 w-px bg-[#2a2e39]" />
      {withR != null && withoutR != null && (
        <span
          data-testid="link"
          className={`absolute top-[6px] h-0.5 rounded-[1px] ${link}`}
          style={{
            left: `${Math.min(at(withR, extent), at(withoutR, extent))}%`,
            width: `${Math.abs(at(withR, extent) - at(withoutR, extent))}%`,
          }}
        />
      )}
      {withoutR != null && dot(withoutR, WITHOUT, "dot-without")}
      {withR != null && dot(withR, WITH, "dot-with")}
    </div>
  );
}

function SideCells({ side }: { side: GroupStats | null }) {
  if (!side) {
    return (
      <>
        {["n", "net", "r", "win"].map((cell, index) => (
          <td key={cell} className={`num text-right text-muted ${index === 0 ? "border-line border-l" : ""}`}>
            —
          </td>
        ))}
      </>
    );
  }
  return (
    <>
      <td className="num border-line border-l text-right text-muted">{side.trades}</td>
      <td className={`num text-right ${tone(side.net)}`}>{dollars(side.net)}</td>
      <td className={`num text-right ${tone(side.avgR)}`}>{side.avgR == null ? "—" : rText(side.avgR)}</td>
      <td className="num text-right">{winRateText(side.winRate)}</td>
    </>
  );
}

const SIDE_HEADERS = ["Net", "Avg R", "Win %"];

/** Each mistake's scalps against the rest, with an avg-R dumbbell (scalp-analytics spec §6.5). */
export function MistakeCost({ rows }: { rows: readonly MistakeRow[] }) {
  const extent = dumbbellExtent(rows);
  const legend = (
    <span className="flex items-center gap-2 normal-case tracking-normal">
      <span className="flex items-center gap-1">
        <span className="size-2 rounded-full" style={{ background: WITH }} />
        with
      </span>
      <span className="flex items-center gap-1">
        <span className="size-2 rounded-full" style={{ background: WITHOUT }} />
        without
      </span>
    </span>
  );
  return (
    <Section title="Mistake cost" right={rows.length > 0 ? legend : undefined}>
      {rows.length === 0 ? (
        <p className="text-muted">No mistakes tagged in this range.</p>
      ) : (
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="text-[9px] text-muted uppercase tracking-wider">
              <th className="py-1 text-left font-medium">Mistake</th>
              <th className="border-line border-l text-right font-medium">With</th>
              {SIDE_HEADERS.map((header) => (
                <th key={`with-${header}`} className="text-right font-medium">
                  {header}
                </th>
              ))}
              <th className="border-line border-l text-right font-medium">Without</th>
              {SIDE_HEADERS.map((header) => (
                <th key={`without-${header}`} className="text-right font-medium">
                  {header}
                </th>
              ))}
              <th className="border-line border-l text-center font-medium">Avg R</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.tagId ?? "none"} className="border-line border-t">
                <td className={`py-0.5 ${row.tagId == null ? "text-muted" : ""}`}>{row.label}</td>
                <SideCells side={row.withTag} />
                <SideCells side={row.withoutTag} />
                <td className="border-line border-l px-2">
                  <Dumbbell row={row} extent={extent} />
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={9} />
              <td className="border-line border-l px-2">
                <div className="relative h-3 text-[8px] text-muted">
                  {[-1, -0.5, 0, 0.5, 1].map((share, index) => {
                    const value = share * extent;
                    let label = `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)}`;
                    if (index === 0 || index === 4) label += "R";
                    return (
                      <span
                        key={share}
                        className="absolute -translate-x-1/2"
                        style={{ left: `${50 + share * 50}%` }}
                      >
                        {label}
                      </span>
                    );
                  })}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </Section>
  );
}
