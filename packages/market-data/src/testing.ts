/** A JSON reply as Alpaca sends it. */
export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Plays back one reply per call and records what each call asked for. */
export function fakeFetch(...replies: Response[]) {
  const calls: { url: URL; headers: Headers }[] = [];
  const fetch = async (input: string, init?: RequestInit) => {
    calls.push({ url: new URL(input), headers: new Headers(init?.headers) });
    const reply = replies.shift();
    if (!reply) throw new Error("Alpaca was called more often than expected");
    return reply;
  };
  return { fetch, calls };
}
