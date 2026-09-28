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
import { ComingSoon } from "./routes/ComingSoon.js";
import { Dashboard } from "./routes/Dashboard.js";
import { EditTrade } from "./routes/EditTrade.js";
import { Import } from "./routes/Import.js";
import { IronFlies } from "./routes/IronFlies.js";
import { Journal } from "./routes/Journal.js";
import { NewIronFly } from "./routes/NewIronFly.js";
import { Settings } from "./routes/Settings.js";
import { TradeDetail } from "./routes/TradeDetail.js";

function RootLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <Shell activePath={pathname}>
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
    return <TradeDetail tradeId={id} onEdit={editTrade} onSettle={settleTrade} />;
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

/** Nav destinations whose features arrive in later plans; better than a dead link. */
const PLACEHOLDERS = [
  {
    path: "/missed",
    title: "Missed",
    phase: "Phase 2",
    blurb: "Setups you spotted but skipped, marked on the chart and scored in R.",
  },
  {
    path: "/playbook",
    title: "Playbook",
    phase: "a later Phase 1 plan",
    blurb: "Your named setups, each with its own win rate, average R and P&L.",
  },
];

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
    tradeDetailRoute,
    editTradeRoute,
    importRoute,
    settingsRoute,
    ...placeholderRoutes,
  ]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
