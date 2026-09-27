import type { ReactNode } from "react";

/** A panel that is also a region named by its title, so tests and screen readers can find each part of a page. */
export function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="rounded-sm border border-line bg-panel p-2.5">
      <header className="mb-1.5 flex items-center justify-between text-[10px] text-muted uppercase tracking-wider">
        <span>{title}</span>
        {right}
      </header>
      {children}
    </section>
  );
}
