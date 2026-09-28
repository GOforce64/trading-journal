import { createRootRoute, createRoute, createRouter, Outlet, useRouterState } from "@tanstack/react-router";
import { Shell } from "./components/Shell.js";
import { Panel } from "./components/ui.js";
import { ComingSoon } from "./routes/ComingSoon.js";
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
const editTrade = (id: string) => router.navigate({ to: "/trades/$id/edit", params: { id } });

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => (
    <Panel title="Dashboard">
      <p className="text-muted">Your numbers appear here once trades are logged.</p>
    </Panel>
  ),
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
    return <TradeDetail tradeId={id} onEdit={editTrade} />;
  },
});

const editTradeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/trades/$id/edit",
  component: function EditTradeRoute() {
    const { id } = editTradeRoute.useParams();
    return <EditTrade tradeId={id} onSaved={openTrade} />;
  },
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
    path: "/analytics",
    title: "Analytics",
    phase: "a later Phase 1 plan",
    blurb: "Equity curve, P&L calendar, time-of-day buckets and per-setup breakdowns.",
  },
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
