import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Panel } from "../components/ui.js";
import { Lightbox } from "./Lightbox.js";

/** A screenshot as the trade view carries it (screenshots spec §3). */
export interface Shot {
  id: string;
  sha256: string;
  ext: string;
  caption: string | null;
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const BUTTON = "rounded-sm border border-line px-3 py-1 text-fg hover:border-accent";
const uploadKey = (tradeId: string) => ["upload-screenshot", tradeId];

/** Where a stored screenshot is served from. */
export const shotUrl = (shot: Shot) => `/api/attachments/files/${shot.sha256}.${shot.ext}`;

/** The server's own words for a refusal, or the status when it sent none. */
async function refusal(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return new Error(body?.message ?? `${fallback}: ${res.status}`);
}

/** The images among a paste's or drop's files; any other kind is left to the page. */
const imagesIn = (files: FileList | readonly File[] | undefined | null): File[] =>
  [...(files ?? [])].filter((file) => IMAGE_TYPES.has(file.type));

/**
 * A trade's screenshots (screenshots spec §5): thumbnails that open a lightbox, and three ways in. Paste and drop work
 * anywhere on the trade page while it's open; a paste with no image is left alone, so text still pastes into fields.
 */
export function Screenshots({
  trade,
  confirm = (text: string) => window.confirm(text),
}: {
  trade: { id: string; attachments: readonly Shot[] };
  confirm?: (text: string) => boolean;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const shots = trade.attachments;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["trade", trade.id] }),
      queryClient.invalidateQueries({ queryKey: ["trades"] }),
    ]);
  const upload = useMutation({
    mutationKey: uploadKey(trade.id),
    mutationFn: async (file: File) => {
      const res = await fetch(`/api/trades/${trade.id}/attachments`, {
        method: "POST",
        headers: { "content-type": file.type },
        body: file,
      });
      if (!res.ok) throw await refusal(res, "Uploading failed");
    },
    onError: (failure) => setError(failure.message),
    onSettled: refresh,
  });
  const uploading = useIsMutating({ mutationKey: uploadKey(trade.id) });
  const send = (files: File[]) => {
    setError(null);
    for (const file of files) upload.mutate(file);
  };
  // The latest `send`, for the listeners below, which are added once.
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const images = imagesIn(event.clipboardData?.files);
      if (images.length === 0) return;
      event.preventDefault();
      sendRef.current(images);
    };
    const over = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      const images = imagesIn(event.dataTransfer?.files);
      if (images.length === 0) return;
      event.preventDefault();
      sendRef.current(images);
    };
    window.addEventListener("paste", paste);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("paste", paste);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  const caption = useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string | null }) => {
      const res = await fetch(`/api/attachments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caption: text }),
      });
      if (!res.ok) throw await refusal(res, "Saving the caption failed");
    },
    onError: (failure) => setError(failure.message),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
      if (!res.ok) throw await refusal(res, "Removing failed");
    },
    onError: (failure) => setError(failure.message),
    onSettled: refresh,
  });

  return (
    <Panel title={shots.length > 0 ? `Screenshots · ${shots.length}` : "Screenshots"}>
      <div className="flex flex-wrap items-start gap-2" data-testid="screenshots">
        {shots.map((shot, index) => (
          <figure key={shot.id} className="flex w-40 flex-col gap-1">
            <button
              type="button"
              aria-label={`Open screenshot ${index + 1}`}
              onClick={() => setOpen(index)}
              className="overflow-hidden rounded-sm border border-line bg-[#0e1118] hover:border-accent"
            >
              <img
                src={shotUrl(shot)}
                alt={shot.caption ?? `Screenshot ${index + 1}`}
                className="block h-24 w-40 object-cover"
              />
            </button>
            {shot.caption && (
              <figcaption className="truncate text-[10px] text-muted">{shot.caption}</figcaption>
            )}
          </figure>
        ))}
        {Array.from({ length: uploading }, (_, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity of their own
            key={`uploading-${index}`}
            className="flex h-24 w-40 items-center justify-center rounded-sm border border-line border-dashed text-[11px] text-muted"
          >
            Uploading…
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className={BUTTON} onClick={() => picker.current?.click()}>
          Add screenshot
        </button>
        <input
          ref={picker}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          aria-label="Choose screenshots"
          onChange={(event) => {
            const images = imagesIn(event.target.files);
            event.target.value = "";
            if (images.length > 0) send(images);
          }}
        />
        {shots.length === 0 && uploading === 0 && (
          <span className="text-[11px] text-muted">
            Paste (Ctrl+V), drop an image here, or Add screenshot.
          </span>
        )}
      </div>
      {error && <p className="mt-1.5 text-[11px] text-down">{error}</p>}
      {open != null && shots[open] && (
        <Lightbox
          shots={shots}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          onCaption={(id, text) => caption.mutate({ id, text })}
          onRemove={(id) => {
            if (!confirm("Remove this screenshot?")) return;
            remove.mutate(id);
            setOpen(null);
          }}
        />
      )}
    </Panel>
  );
}
