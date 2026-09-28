import type { ReactNode } from "react";

const NAV = [
  { label: "Dashboard", path: "/" },
  { label: "Journal", path: "/journal" },
  { label: "Analytics", path: "/analytics" },
  { label: "Iron Flies", path: "/iron-flies" },
  { label: "Missed", path: "/missed" },
  { label: "Playbook", path: "/playbook" },
  { label: "Import / Sync", path: "/import" },
  { label: "Settings", path: "/settings" },
];

export function Shell({ activePath, children }: { activePath: string; children: ReactNode }) {
  return (
    <div className="flex h-full">
      <aside className="w-44 shrink-0 border-line border-r bg-[#0e1118] p-3">
        <div className="mb-4 flex items-center gap-2 px-1 font-semibold tracking-tight">
          <span className="inline-block h-4 w-4 rounded-[2px] bg-accent" />
          TRADEJRNL
        </div>
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
              </a>
            );
          })}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-4">{children}</main>
    </div>
  );
}
