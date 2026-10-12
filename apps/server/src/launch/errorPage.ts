/** Why a click didn't open the journal (launcher spec §3.5). */
export type Failure =
  | { kind: "port-taken"; port: number }
  | { kind: "update-failed"; output: string }
  | { kind: "not-started" }
  | { kind: "still-busy" }
  | { kind: "tool-missing"; path: string };

export function failureReason(failure: Failure): string {
  switch (failure.kind) {
    case "port-taken":
      return `Port ${failure.port} is used by another program. Close it, or set TJ_PORT and run \`pnpm launcher:install\` again.`;
    case "update-failed":
      return "Updating the journal failed";
    case "not-started":
      return "The journal didn't start";
    case "still-busy":
      return "The journal is finishing a sync before it restarts with your update. Click the icon again in a minute.";
    case "tool-missing":
      return `Node (or pnpm) is no longer at ${failure.path}. Run \`pnpm launcher:install\` again.`;
  }
}

/** What to try when the reason doesn't already say. */
const HINT: Partial<Record<Failure["kind"], string>> = {
  "update-failed": "Run `pnpm start` in the journal's folder to see the whole output.",
  "not-started": "Run `pnpm start` in the journal's folder to see the whole output.",
};

/** The last `count` lines of a text, without its final newline. */
export function tail(text: string, count = 40): string {
  const lines = text.replace(/\r?\n$/, "").split(/\r?\n/);
  return lines.slice(-count).join("\n");
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (char) => ESCAPES[char] ?? char);

/** The page a failed click opens: the reason, what to try, and the last lines of the update's output or the log. */
export function errorPage(failure: Failure, log: string): string {
  const lines = tail(failure.kind === "update-failed" ? failure.output : log);
  const hint = HINT[failure.kind];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Trading Journal didn't open</title>
<style>
body { background: #0b0e14; color: #d1d4dc; font: 14px/1.5 system-ui, sans-serif; margin: 40px; }
h1 { font-size: 18px; }
pre { background: #131722; border: 1px solid #1f2430; padding: 12px; overflow: auto; font: 12px/1.4 ui-monospace, monospace; color: #8a91a3; }
</style>
</head>
<body>
<h1>${escapeHtml(failureReason(failure))}</h1>
${hint ? `<p>${escapeHtml(hint)}</p>` : ""}
${lines ? `<p>The last lines:</p>\n<pre>${escapeHtml(lines)}</pre>` : ""}
</body>
</html>
`;
}
