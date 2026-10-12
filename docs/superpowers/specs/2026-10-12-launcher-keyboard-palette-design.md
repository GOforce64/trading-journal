# Launcher, Keyboard Review and Command Palette — Design Spec

- **Date:** 2026-10-12
- **Status:** Approved 2026-10-12 ("write the plan"). The user made the decisions in §2 in the brainstorm and approved the three design sections (launcher, keyboard, palette). Reviewing the first draft, they added European dates everywhere (§8).
- **Scope:** parent spec §13, Phase 3 item 4, reshaped: the keyboard review flow and the full command palette. The PWA install is replaced by a launcher icon (§2). Plus European dates across the app (§8).
- **Parent spec:** [2026-09-22-trading-journal-design.md](2026-09-22-trading-journal-design.md), §3 (PWA, cmdk), §4 (runtime), §10 (palette and keys) and §13.

---

## 1. Purpose and success criteria

Three everyday frictions, removed:

- **Starting the journal** takes a terminal, `pnpm start` and typing `127.0.0.1:4178` into a browser.
- **Reviewing a morning's scalps** takes a mouse for every grade, setup, tag and Next.
- **Finding a trade** means opening the right list and scrolling.
- **Dates read the US way** ("Sep 28", and mm/dd/yyyy in the browser's date fields). The user uses European dates only.

**Success:**
- **Launcher:** after a one-time `pnpm launcher:install` on each machine, a **Trading Journal** icon (Fedora app menu and dock, Windows Start menu and taskbar) opens the journal in the default browser, Firefox included, in about 3–4 s from cold and at once when it's already running. A failure opens a page that says why.
- **Keyboard review:** a whole review queue can be worked through with no mouse, except to place a stop or target by dragging when that's quicker: J/K to move, 1–5 to grade, S/M/E/N to the fields, P/T/X, Enter for done-and-next, ? for help.
- **Palette:** Ctrl+K finds any page or tab, and any trade by ticker, day, month, setup, strategy or book. Opening a trade from it lets J/K step through all its matches.
- **Dates:** every date the app shows reads day first ("28 Sep", "28 Sep 2026"), and every date typed is day/month/year: `9/12/26` is 9 December 2026.

### Out of scope
- **Installing the app (PWA).** For a local app it only gives a browserless window and an icon; the launcher gives the icon in every browser. Installing is worth revisiting with the GitHub Pages demo, where it would work offline.
- **Starting the server at login.** It starts on the first click.
- **Stopping the server when the page closes.**
- **Actions in the palette** (new trade, sync, export, stop) and **a recent-trades list**.
- **Row keys on list pages** (J/K moving a highlighted row, Enter opening it).
- **Switching to a journal tab that's already open.** Nothing outside the browser can do that, so a click while the journal is open opens a second tab.

---

## 2. Decisions

All made by the user in the brainstorm, except the rows marked *(follows)*, which come from them.

| Question | Decision |
|---|---|
| Install (PWA) | **Skipped.** The user asked what installing gives; for this app, a browserless window and an icon. Instead: **a nicer way to run it**. |
| How it runs | **A launcher icon**, set up once per machine. |
| Server lifetime | **Starts on the first click** and stays in the background until logout, shutdown, or **Stop the journal** in Settings. |
| Scope | **Launcher, keyboard and palette in one spec and one PR**, the launcher first. |
| J / K | **The list the trade was opened from**, in its order. With no list, a scalp falls back to the review queue. |
| Trade-page keys | **All offered:** Enter (done, next); S, M, E, N (fields); P, T, X (stop, target, exclude); ? (help). Plus J/K and 1–5. |
| The palette finds | **Pages and tabs, and trades.** No actions, no recents. |
| Launcher build | **A Node script in TypeScript** (`apps/server/src/launch/`), run with tsx, with one setup command per machine. |
| Keyboard layer | **A small registry of our own**, not a library, so the help lists exactly what's registered. |
| Palette | **cmdk**, as the parent spec chose, with our own matching. |
| The list's storage | **The browser history's state**, not the URL. |
| Rebuild on start *(follows)* | **Every cold start runs `pnpm install --frozen-lockfile` and `pnpm build`.** Measured 2026-10-12 on Fedora: 0.6 s and 1.1 s, and the server answers 1.6 s after it starts. No "did the code change" check is needed for a cold start. |
| After a `git pull` *(follows)* | A click finding **a server the launcher started on an older commit** restarts it. |
| Dates | **European, everywhere** (the user, reviewing the first draft): "go everywhere and change 9/12/26 to be 9th of December 2026, I only use European date standards". |
| How dates show | **Day first, short month name:** "28 Sep", "28 Sep 2026", "28 Sep 09:35". Date fields show `09/12/2026`. Chosen over all-numeric "28/09". |
| Typed dates *(follows)* | **Day/month/year only.** `9/12/26` is 9 December 2026, and `9/28` isn't a date. ISO `2026-12-09` is also accepted, since it can't be misread. |

---

## 3. The launcher

### 3.1 Setup, once per machine
- **`pnpm launcher:install`** writes the icon and records what a click needs. A click from the app menu doesn't get the terminal's PATH or variables, so it records:
  - the full path of node (`process.execPath`) and of pnpm's entry script, run with that node;
  - the repo's path;
  - `TJ_DATA_DIR` and `TJ_PORT`, when set in the terminal that ran the setup.
- **Fedora:** `$XDG_DATA_HOME/applications/trading-journal.desktop` (usually `~/.local/share/applications`). `Name=Trading Journal`, `Terminal=false`, the icon by absolute path. It can then be pinned to the dock.
- **Windows:** `Trading Journal.lnk` in the user's Start menu (`%APPDATA%\Microsoft\Windows\Start Menu\Programs`), made through PowerShell's `WScript.Shell`, with the `.ico` icon and **Run: Minimized**. It can then be pinned to the taskbar.
- **`pnpm launcher:remove`** deletes the icon.
- Running the setup again overwrites the icon, for example after moving the repo or changing Node.

### 3.2 A click
1. **A lock.** `<data dir>/launch.lock`, created exclusively. If it's held, by a click still starting the journal, the second click exits; the first opens the browser. A lock older than 60 s, or whose process is gone, is stale and taken over.
2. **Is the journal up?** `GET http://127.0.0.1:<port>/api/health`, with a 1 s timeout.
   - **The journal answers** (`app: "trading-journal"`):
     - If `<data dir>/launcher.json` names that process (the launcher started it) **and** its commit differs from `git rev-parse HEAD`, it stops it (`POST /api/shutdown`), waits up to 10 s for the port to free, and goes on to step 3.
     - Otherwise, including a server started with `pnpm start`, it opens the browser and exits.
   - **Something else answers on the port:** the error page (§3.5).
   - **Nothing answers:** step 3.
3. **Start it.**
   1. `pnpm install --frozen-lockfile`, then `pnpm build`.
   2. Rotate `<data dir>/logs/server.log` to `server.1.log`.
   3. Spawn the server detached, with no window (`windowsHide`), its output to `server.log`, and the recorded `TJ_DATA_DIR` and `TJ_PORT`.
   4. Write `launcher.json`: `{ pid, head, port, startedAt }`.
   5. Poll health every 200 ms for up to 30 s.
4. **Open the browser** at `http://127.0.0.1:<port>/`: `xdg-open` on Linux, `cmd /c start "" <url>` on Windows. Release the lock and exit.

On Windows, the minimized console shows on the taskbar for those few seconds, then closes. On Fedora nothing shows until the browser opens.

### 3.3 Server changes
- **`GET /api/health`** returns `{ ok: true, app: "trading-journal", pid }`. The pid comes in through `createApp`'s deps, so the app stays free of `process`.
- **`POST /api/shutdown`**, mounted only when `createApp` is given a `shutdown` callback. `index.ts` and `demo.ts` give one; tests and the future browser demo don't.
  - It answers `{ ok: true }`, then stops taking connections and exits once the requests in flight end. **A sync or a merge in flight finishes first.**
  - It sits behind the existing guards: loopback only, the Host check, and refusing `Sec-Fetch-Site: cross-site` or `same-site`.
- **The launcher's code** lives in `apps/server/src/launch/`. It reuses `resolveDataDir` and `dataPaths` from `config.ts`. Its decisions sit in pure functions, given health, HEAD, the lock, spawn and open as inputs, so they can be tested.

### 3.4 Stopping
- **Settings gains a "Journal" panel with Stop the journal.** It posts to `/api/shutdown`. The app then shows a full-page "The journal has stopped. Open it again from its icon, or run `pnpm start`." in place of the shell, and makes no further requests.
- There's no confirm step: the icon starts it again in seconds.
- **Logging out or shutting down** also stops it: on Fedora the session's processes end, and on Windows sign-out ends them.
- **`pnpm start` is unchanged:** it runs in the foreground with logs in the terminal. Stop works there too and ends the process.

### 3.5 When a click fails
The launcher writes `<data dir>/launch-error.html` and opens it in the browser. The page holds the reason in one sentence, what to try, and the last 40 lines of `server.log`.

| Failure | Reason shown |
|---|---|
| Something else answers on the port | "Port 4178 is used by another program. Close it, or set TJ_PORT and run `pnpm launcher:install` again." |
| `pnpm install` or `pnpm build` fails | "Updating the journal failed", with the command's last lines. |
| The server exits, or isn't up within 30 s | "The journal didn't start", with the log's last lines. |
| An old server is still finishing a request after 10 s | "The journal is finishing a sync before it restarts with your update. Click the icon again in a minute." |
| node or pnpm has moved | "Node (or pnpm) is no longer at <path>. Run `pnpm launcher:install` again." |

If even the error page can't open, the launcher exits non-zero with the reason on stderr.

### 3.6 The icon
- **The nav's blue square** (`#2962ff`, 2–3 px radius) with a small white candlestick.
- It ships as `icon.svg`, `icon-256.png` and `icon.ico` (16–256 px) in `apps/web/public/`, committed.
- **It's also the browser tab's favicon,** which the app doesn't have yet.

---

## 4. The shortcut layer (`apps/web/src/keys/`)

- **One `keydown` listener on `window`**, mounted at the app's root by a `ShortcutsProvider`.
- **Pages register keys** with `useShortcut(key, { label, group, run })`. The registration lives while the component is mounted. A later registration of the same key wins, and it unregisters cleanly.
- **A key is ignored when:**
  - focus is in a text field, textarea, select or contenteditable, except Esc (§6.3) and Ctrl+K;
  - Ctrl, Alt or Meta is held, except Ctrl+K and Cmd+K;
  - the event's default was already prevented;
  - **a modal layer is up.** The palette, the help and the screenshot lightbox push a layer while mounted, and page keys stay off until it's gone. Each layer keeps its own keys: the lightbox's arrows and Esc, the palette's.
- **The key's name:**
  - `event.key` when it's a Latin letter, a digit or `?`;
  - otherwise `event.code`'s letter (`KeyJ` → `j`). On a Greek layout J gives `ξ`, and the fallback still finds J.
- **Enter and focus.** Enter belongs to the layer unless focus is on a button or link reached by keyboard (`:focus-visible`).
  - A mouse click on grade B leaves focus on B, so a plain Enter would click it again and clear the grade.
  - A button reached by Tab keeps its own Enter.
- **The help (?)** is a modal listing every registered key by group, plus the global ones (Ctrl+K, ?). It reads the registry, so it can't drift from the real keys.
- **Existing window listeners stay:** the chart's Esc ends placing, the Missed page's Esc and the lightbox's keys. The lightbox now also pushes a layer.

---

## 5. The list you came from

- **Opening a trade from a list puts the list in the history entry's state:** `tradeList: { ids, label }`, or `{ queue: true }` for the review queue. TanStack Router's `navigate({ state })` carries it, typed through the `HistoryState` declaration. It survives a reload and Back, and stays out of the URL.
- **J/K on the trade page navigate with the same state,** so the list carries on.
- **The lists, and what each passes:**

| Opened from | List |
|---|---|
| Journal, Scalps › All, Iron Flies (the shared `Journal` table) | the rows in the order shown, with the book filter applied. Label: the page, plus the book when filtered, e.g. "Journal · Paper" |
| Scalps › To review, the dashboard's To review, the queue bar | `{ queue: true }` |
| The Missed page | its rows, in order. Label "Missed" |
| The dashboard's day and recent lists | those rows. Labels "28 Sep" and "Recent" |
| Analytics Overview's largest wins and losses | those rows. Labels "Largest wins" and "Largest losses" |
| The palette's trade results | **every match**, not only the 50 shown. Label: the query, e.g. "nvda sep" |
| A chart marker, a link, a typed address | no list |

- **Order:** J goes to the next row down, K up. A list is a snapshot from when the trade was opened: editing a trade so it would leave the filter doesn't drop it. **Lists don't wrap:** at the end J does nothing.
- **The queue is live:** J/K are the queue bar's Next/Prev (`queueNav`), which wrap.
- **With no list,** a scalp uses the queue when any scalp waits. An iron fly or missed trade has no J/K, and they're absent from its help.
- **Where am I:** beside the queue bar, or in its place when the trade isn't queued, a small muted "4 of 41 · Journal · Paper". Nothing shows with no list.

---

## 6. Keys on a trade's page

### 6.1 The keys
Registered by the scalp, iron fly and missed trade pages. Only the keys that apply are registered, so the help shows only those.

| Key | Does | Scalp | Iron fly | Missed |
|---|---|---|---|---|
| J / K | Next / previous (§5) | ✓ | with a list | with a list |
| 1–5 | Grade A, B, C, D, F. The trade's own grade again clears it, like a click. | ✓ | ✓ | ✓ |
| Enter | **Done, then next.** A queued scalp with something missing is marked reviewed (`reviewed: true`), as Done reviewing does. Then J. If the save fails, it stays and shows the error. | ✓ | next | next |
| S | Opens the setup dropdown's list | ✓ | ✓ | ✓ |
| M | Focuses the mistake chips (skip reasons on a missed trade) | ✓ | ✓ | ✓ |
| E | Focuses the emotion chips | ✓ | ✓ | ✓ |
| N | Focuses the notes | ✓ | ✓ | ✓ |
| P | Places the stop on the chart, as + Stop does | ✓ | | ✓ |
| T | Places a target, as + Target does: a scalp's next target, a missed trade's one target | ✓ | | ✓ |
| X | Toggles Exclude from stats | ✓ | ✓ | ✓ |
| ? | The help | ✓ | ✓ | ✓ |

- **At the end of a list, or with an empty queue,** Enter still marks the scalp done and stays. The queue bar then says "REVIEWED ✓ 0 left".
- **Ctrl+K and ? work on every page,** not only trade pages.

### 6.2 The setup dropdown (S)
- A focused `<select>` changes on every arrow press. Here that would save each step, and could land on "+ New setup…" and open its name field.
- So **S opens the dropdown's list** with `showPicker()`, where arrows only move the highlight, Enter picks and Esc closes. A keypress counts as the user activation `showPicker()` needs.
- Where `showPicker()` is missing, S only focuses the select.

### 6.3 Chip groups (M, E) and notes (N)
- **A chip group is one tab stop with a roving focus.** ←/→ move between chips, Space or Enter toggles the focused chip (a mistake toggles; an emotion or skip reason replaces the trade's one), and Esc gives focus back to the page so the keys work again.
- **N focuses the notes.** Esc blurs, and blurring saves, as now.
- **Esc in any of these returns the keys.** That's the one key the layer acts on inside a field.

### 6.4 Discoverability
- **Each review panel** (the scalp's strip, the iron fly's side panel, the missed trade's column) gets a muted "Press ? for shortcuts" line.
- **The palette's button** in the nav shows "Ctrl K".

---

## 7. The command palette (`apps/web/src/palette/`)

### 7.1 Opening
- **Ctrl+K anywhere, Cmd+K on a Mac,** even while typing in a field. It takes the key from the browser (Firefox would otherwise focus its search bar).
- **"Search · Ctrl K" at the top of the left nav** opens it with the mouse.
- **Esc, Ctrl+K again, or a click outside** closes it. While it's open it's a modal layer (§4).
- It's built on **cmdk 1.1.1** (React 19 peer, released 2025) in the Terminal theme: a centred box near the top, the input, the results, and a footer "↑↓ move · Enter open · Esc close". cmdk's own filter is off (`shouldFilter={false}`); §7.2 and §7.3 decide what shows.

### 7.2 Pages
- **The pages:**
  - Dashboard, Journal, Iron Flies, Missed, Playbook, Import / Sync, Settings;
  - Analytics › Overview, Scalps, Iron flies, Missed;
  - Scalps › All, To review.
- **With nothing typed, the palette lists the pages.**
- **Typed words match loosely:** every word must match the start of a word in the page's name, in order. "an sc" finds Analytics › Scalps.
- **Enter navigates in the app** (TanStack Router), with no reload.

### 7.3 Trades
- **Source:** the unfiltered trade list from the same `/api/trades` call the Journal makes, through React Query's cache. Nothing new on the server.
- **The query, `parseTradeQuery(text, todayNy)`,** is a pure function in `palette/query.ts`. It splits on spaces and reads each word, or run of words for a setup, as:

| Kind | Examples | Matches |
|---|---|---|
| Day | `28/9`, `28/09`, `28/9/26`, `28.9.26`, `28-9-2026`, `2026-09-28`, `today`, `yesterday`, `mon`/`monday` … `sun` | trades opened that New York day, read day/month/year (§8.2). A date with no year is its latest occurrence on or before today. A weekday is the latest such day on or before today. |
| Month | `sep`, `september`, `2026-09` | trades opened that month. A month with no year is its latest. |
| Strategy or book | `scalp`, `fly`/`iron`, `missed`, `live`, `paper` | that strategy or book |
| Ticker | `nv`, `NVDA` | underlyings starting with it |
| Setup | `orb`, `orb breakout`, `vwap rec` | setups whose name starts with the words, read greedily left to right |

- **The reading order:**
  1. day;
  2. month;
  3. strategy or book;
  4. a word that is exactly a ticker in the journal, so `spy` stays SPY even with a setup called "Spy fade";
  5. setup;
  6. a ticker prefix.
  
  A word that fits none is **unknown**.
- **All words must match** (AND). Results are newest first. The first 50 show, then "+N more · keep typing to narrow".
- **An unknown word** shows "No trades match 'xyz'" for that word. Trades are never shown matched on the other words alone.
- **A row:**
  - the day, ticker and contract;
  - the strategy chip and the book chip;
  - the setup;
  - net P&L (none for a missed trade) and R.
- **Pages and trades show together:** Pages first, then Trades. A ticker-like query such as "nvda" matches no page, so it lands on its trades.
- **Enter on a trade** opens it with the full match list as its list (§5), labelled with the query.

---

## 8. European dates everywhere

### 8.1 Showing dates
- **One module, `packages/core/src/dateText.ts`,** replaces the about 30 US date formatters spread over the web app, core and the db package. Every date the app shows goes through it:

| Helper | Example | Replaces |
|---|---|---|
| `dayText` | 28 Sep | "Sep 28" in lists, the dashboard, analytics, Playbook cards, the missed trade's page, the server's own messages |
| `dayYearText` | 28 Sep 2026 | "Sep 28, 2026": the equity curve's crosshair, Playbook cards, the daily chart's crosshair (now "2026-09-28") |
| `dayTimeText` | 28 Sep 09:35 (and 09:35:12 with seconds) | "Sep 28, 09:35": trade pages, fills, the intraday crosshair, the IBKR card, import history, estimates |
| `monthText` | Sep 2026, or September 2026 long | "Sep 2026" and "September 2026": the dashboard's month, period labels, the month breakdown (unchanged in order) |
| `expiryText` | 26 Sep | contract names: "NVDA 232.5C 26 Sep"; the chain picker's "2 Oct · Fri · 6d" |
| `fieldDate` | 09/12/2026 | what a date field shows (§8.2) |

- **How it's built:** `formatToParts` in `en-US`, put together day first. The month names come out as "Sep" (`en-GB` would give "Sept"). Times stay 24-hour, as they are now.
- Days are **New York dates** wherever they are now. A plain date (`2026-09-28`) is formatted as that date, never shifted by a time zone.
- **Chart axes:**
  - the intraday and equity charts' tick labels and crosshairs, day first;
  - the daily chart's month and year ticks set explicitly, not left to the browser's language.
- **Unchanged internal clocks:** `core/calendar.ts` and `core/marks.ts` read New York's clock in `en-US` to compute dates, and `importers/oquants` parses oQuants' US text. These never show a date, so they stay, listed in the guard test (§10) as allowed.

### 8.2 Typing dates
- **`DateField`** (`apps/web/src/components/DateField.tsx`) replaces the four `<input type="date">`:
  - the IBKR start date in Settings;
  - Analytics' custom from and to;
  - the date in + Missed trade.
  
  The browser's own date field takes its order from the browser's language, so an English (US) Firefox shows mm/dd/yyyy, and a page can't change that.
- **It shows `DD/MM/YYYY`** (`09/12/2026`), and **`parseDayMonthYear`** (in `dateText.ts`) reads what's typed:
  - day, month, year with `/`, `.` or `-`: `9/12/26`, `09/12/2026`, `9.12.26`, `9-12-2026`. Two-digit years are 20YY.
  - ISO `2026-12-09`.
  - Day and month without a year only where a field says so (the palette's day words, §7.3).
- **It commits on Enter or blur.** Something that isn't a date (`31/02/2026`, `9/28/2026`) shows "Not a date: day/month/year" beside it and keeps the text; the value doesn't change. A min or max the old field had stays.
- **A 📅 button** opens the browser's picker, through a hidden native date field and `showPicker()`. A pick fills the field. The popup follows the browser's language, but a click can't be misread.

### 8.3 Not changed
- **Stored data and the API:** ISO dates and epoch times.
- **URLs:** `?from=2026-12-09` stays ISO.
- **What the app reads from others:** oQuants' and IBKR's dates are parsed as those services write them.
- **Earlier spec documents** keep their examples. The README and its screenshots change (§11).

---

## 9. Errors and edge states
- **The launcher:** §3.5. The lock (§3.2) covers double clicks.
- **A date typed wrong:** §8.2.
- **A stopped server, while the page is open:**
  - after Stop, the stopped screen (§3.4);
  - if the server dies another way, the existing "Could not load…" errors show, as now.
- **A list whose next trade was deleted:** opening it gives the trade page's existing not-found message. J again skips on to the next id.
- **Enter's save fails:** it stays on the trade with the review panel's existing "Couldn't save" message.
- **The palette before trades load** shows the pages and "Loading trades…". If loading fails: "Couldn't load trades", with the pages still usable.
- **`showPicker()` missing or refused:** S focuses the select (§6.2).
- **A key while a chart is placing a level:** Esc still ends placing (the chart's own listener). P or T switches what's being placed.

---

## 10. Testing
- **Launcher (server package, Vitest):**
  - the click's decisions as a table, with health, HEAD, `launcher.json`, the lock, spawn and open faked: up, up and stale, up but not ours, another program, down; lock held, stale and free; build failing; a timeout;
  - the `.desktop` text, and the PowerShell that makes the `.lnk`. On the Windows CI runner, that PowerShell runs for real into a temp folder and the shortcut is read back;
  - the error page's text for each failure;
  - **end to end:** start a real server on a spare port with a temp data directory through the launcher's start path, see health answer with its pid, then `POST /api/shutdown` and see the port free. Close everything before deleting the directory (Windows).
- **Server:**
  - health's new fields;
  - shutdown answers then calls the callback once;
  - a request in flight finishes first;
  - absent without the callback;
  - refused cross-site.
- **The shortcut layer:**
  - fields, modifiers, a prevented default, layers, the Greek fallback, Enter's focus rule;
  - registering and unregistering;
  - the help listing what's registered.
- **Lists:** each list passes its ids and label; J/K follow them and stop at the ends; the queue stays live and wraps; no list falls back to the queue for a scalp and gives nothing on an iron fly.
- **Trade-page keys:** each key on each page kind, against the patch it sends or the placing it starts; Enter's done-then-next and its failure.
- **Dates:**
  - every helper in `dateText.ts`: New York day boundaries, "Sep" never "Sept", 24-hour times, two-digit years;
  - `parseDayMonthYear`: each separator, `9/12/26` as 9 December 2026, `31/02/2026` and `9/28/2026` refused, ISO accepted;
  - `DateField`: shows `09/12/2026`, commits on Enter and blur, keeps a bad entry with its message, and the picker's pick fills it;
  - **a guard test** that fails if a date formatter (`Intl.DateTimeFormat`, `toLocaleDateString`, `toLocaleTimeString`, or `toLocaleString` on a Date) appears anywhere in `apps/` or `packages/` outside `dateText.ts`, except the internal clocks it lists (§8.1). Number formatting (`toLocaleString` on a number) isn't touched;
  - the ~36 existing test files that expect "Sep 28"-style text, updated.
- **The palette:**
  - `parseTradeQuery` with a fixed today: NY dates, year rollover (`15/12` in January), weekdays, `9/12/26` as 9 December and `9/28` as unknown, months, multi-word setups, unknown words;
  - the component: Ctrl+K from a field, pages first, the 50 cap, Enter on a page and on a trade (with its list), the loading and failed states.
- **Live check** (the plan's last task), on both machines:
  - install the icon, start from cold, click again while running;
  - pull a commit and click (restart);
  - Stop in Settings, then a click with the port taken;
  - a full queue review by keyboard in Firefox, and on a Greek layout;
  - screenshots of the palette and the help overlay (headless Firefox, as in earlier plans).

---

## 11. Changes to the parent spec
Applied in the plan's docs task:
- **§3:** the PWA row becomes "PWA: deferred to the public demo (§11). A launcher icon (`pnpm launcher:install`) gives the local app its icon."
- **§4 Runtime:** "and opens the browser" moves to the launcher: `pnpm start` runs in the foreground, the icon starts the server in the background and opens the browser.
- **§10:** the palette and keys line points here, with the full key list in §6.
- **§13 Phase 3 item 4:** "Launcher icon, keyboard review flow, full command palette (built: this spec). PWA install deferred to the demo."
- **README:** "Run it" leads with `pnpm launcher:install` and the icon, keeping `pnpm start`. Its screenshots are taken again, so they show the European dates.
- **§10 Visual design** gains: "Dates read day first ('28 Sep 2026'); typed dates are day/month/year."

---

## 12. Order of work
One branch (`feat/launcher-keys-palette`) and one PR:
0. **European dates** (§8): the shared module, every display, the date field. First, since it stands alone and the palette's day words build on its parser.
1. **The launcher:** the server's health and shutdown, then the launcher, the icon, setup and removal, and the Settings panel.
2. **The shortcut layer and the list you came from.**
3. **The trade-page keys,** the chip groups, the setup picker and the help.
4. **The palette.**
5. **Docs** (§11) and the **live check** (§10).
