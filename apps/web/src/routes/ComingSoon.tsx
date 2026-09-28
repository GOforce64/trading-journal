import { Panel } from "../components/ui.js";

/**
 * Nav destinations whose features land in later phases. A plain "not found"
 * here would read as a bug, so each says what it will hold and when.
 */
export function ComingSoon({ title, phase, children }: { title: string; phase: string; children: string }) {
  return (
    <Panel title={title}>
      <p className="mb-1 text-fg">{children}</p>
      <p className="text-muted">Arrives in {phase}.</p>
    </Panel>
  );
}
