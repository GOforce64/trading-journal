import { useMutation } from "@tanstack/react-query";
import { api } from "../api.js";
import { useFillMoves } from "../moves.js";
import { IronFlyForm } from "./IronFlyForm.js";

export function NewIronFly({ onCreated }: { onCreated?: (id: string) => void }) {
  const fill = useFillMoves();
  const save = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      // biome-ignore lint/suspicious/noExplicitAny: the RPC client types the body from the schema
      const res = await api.api.trades.$post({ json: payload as any });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      return (await res.json()) as { id: string };
    },
    onSuccess: (created) => {
      // Its stock prices, for the move data (spec §9.1).
      fill.mutate([created.id]);
      onCreated?.(created.id);
    },
  });

  return (
    <IronFlyForm
      submitLabel="Save trade"
      busy={save.isPending}
      error={save.error ? String(save.error) : null}
      onSubmit={(payload) => save.mutate(payload)}
    />
  );
}
