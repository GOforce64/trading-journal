// oQuants → Trading Journal extractor.
// On oQuants, open Portfolio, press F12 → Console, paste this whole file, press Enter.
// It walks every page, expands every trade, and copies the table's text to the
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
  const pageKey = () =>
    tradeRows()
      .map((tr) => tr.querySelector(DESIGNER)?.getAttribute("href"))
      .join("|");
  const button = (label) => pagination().querySelector(`[aria-label="${label}"]`);

  const first = button("Go to first page");
  if (first && !first.disabled) {
    const before = pageKey();
    first.click();
    await waitFor(() => pageKey() !== before);
  }

  const trades = [];
  for (let page = 1; page <= 100; page++) {
    for (const tr of tradeRows()) {
      const expected = legCountInLink(tr);
      if (legRowsOf(tr).length < expected) {
        tr.cells[0].querySelector("button.MuiIconButton-root")?.click();
        if (!(await waitFor(() => legRowsOf(tr).length >= expected, 3000))) {
          console.warn(
            `oQuants extract: ${text(tr.querySelector(".oq-ticker-symbol"))} did not expand; its legs may be missing.`,
          );
        }
      }
      trades.push({
        ticker: text(tr.querySelector(".oq-ticker-symbol")),
        cells: [...tr.cells].map(text),
        designerHref: tr.querySelector(DESIGNER)?.getAttribute("href") ?? "",
        legs: legRowsOf(tr).map((leg) => ({ cells: [...leg.cells].map(text) })),
      });
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
  if (typeof copy === "function") {
    copy(payload);
    console.log(
      `Copied ${trades.length} trades (counter said "${pageCounter}"). Paste into the journal's Import page.`,
    );
  } else {
    console.log(`Collected ${trades.length} trades. Run copy(oquantsExport) to copy them.`);
  }
})();
