/** A page or tab the palette can open (spec §7.2). */
export interface PalettePage {
  label: string;
  href: string;
}

export const PAGES: readonly PalettePage[] = [
  { label: "Dashboard", href: "/" },
  { label: "Journal", href: "/journal" },
  { label: "Iron Flies", href: "/iron-flies" },
  { label: "Swings", href: "/swings" },
  { label: "Missed", href: "/missed" },
  { label: "Playbook", href: "/playbook" },
  { label: "Import / Sync", href: "/import" },
  { label: "Settings", href: "/settings" },
  { label: "Analytics › Overview", href: "/analytics" },
  { label: "Analytics › Scalps", href: "/analytics?tab=scalps" },
  { label: "Analytics › Swings", href: "/analytics?tab=swings" },
  { label: "Analytics › Iron flies", href: "/analytics?tab=flies" },
  { label: "Analytics › Missed", href: "/analytics?tab=missed" },
  { label: "Scalps › All", href: "/scalps" },
  { label: "Scalps › To review", href: "/scalps?tab=review" },
];

/** The pages whose words start with the typed words, in order: "an sc" is Analytics › Scalps. */
export function matchPages(text: string, pages: readonly PalettePage[] = PAGES): PalettePage[] {
  const typed = text.toLowerCase().split(/\s+/).filter(Boolean);
  return pages.filter((page) => {
    const names = page.label
      .toLowerCase()
      .split(/[\s›/]+/)
      .filter(Boolean);
    let at = 0;
    return typed.every((word) => {
      while (at < names.length && !names[at]?.startsWith(word)) at += 1;
      at += 1;
      return at <= names.length;
    });
  });
}
