# Trading Journal

A local-first options trading journal for two very different strategies: short-dated
scalps near the market open, and earnings IV-crush iron flies.

It runs entirely on your own machine. There is no account, no server to sign up for,
and no telemetry.

## Your data stays yours

The repository holds code only. Your trades live in a data directory outside it:

| OS | Location |
|---|---|
| Linux | `$XDG_DATA_HOME/trading-journal` (usually `~/.local/share/trading-journal`) |
| Windows | `%APPDATA%\trading-journal` |

Set `TJ_DATA_DIR` to put it somewhere else. The directory holds `journal.db`, your
screenshots, automatic backups taken before every migration, and any API tokens you
configure. None of it is ever written into the repository.

### Live prices and option chains (optional)

With a free [Alpaca](https://alpaca.markets) paper-account key, saved on the Settings
page, the journal shows each symbol's last price, lets the builder pick expiries and
strikes from the listed chain, and estimates what closing an open trade would realise.
Estimates are shown, never stored. Without a key everything else works as before.

## Quickstart

```
pnpm install
pnpm dev:server     # API on http://127.0.0.1:4178
pnpm dev:web        # UI on http://127.0.0.1:5173
```

To run it the way you'd use it day to day, with UI and API served together:

```
pnpm start          # http://127.0.0.1:4178
```

Linux/macOS: `./scripts/start.sh` · Windows: `scripts\start.cmd`

Requires Node 22 or newer and pnpm. The server binds to loopback only and refuses
requests that don't come from `localhost`.

## What it tracks

- **Iron flies** — structure (including broken wings, where each side's risk is
  measured separately), credit and how much of it you keep, max loss, breakevens, and the
  earnings context around the trade: implied vs actual move and IV crush, worked out from
  your fills and Alpaca's historical stock prices, and settling an expired fly at intrinsic
  value. Imported from oQuants, typed in, and synced from IBKR paper, as one trade however
  many orders its legs took.
- **Scalps** — synced from IBKR (Flex Web Service) from a start date you choose, or
  typed in, with every fill kept; reviewed on the trade page with the chart: drag the stop and
  target on the chart (or type them as option premium), pick a setup, mistakes, an emotion and a grade,
  and work through a To review queue; setups and tags live on the Playbook page, with a stat
  card per setup. Each scalp gets its R: the stop repriced by Black-Scholes into dollars at risk, several targets with
  trims, R, R:R, MAE/MFE, its return on the premium paid, and Avg R on the Dashboard. The
  chart of the session: 3-minute candles (1m to 1h), with a daily chart beside it, your fills
  marked, EMAs, VWAP, and premarket and prior-day levels, from Alpaca's free data.
- **Review** — a Dashboard for the current period (KPIs, equity curve with drawdown,
  P&L calendar, open and recent trades) and an Analytics page with every split at once,
  a Scalps tab (time of day, hold time, breakdowns in R and return on cost, and what each mistake
  costs), and an Iron flies tab measured against max profit.
- **Missed trades** — setups you saw but didn't take, scored in R, kept out of the
  dollar statistics.

Missed trades and an option-premium chart arrive in later steps; see
[the design spec](docs/superpowers/specs/2026-09-22-trading-journal-design.md) and
[the plans](docs/superpowers/plans/).

## Development

```
pnpm test           # vitest, all packages
pnpm typecheck      # tsc --build
pnpm lint           # biome
```

CI runs the same three on Ubuntu and Windows.

## Licence

MIT
