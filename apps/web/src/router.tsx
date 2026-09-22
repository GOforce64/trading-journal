import { createRootRoute, createRoute, createRouter, Outlet, useRouterState } from "@tanstack/react-router";
import { Shell } from "./components/Shell.js";
import { Panel } from "./components/ui.js";
import { Journal } from "./routes/Journal.js";

function RootLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <Shell activePath={pathname}>
      <Outlet />
    </Shell>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });

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
  component: Journal,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([dashboardRoute, journalRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
