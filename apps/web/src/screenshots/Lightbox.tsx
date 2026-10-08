import { useEffect, useRef, useState } from "react";
import { type Shot, shotUrl } from "./Screenshots.js";

/**
 * One screenshot over the page (screenshots spec §5): ← and → step, Esc or the backdrop closes, a click on the image
 * switches between fitted and its real size, and the caption saves on blur or Enter.
 */
export function Lightbox({
  shots,
  index,
  onIndex,
  onClose,
  onCaption,
  onRemove,
}: {
  shots: readonly Shot[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  onCaption: (id: string, caption: string | null) => void;
  onRemove: (id: string) => void;
}) {
  const shot = shots[index];
  const [zoomed, setZoomed] = useState(false);
  const [draft, setDraft] = useState(shot?.caption ?? "");
  const captionInput = useRef<HTMLInputElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new screenshot starts fitted, with its own caption
  useEffect(() => {
    setZoomed(false);
    setDraft(shot?.caption ?? "");
  }, [shot?.id]);

  // Closing blurs the caption first, so one being typed is saved rather than lost with the lightbox.
  const close = () => {
    if (document.activeElement === captionInput.current) captionInput.current?.blur();
    onClose();
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      // Arrows move the caption's cursor while it's being typed in.
      if (event.target instanceof HTMLInputElement && event.key !== "Escape") return;
      if (event.key === "Escape") closeRef.current();
      else if (event.key === "ArrowRight" && index < shots.length - 1) onIndex(index + 1);
      else if (event.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [index, shots.length, onIndex]);

  if (!shot) return null;
  const save = () => {
    const text = draft.trim() || null;
    if (text !== (shot.caption ?? null)) onCaption(shot.id, text);
  };
  const STEP =
    "rounded-sm border border-line bg-panel px-3 py-1 text-fg hover:border-accent disabled:opacity-40";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Screenshot ${index + 1} of ${shots.length}`}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-[#000000d9] p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className={`max-h-[80vh] max-w-[92vw] ${zoomed ? "overflow-auto" : "overflow-hidden"}`}>
        <img
          src={shotUrl(shot)}
          alt={shot.caption ?? `Screenshot ${index + 1}`}
          onClick={() => setZoomed((value) => !value)}
          onKeyDown={() => {}}
          className={
            zoomed ? "max-w-none cursor-zoom-out" : "max-h-[80vh] max-w-[92vw] cursor-zoom-in object-contain"
          }
        />
      </div>
      <div className="flex w-full max-w-3xl items-center gap-2">
        <button type="button" className={STEP} disabled={index === 0} onClick={() => onIndex(index - 1)}>
          ←
        </button>
        <input
          ref={captionInput}
          aria-label="Caption"
          value={draft}
          placeholder="Add a caption"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="flex-1 rounded-sm border border-line bg-[#0e1118] px-2 py-1 text-[13px] text-fg outline-none focus:border-accent"
        />
        <span className="num text-[11px] text-muted">
          {index + 1} / {shots.length}
        </span>
        <button
          type="button"
          className={STEP}
          disabled={index === shots.length - 1}
          onClick={() => onIndex(index + 1)}
        >
          →
        </button>
        <button type="button" className={`${STEP} text-down`} onClick={() => onRemove(shot.id)}>
          Remove
        </button>
        <button type="button" className={STEP} onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
    </div>
  );
}
