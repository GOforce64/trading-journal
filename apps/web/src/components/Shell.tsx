import type { ReactNode } from "react";

const NAV = [
  { label: "Dashboard", path: "/" },
  { label: "Journal", path: "/journal" },
  { label: "Analytics", path: "/analytics" },
  { label: "Iron Flies", path: "/iron-flies" },
  { label: "Scalps", path: "/scalps" },
  { label: "Missed", path: "/missed" },
  { label: "Playbook", path: "/playbook" },
  { label: "Import / Sync", path: "/import" },
  { label: "Settings", path: "/settings" },
];

export function Shell({
  activePath,
  syncing = false,
  toReview = 0,
  onSearch,
  children,
}: {
  activePath: string;
  syncing?: boolean;
  /** Scalps waiting in the To review queue (scalp-review spec §9.2). */
  toReview?: number;
  /** Opens the command palette (launcher-keys-palette spec §7.1). */
  onSearch?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full">
      <aside className="w-44 shrink-0 border-line border-r bg-[#0e1118] p-3">
        <div className="mb-4 flex items-center gap-2 px-1 font-semibold tracking-tight">
          <span className="inline-block h-4 w-4 rounded-[2px] bg-accent" />
          TRADEJRNL
        </div>
        {onSearch && (
          <button
            type="button"
            onClick={onSearch}
            className="mb-3 flex w-full items-center justify-between rounded-sm border border-line px-2 py-1 text-muted hover:text-fg"
          >
            <span>
              Search<span className="sr-only"> · </span>
            </span>
            <kbd className="num text-[10px]">Ctrl K</kbd>
          </button>
        )}
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active = item.path === activePath;
            return (
              <a
                key={item.path}
                href={item.path}
                aria-current={active ? "page" : undefined}
                className={`rounded-sm px-2 py-1.5 ${active ? "bg-[#1c2130] text-fg" : "text-muted hover:text-fg"}`}
              >
                {item.label}
                {item.path === "/import" && syncing && (
                  <span
                    role="status"
                    aria-label="Syncing with IBKR"
                    className="ml-1 inline-block animate-spin text-accent"
                  >
                    ↻
                  </span>
                )}
                {item.path === "/scalps" && toReview > 0 && (
                  <span
                    role="status"
                    aria-label={`${toReview} to review`}
                    className="num ml-1.5 rounded-[2px] bg-accent px-1 text-[10px] text-white"
                  >
                    {toReview}
                  </span>
                )}
              </a>
            );
          })}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-4">{children}</main>
    </div>
  );
}
