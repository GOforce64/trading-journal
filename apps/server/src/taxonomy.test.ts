import { describe, expect, it } from "vitest";
import { LOCAL, testApp } from "./testing.js";

const JSON_HEADERS = { "content-type": "application/json", host: "localhost" };
const readJson = async <T>(res: Response): Promise<T> => (await res.json()) as T;

interface Item {
  id: string;
  name: string;
  kind?: string;
  strategy?: string | null;
  archived: boolean;
  tradeCount: number;
}

function setup() {
  const app = testApp();
  const list = async (path: string) => readJson<Item[]>(await app.request(path, { headers: LOCAL }));
  const send = (method: "POST" | "PATCH", path: string, body: unknown) =>
    app.request(path, { method, headers: JSON_HEADERS, body: JSON.stringify(body) });
  const named = async (path: string, name: string) => {
    const found = (await list(`${path}?includeArchived=true`)).find((item) => item.name === name);
    if (!found) throw new Error(`no ${name}`);
    return found;
  };
  return { list, send, named };
}

describe("setups and tags", () => {
  it("renames and archives a setup, listing archived ones only when asked, each with its trade count", async () => {
    const { list, send, named } = setup();
    const orb = await named("/api/setups", "ORB breakout");
    expect(orb.tradeCount).toBe(0);
    const renamed = await send("PATCH", `/api/setups/${orb.id}`, {
      name: "Opening range break",
      strategy: null,
    });
    expect(await readJson<Item>(renamed)).toMatchObject({ name: "Opening range break", strategy: null });
    await send("PATCH", `/api/setups/${orb.id}`, { archived: true });
    expect((await list("/api/setups")).some((item) => item.id === orb.id)).toBe(false);
    expect((await named("/api/setups", "Opening range break")).archived).toBe(true);
  });

  it("renames and archives a tag, keeping its kind", async () => {
    const { send, named } = setup();
    const fomo = await named("/api/tags", "FOMO entry");
    const res = await send("PATCH", `/api/tags/${fomo.id}`, { name: "Chased", archived: true });
    expect(await readJson<Item>(res)).toMatchObject({ name: "Chased", kind: "mistake", archived: true });
  });

  it("answers 409 with the reason for a name already taken", async () => {
    const { send, named } = setup();
    const created = await send("POST", "/api/setups", { name: "vwap RECLAIM", strategy: "scalp" });
    expect(created.status).toBe(409);
    expect(await readJson<{ message: string }>(created)).toEqual({
      error: "duplicate",
      message: "A setup with that name exists",
    });
    const orb = await named("/api/setups", "ORB breakout");
    expect((await send("PATCH", `/api/setups/${orb.id}`, { name: "VWAP reclaim" })).status).toBe(409);
    const tag = await send("POST", "/api/tags", { name: "calm", kind: "emotion" });
    expect(await readJson<{ message: string }>(tag)).toMatchObject({
      message: "An emotion tag with that name exists",
    });
  });

  it("answers 404 for an unknown setup or tag, and 400 for an empty name", async () => {
    const { send, named } = setup();
    expect((await send("PATCH", `/api/setups/${crypto.randomUUID()}`, { archived: true })).status).toBe(404);
    expect((await send("PATCH", `/api/tags/${crypto.randomUUID()}`, { archived: true })).status).toBe(404);
    const orb = await named("/api/setups", "ORB breakout");
    expect((await send("PATCH", `/api/setups/${orb.id}`, { name: "  " })).status).toBe(400);
  });
});
