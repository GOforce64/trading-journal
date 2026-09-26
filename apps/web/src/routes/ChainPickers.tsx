export interface Expiration {
  date: string;
  expired: boolean;
  strikes: number[];
}

const DAY = 86_400_000;
const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const midnight = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** "Oct 2 · Fri · 6d", counting days from `from` (the open date); "… · expired" once it has passed. */
export function expiryLabel(expiration: Expiration, from: string): string {
  const at = new Date(midnight(expiration.date));
  const days = Math.round((midnight(expiration.date) - midnight(from)) / DAY);
  return `${MONTH_DAY.format(at)} · ${WEEKDAY.format(at)} · ${expiration.expired ? "expired" : `${days}d`}`;
}

/** The listed strike closest to the stock's price, for the (ATM) hint. */
export function nearestStrike(strikes: number[], price: number | undefined): number | null {
  if (price === undefined || strikes.length === 0) return null;
  return strikes.reduce((best, strike) =>
    Math.abs(strike - price) < Math.abs(best - price) ? strike : best,
  );
}

const SELECT =
  "num rounded-sm border border-line bg-[#0e1118] px-2 py-1 text-[13px] text-fg outline-none focus:border-accent disabled:opacity-50";

/** A value the chain doesn't list stays selectable and says so, so nothing is silently dropped. */
function NotListed({ value, listed }: { value: string; listed: boolean }) {
  return value && !listed ? <option value={value}>{value} · not listed</option> : null;
}

export function ExpirySelect({
  id,
  value,
  expirations,
  from,
  onChange,
}: {
  id?: string;
  value: string;
  expirations: Expiration[];
  from: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      id={id}
      aria-label="Expiry"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={SELECT}
    >
      <option value="">—</option>
      <NotListed value={value} listed={expirations.some((expiration) => expiration.date === value)} />
      {expirations.map((expiration) => (
        <option key={expiration.date} value={expiration.date}>
          {expiryLabel(expiration, from)}
        </option>
      ))}
    </select>
  );
}

export function StrikeSelect({
  label,
  value,
  strikes,
  atm,
  onChange,
}: {
  label: string;
  value: string;
  strikes: number[];
  atm: number | null;
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={strikes.length === 0 && !value}
      className={`${SELECT} w-full text-right`}
    >
      {/* Blank: no strike yet, or, on a long leg, no wing at all (a 1-wing trade). */}
      <option value="">—</option>
      <NotListed value={value} listed={strikes.some((strike) => String(strike) === value)} />
      {strikes.map((strike) => (
        <option key={strike} value={String(strike)}>
          {strike === atm ? `${strike} (ATM)` : String(strike)}
        </option>
      ))}
    </select>
  );
}
