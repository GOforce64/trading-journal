/** In place of the whole app once the server has stopped (launcher spec §3.4). */
export function Stopped() {
  return (
    <main className="flex h-full items-center justify-center p-8 text-center text-muted">
      <p>
        The journal has stopped. Open it again from its icon, or run{" "}
        <code className="num text-fg">pnpm start</code>.
      </p>
    </main>
  );
}
