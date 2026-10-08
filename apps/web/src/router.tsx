import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { parseAnalyticsSearch, parseDashboardSearch } from "./analytics/search.js";
import { Shell } from "./components/Shell.js";
import { Panel } from "./components/ui.js";
import { useAutoSync, useIbkrSyncing } from "./ibkr.js";
import { MissedPage } from "./missed/MissedPage.js";
import { NewMissed } from "./missed/NewMissed.js";
import { usePendingReviews } from "./review/data.js";
import { ComingSoon } from "./routes/ComingSoon.js";
import { Dashboard } from "./routes/Dashboard.js";
import { EditTrade } from "./routes/EditTrade.js";
import { Import } from "./routes/Import.js";
import { IronFlies } from "./routes/IronFlies.js";
import { Journal } from "./routes/Journal.js";
import { NewIronFly } from "./routes/NewIronFly.js";
import { NewScalp } from "./routes/NewScalp.js";
import { Playbook } from "./routes/Playbook.js";
import { Scalps } from "./routes/Scalps.js";
import { Settings } from "./routes/Settings.js";
import { TradeDetail } from "./routes/TradeDetail.js";

function RootLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useAutoSync();
  const syncing = useIbkrSyncing();
  const toReview = usePendingReviews().data?.length ?? 0;
  return (
    <Shell activePath={pathname} syncing={syncing} toReview={toReview}>
      <Outlet />
    </Shell>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => (
    <Panel title="Not found">
      <p className="text-muted">That page does not exist. Try Journal or Iron Flies.</p>
    </Panel>
  ),
});

const openTrade = (id: string) => router.navigate({ to: "/trades/$id", params: { id } });
const editTrade = (id: string) => router.navigate({ to: "/trades/$id/edit", params: { id }, search: {} });
/** The missed trade's page replaces the new-trade page, so Back skips the empty chart. */
const openCreatedMissed = (id: string) =>
  router.navigate({ to: "/trades/$id", params: { id }, replace: true });
const settleTrade = (id: string) =>
  router.navigate({ to: "/trades/$id/edit", params: { id }, search: { settle: true } });

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: parseDashboardSearch,
  component: function DashboardRoute() {
    const search = dashboardRoute.useSearch();
    return (
      <Dashboard
        search={search}
        onSearch={(next) => router.navigate({ to: "/", search: next })}
        onOpenTrade={openTrade}
      />
    );
  },
});

const journalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/journal",
  component: () => <Journal onOpenTrade={openTrade} />,
});

const ironFliesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/iron-flies",
  component: () => (
    <IronFlies onOpenTrade={openTrade} onNewTrade={() => router.navigate({ to: "/iron-flies/new" })} />
  ),
});

const scalpsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/scalps",
  // The tab: `?tab=review` opens To review; All is the default, left out.
  validateSearch: (raw: Record<string, unknown>): { tab?: "review" } =>
    raw.tab === "review" ? { tab: "review" } : {},
  component: function ScalpsRoute() {
    const { tab } = scalpsRoute.useSearch();
    return (
      <Scalps
        onOpenTrade={openTrade}
        onNewScalp={() => router.navigate({ to: "/scalps/new" })}
        tab={tab}
        onTab={(next) => router.navigate({ to: "/scalps", search: next ? { tab: next } : {} })}
      />
    );
  },
});

const newScalpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/scalps/new",
  component: () => <NewScalp onCreated={openTrade} />,
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const newMissedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/missed/new",
  validateSearch: (raw: Record<string, unknown>): { symbol: string; date: string } => ({
    symbol: typeof raw.symbol === "string" ? raw.symbol.toUpperCase().slice(0, 12) : "",
    date: typeof raw.date === "string" && ISO_DATE.test(raw.date) ? raw.date : "",
  }),
  component: function NewMissedRoute() {
    const { symbol, date } = newMissedRoute.useSearch();
    if (!symbol || !date) return <p className="text-muted">Pick a ticker and a date on the Missed page.</p>;
    return <NewMissed key={`${symbol}-${date}`} symbol={symbol} date={date} onCreated={openCreatedMissed} />;
  },
});

const newIronFlyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/iron-flies/new",
  component: () => <NewIronFly onCreated={openTrade} />,
});

const tradeDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/trades/$id",
  component: function TradeDetailRoute() {
    const { id } = tradeDetailRoute.useParams();
    // Keyed by id: Next opens the next scalp with fresh fields, not the last one's typing.
    return (
      <TradeDetail
        key={id}
        tradeId={id}
        onEdit={editTrade}
        onSettle={settleTrade}
        onOpenTrade={openTrade}
        onDeleted={() => router.navigate({ to: "/missed" })}
        onNewMissed={(symbol, date) => router.navigate({ to: "/missed/new", search: { symbol, date } })}
      />
    );
  },
});

const editTradeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/trades/$id/edit",
  // `settle` opens the form on the exits proposed at expiry (spec §9.5).
  validateSearch: (raw: Record<string, unknown>): { settle?: true } =>
    raw.settle === true || raw.settle === "true" ? { settle: true } : {},
  component: function EditTradeRoute() {
    const { id } = editTradeRoute.useParams();
    const { settle } = editTradeRoute.useSearch();
    return <EditTrade tradeId={id} settle={settle === true} onSaved={openTrade} />;
  },
});

const analyticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics",
  validateSearch: parseAnalyticsSearch,
  component: lazyRouteComponent(() => import("./routes/AnalyticsRoute.js"), "AnalyticsRoute"),
});

const importRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/import",
  component: () => <Import onDone={() => router.navigate({ to: "/iron-flies" })} />,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: () => <Settings />,
});

const playbookRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/playbook",
  component: () => (
    <Playbook onOpenSetup={(setup, tab) => router.navigate({ to: "/analytics", search: { tab, setup } })} />
  ),
});

const missedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/missed",
  component: () => (
    <MissedPage
      onOpenTrade={openTrade}
      onNewMissed={(symbol, date) => router.navigate({ to: "/missed/new", search: { symbol, date } })}
    />
  ),
});

/** Nav destinations whose features arrive in later plans; better than a dead link. */
const PLACEHOLDERS: { path: string; title: string; phase: string; blurb: string }[] = [];

const placeholderRoutes = PLACEHOLDERS.map((page) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: page.path,
    component: () => (
      <ComingSoon title={page.title} phase={page.phase}>
        {page.blurb}
      </ComingSoon>
    ),
  }),
);

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    dashboardRoute,
    journalRoute,
    analyticsRoute,
    ironFliesRoute,
    newIronFlyRoute,
    scalpsRoute,
    newScalpRoute,
    newMissedRoute,
    missedRoute,
    tradeDetailRoute,
    editTradeRoute,
    importRoute,
    settingsRoute,
    playbookRoute,
    ...placeholderRoutes,
  ]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
