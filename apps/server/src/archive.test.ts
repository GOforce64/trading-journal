import { describe, expect, it } from "vitest";
import { ArchiveError, type Entry, tarChunks, tarEntries } from "./archive.js";

const text = (value: string) => new TextEncoder().encode(value);

async function archive(entries: Entry[]): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of tarChunks(entries, Date.UTC(2026, 9, 8))) chunks.push(chunk);
  return new Uint8Array(Buffer.concat(chunks));
}

/** The bytes as a stream of chunks of `size`, the way a request body arrives. */
async function* inChunks(bytes: Uint8Array, size: number) {
  for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
}

async function read(chunks: AsyncIterable<Uint8Array>, wanted = (_name: string, _size: number) => true) {
  const entries: { name: string; text: string }[] = [];
  for await (const entry of tarEntries(chunks, wanted)) {
    entries.push({ name: entry.name, text: new TextDecoder().decode(entry.bytes) });
  }
  return entries;
}

describe("tarChunks", () => {
  it("writes ustar blocks: a header with its checksum, the bytes padded to 512, and two empty blocks at the end", async () => {
    const bytes = await archive([{ name: "bundle.json.gz", bytes: text("hello") }]);
    expect(bytes.length).toBe(512 * 4);
    const header = Buffer.from(bytes.subarray(0, 512));
    const field = (at: number, length: number) =>
      header
        .subarray(at, at + length)
        .toString("latin1")
        .replace(/\0.*$/s, "");
    expect(field(0, 100)).toBe("bundle.json.gz");
    expect(field(124, 12)).toBe("00000000005");
    expect(field(136, 12)).toBe(Math.floor(Date.UTC(2026, 9, 8) / 1000).toString(8));
    expect(field(156, 1)).toBe("0");
    expect(field(257, 6)).toBe("ustar");
    const blank = Buffer.from(header);
    blank.fill(" ", 148, 156);
    const sum = blank.reduce((total, byte) => total + byte, 0);
    expect(Number.parseInt(field(148, 8).trim(), 8)).toBe(sum);
    expect(Buffer.from(bytes.subarray(512, 517)).toString()).toBe("hello");
    expect(bytes.subarray(517).every((byte) => byte === 0)).toBe(true);
  });

  it("refuses a name that doesn't fit a ustar header", async () => {
    await expect(archive([{ name: "x".repeat(101), bytes: text("") }])).rejects.toThrow();
  });
});

describe("tarEntries", () => {
  const ENTRIES = [
    { name: "bundle.json.gz", bytes: text("tables") },
    { name: "attachments/a.png", bytes: text("x".repeat(1_000)) },
    { name: "empty", bytes: text("") },
  ];

  it("reads back every entry, however the stream is cut into chunks", async () => {
    const bytes = await archive(ENTRIES);
    const expected = ENTRIES.map((entry) => ({
      name: entry.name,
      text: new TextDecoder().decode(entry.bytes),
    }));
    for (const size of [1, 7, 512, 513, 100_000]) expect(await read(inChunks(bytes, size))).toEqual(expected);
  });

  it("skips the entries it isn't asked for, telling it each one's size", async () => {
    const asked: [string, number][] = [];
    const entries = await read(inChunks(await archive(ENTRIES), 300), (name, size) => {
      asked.push([name, size]);
      return name !== "attachments/a.png";
    });
    expect(asked).toEqual([
      ["bundle.json.gz", 6],
      ["attachments/a.png", 1_000],
      ["empty", 0],
    ]);
    expect(entries.map((entry) => entry.name)).toEqual(["bundle.json.gz", "empty"]);
  });

  it("refuses a stream cut short, a damaged header, or one that isn't an archive", async () => {
    const bytes = await archive(ENTRIES);
    const damaged = new Uint8Array(bytes);
    damaged[0] = "c".charCodeAt(0);
    for (const broken of [
      bytes.subarray(0, 1_000),
      bytes.subarray(0, 512 * 3),
      damaged,
      text("not a bundle"),
    ]) {
      await expect(read(inChunks(broken, 64))).rejects.toBeInstanceOf(ArchiveError);
    }
    await expect(read(inChunks(new Uint8Array(0), 64))).rejects.toBeInstanceOf(ArchiveError);
  });
});
