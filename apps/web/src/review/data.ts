import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, refusal, type TradeDetailView, type TradeView } from "../api.js";

type SetupsResponse = Awaited<ReturnType<Awaited<ReturnType<typeof api.api.setups.$get>>["json"]>>;
/** A setup as the pickers and the Playbook list it: archived ones included, each with its trade count. */
export type Setup = SetupsResponse[number];
type TagsResponse = Awaited<ReturnType<Awaited<ReturnType<typeof api.api.tags.$get>>["json"]>>;
export type Tag = TagsResponse[number];
/** What PATCH /api/trades/:id takes. */
export type TradePatchBody = Parameters<(typeof api.api.trades)[":id"]["$patch"]>[0]["json"];

/** Every setup, archived ones too: a trade keeps showing an archived setup it has (scalp-review spec §9.1). */
export function useSetups() {
  return useQuery({
    queryKey: ["setups"],
    queryFn: async (): Promise<Setup[]> => {
      const res = await api.api.setups.$get({ query: { includeArchived: "true" } });
      if (!res.ok) throw new Error(`load setups failed: ${res.status}`);
      return res.json();
    },
  });
}

/** Every tag, archived ones too. */
export function useTags() {
  return useQuery({
    queryKey: ["tags"],
    queryFn: async (): Promise<Tag[]> => {
      const res = await api.api.tags.$get({ query: { includeArchived: "true" } });
      if (!res.ok) throw new Error(`load tags failed: ${res.status}`);
      return res.json();
    },
  });
}

/** The review's own fields, shown before the server answers so a second click builds on the first. */
function shownAtOnce(body: TradePatchBody) {
  return {
    ...(body.grade === undefined ? {} : { grade: body.grade }),
    ...(body.setupId === undefined ? {} : { setupId: body.setupId }),
    ...(body.tagIds === undefined ? {} : { tagIds: body.tagIds }),
    ...(body.notes === undefined ? {} : { notes: body.notes }),
    ...(body.excluded === undefined ? {} : { excluded: body.excluded }),
  };
}

/**
 * The levels a save sends, shown at once too, so a second edit before the refetch (a blur then ✕, two drops) builds
 * on the first instead of the list last fetched. The server's rules: a basis change clears the stop and targets
 * unless the same save sets them, and the typed overrides stay.
 */
function levelsShownAtOnce(before: TradeDetailView, body: TradePatchBody) {
  const patch = body.scalp;
  const basis = patch?.levelBasis ?? before.scalp?.levelBasis;
  if (!patch || !basis) return {};
  const kept = before.scalp?.levelBasis === basis ? before.scalp : null;
  return {
    scalp: {
      tradeId: before.id,
      levelBasis: basis,
      stopPrice: patch.stopPrice !== undefined ? patch.stopPrice : (kept?.stopPrice ?? null),
      targets: patch.targets ?? kept?.targets ?? [],
      stockEntryOverride:
        patch.stockEntryOverride !== undefined
          ? patch.stockEntryOverride
          : (before.scalp?.stockEntryOverride ?? null),
      riskOverride:
        patch.riskOverride !== undefined ? patch.riskOverride : (before.scalp?.riskOverride ?? null),
    },
  };
}

/** A missed trade's levels and times a save sends, shown at once, so a dropped point doesn't jump back (§6.4). */
function missedShownAtOnce(before: TradeDetailView, body: TradePatchBody) {
  if (before.book !== "missed") return {};
  return {
    ...(body.openedAt === undefined ? {} : { openedAt: body.openedAt }),
    ...(body.closedAt === undefined ? {} : { closedAt: body.closedAt }),
    ...(body.missed && before.missed ? { missed: { ...before.missed, ...body.missed } } : {}),
  };
}

/**
 * Saves part of a trade (scalp-review spec §7.3). The review's fields and levels change on the page at once and go
 * back if the server refuses. Afterwards the trade, the lists and the queue refetch, after a refusal too.
 */
export function useSaveTrade(tradeId: string) {
  const queryClient = useQueryClient();
  const key = ["trade", tradeId];
  return useMutation({
    mutationFn: async (body: TradePatchBody) => {
      const res = await api.api.trades[":id"].$patch({ param: { id: tradeId }, json: body });
      if (!res.ok) throw await refusal(res, "save");
      return res.json();
    },
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<TradeDetailView>(key);
      if (before) {
        queryClient.setQueryData(key, {
          ...before,
          ...shownAtOnce(body),
          ...levelsShownAtOnce(before, body),
          ...missedShownAtOnce(before, body),
        });
      }
      return { before };
    },
    onError: (_error, _body, context) => {
      if (context?.before) queryClient.setQueryData(key, context.before);
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: key }),
        queryClient.invalidateQueries({ queryKey: ["trades"] }),
      ]),
  });
}

export function useCreateSetup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      strategy: "scalp" | "iron_fly" | null;
      description?: string | null;
    }) => {
      const res = await api.api.setups.$post({ json: input });
      if (!res.ok) throw await refusal(res, "create the setup");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["setups"] }),
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; kind: "mistake" | "emotion" | "skip" }) => {
      const res = await api.api.tags.$post({ json: input });
      if (!res.ok) throw await refusal(res, "create the tag");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tags"] }),
  });
}

/**
 * The To review queue (scalp-review spec §6.2): pending scalps, oldest first. The nav badge, the Scalps tab, the
 * Dashboard and the queue bar share this one query, and every trade save refetches it.
 */
export function usePendingReviews() {
  return useQuery({
    queryKey: ["trades", { review: "pending" }],
    queryFn: async (): Promise<TradeView[]> => {
      const res = await api.api.trades.$get({ query: { strategy: "scalp", review: "pending" } });
      if (!res.ok) throw new Error(`load the queue failed: ${res.status}`);
      return res.json();
    },
  });
}

type SetupPatch = Parameters<(typeof api.api.setups)[":id"]["$patch"]>[0]["json"];
type TagPatch = Parameters<(typeof api.api.tags)[":id"]["$patch"]>[0]["json"];

export function useUpdateSetup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: SetupPatch }) => {
      const res = await api.api.setups[":id"].$patch({ param: { id }, json: patch });
      if (!res.ok) throw await refusal(res, "save the setup");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["setups"] }),
  });
}

export function useUpdateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TagPatch }) => {
      const res = await api.api.tags[":id"].$patch({ param: { id }, json: patch });
      if (!res.ok) throw await refusal(res, "save the tag");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tags"] }),
  });
}
