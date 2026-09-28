import { getRouteApi } from "@tanstack/react-router";
import { applyPatch } from "../analytics/search.js";
import { Analytics } from "./Analytics.js";

const route = getRouteApi("/analytics");

/** The Analytics page wired to its URL. It loads in its own chunk, with the charts. */
export function AnalyticsRoute() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  return (
    <Analytics
      search={search}
      onSearch={(patch) => navigate({ search: (prev) => applyPatch(prev, patch) })}
      onOpenTrade={(id) => navigate({ to: "/trades/$id", params: { id } })}
    />
  );
}
