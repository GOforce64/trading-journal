import type { TradeFill } from "../api.js";
import { Panel } from "../components/ui.js";

const ET = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
/** "Sep 28 09:31:05" in New York time. */
function fillTime(at: number): string {
  const parts = Object.fromEntries(ET.formatToParts(new Date(at)).map((part) => [part.type, part.value]));
  return `${parts.month} ${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const KIND_LABEL: Record<string, string> = {
  expiration: "expired",
  exercise: "exercised",
  assignment: "assigned",
};

/** Every fill of a synced trade, as IBKR reported it (spec §9.5). Nothing for a trade typed in by hand. */
export function FillsPanel({ fills }: { fills: TradeFill[] }) {
  if (fills.length === 0) return null;
  return (
    <Panel title="Fills">
      <table className="num w-full border-collapse text-[11px]">
        <thead className="text-[9px] text-muted uppercase tracking-wider">
          <tr>
            <th className="text-left font-medium">Time (ET)</th>
            <th className="text-left font-medium">Side</th>
            <th className="text-left font-medium">Contract</th>
            <th className="text-right font-medium">Size</th>
            <th className="text-right font-medium">Price</th>
            <th className="text-right font-medium">Commission</th>
            <th className="text-left font-medium" />
          </tr>
        </thead>
        <tbody>
          {fills.map((fill) => (
            <tr
              key={fill.id}
              data-testid={`fill-row-${fill.id}`}
              className={`border-line border-t ${fill.canceled ? "text-muted line-through" : ""}`}
            >
              <td>{fillTime(fill.executedAt)}</td>
              <td className={fill.quantity > 0 ? "text-up" : "text-down"}>
                {fill.quantity > 0 ? "BUY" : "SELL"}
              </td>
              <td>
                {fill.strike}
                {fill.right}
              </td>
              <td className="text-right">{Math.abs(fill.quantity)}</td>
              <td className="text-right">{fill.price.toFixed(2)}</td>
              <td className="text-right">{usd(fill.commission)}</td>
              <td className="pl-2 text-muted">
                {fill.canceled ? "canceled" : (KIND_LABEL[fill.kind] ?? "")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
