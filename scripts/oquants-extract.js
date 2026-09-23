// oQuants → Trading Journal extractor.
// On oQuants, open Portfolio, press F12 → Console, paste this whole file, press Enter.
// It walks every page, expands each trade in turn, and copies the table's text to the
// clipboard. It reads only what the page shows; no cookies, tokens or storage.
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (check, timeoutMs = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (check()) return true;
      await sleep(100);
    }
    return false;
  };
  const text = (element) => (element ? element.innerText.trim() : "");
  const pagination = () => document.querySelector(".MuiTablePagination-root");

  if (!pagination()) {
    console.error("oQuants extract: no trades table found. Open the Portfolio page first.");
    return;
  }
  // The first <table> on the page is the P&L chart, so find the one that owns the pagination.
  const table = () => pagination().closest("table");
  const headers = [...table().querySelectorAll("thead th")].map(text);
  const typeColumn = headers.indexOf("Type");
  const DESIGNER = 'a[href*="/dashboard/designer/"]';

  const tradeRows = () =>
    [...table().querySelectorAll("tbody tr")].filter((tr) => tr.querySelector(".oq-ticker-symbol"));
  const legRowsOf = (tr) => {
    const legs = [];
    for (
      let next = tr.nextElementSibling;
      next && !next.querySelector(".oq-ticker-symbol");
      next = next.nextElementSibling
    ) {
      if (/^(Call|Put)$/.test(text(next.cells[typeColumn]))) legs.push(next);
    }
    return legs;
  };
  const legCountInLink = (tr) => {
    const link = tr.querySelector(DESIGNER);
    if (!link) return 0;
    return [...new URL(link.href).searchParams.keys()].filter((key) => /^positions\[\d+\]\[type\]$/.test(key))
      .length;
  };
  // Ticker + open time names a trade; the designer link's ids change on every render.
  const openColumn = headers.indexOf("Open Date");
  const rowKey = (tr) => `${text(tr.querySelector(".oq-ticker-symbol"))}|${text(tr.cells[openColumn])}`;
  const findRow = (key) => tradeRows().find((tr) => rowKey(tr) === key);
  const toggle = (tr) => tr.cells[0].querySelector("button.MuiIconButton-root")?.click();
  const pageKey = () => tradeRows().map(rowKey).join("\n");
  const button = (label) => pagination().querySelector(`[aria-label="${label}"]`);

  const first = button("Go to first page");
  if (first && !first.disabled) {
    const before = pageKey();
    first.click();
    await waitFor(() => pageKey() !== before);
  }

  // oQuants pages by rows and leg rows count toward the 50, so an expanded trade
  // pushes others off the page. Work one trade at a time: expand, read, collapse.
  const collapseAll = async () => {
    for (let guard = 0; guard < 100; guard++) {
      const open = tradeRows().find((tr) => legRowsOf(tr).length > 0);
      if (!open) return;
      const key = rowKey(open);
      toggle(open);
      await waitFor(() => !findRow(key) || legRowsOf(findRow(key)).length === 0, 3000);
    }
  };

  const cellsOf = (row) => ({ cells: [...row.cells].map(text) });
  const goTo = async (label) => {
    const target = button(label);
    if (!target || target.disabled) return false;
    const before = pageKey();
    target.click();
    return waitFor(() => pageKey() !== before);
  };
  const isLastOnPage = (tr) => {
    let next = tr.nextElementSibling;
    while (next && !next.querySelector(".oq-ticker-symbol")) next = next.nextElementSibling;
    return !next;
  };
  // An expanded trade at the bottom of a page has its later legs pushed onto the
  // next page, where they lead the table before its first trade row.
  const spilledLegs = async () => {
    if (!(await goTo("Go to next page"))) return [];
    const legs = [];
    for (const row of table().querySelectorAll("tbody tr")) {
      if (row.querySelector(".oq-ticker-symbol")) break;
      if (/^(Call|Put)$/.test(text(row.cells[typeColumn]))) legs.push(cellsOf(row));
    }
    await goTo("Go to previous page");
    return legs;
  };

  const trades = [];
  for (let page = 1; page <= 100; page++) {
    await collapseAll();
    for (const key of tradeRows().map(rowKey)) {
      const row = findRow(key);
      if (!row) {
        console.warn(`oQuants extract: ${key} vanished from the page; it may be missing.`);
        continue;
      }
      const expected = Math.max(1, legCountInLink(row));
      toggle(row);
      await waitFor(() => findRow(key) && legRowsOf(findRow(key)).length >= expected, 3000);
      await sleep(100);
      let tr = findRow(key);
      if (!tr) {
        console.warn(`oQuants extract: ${key} vanished from the page; it may be missing.`);
        continue;
      }
      const trade = {
        ticker: text(tr.querySelector(".oq-ticker-symbol")),
        cells: [...tr.cells].map(text),
        designerHref: tr.querySelector(DESIGNER)?.getAttribute("href") ?? "",
        legs: legRowsOf(tr).map(cellsOf),
      };
      if (trade.legs.length < expected && isLastOnPage(tr)) {
        trade.legs.push(...(await spilledLegs()));
        tr = findRow(key);
      }
      if (trade.legs.length === 0) {
        console.warn(`oQuants extract: ${key} did not expand; its legs may be missing.`);
      }
      trades.push(trade);
      if (tr && legRowsOf(tr).length > 0) {
        toggle(tr);
        await waitFor(() => !findRow(key) || legRowsOf(findRow(key)).length === 0, 3000);
      }
    }
    const next = button("Go to next page");
    if (!next || next.disabled) break;
    const before = pageKey();
    next.click();
    if (!(await waitFor(() => pageKey() !== before))) {
      console.error("oQuants extract: the next page never loaded; stopping with what was collected.");
      break;
    }
  }

  const pageCounter =
    text(pagination().querySelector(".MuiTablePagination-displayedRows")) || text(pagination());
  const payload = JSON.stringify({
    format: "oquants-cells/1",
    capturedAt: new Date().toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    pageCounter,
    headers,
    trades,
  });

  window.oquantsExport = payload;
  // Some browsers ignore copy() this late in a long-running script, so always say how to copy by hand.
  if (typeof copy === "function") copy(payload);
  console.log(
    `Collected ${trades.length} trades (counter said "${pageCounter}"). If the clipboard is empty, run copy(oquantsExport) here, then paste into the journal's Import page.`,
  );
})();
