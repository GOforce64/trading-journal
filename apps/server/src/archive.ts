/**
 * A bundle's container (screenshots spec §4): a plain ustar archive, written and read as a stream, so a journal with
 * gigabytes of screenshots never has to sit in memory as one string or buffer. Any tar tool can list or unpack one.
 */

const BLOCK = 512;
/** The largest size an 11-digit octal field holds: 8 GiB. */
const MAX_SIZE = 8 ** 11 - 1;

/** One file in an archive. */
export interface Entry {
  name: string;
  bytes: Uint8Array;
}

/** What isn't a whole, undamaged archive: cut short, a bad header checksum, or not tar at all. */
export class ArchiveError extends Error {
  constructor(message = "not an archive") {
    super(message);
    this.name = "ArchiveError";
  }
}

const padding = (size: number) => (BLOCK - (size % BLOCK)) % BLOCK;
const octal = (value: number, digits: number) => `${value.toString(8).padStart(digits, "0")}\0`;
/** A header's bytes summed with its checksum field read as spaces. */
const checksum = (block: Uint8Array) =>
  block.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);

function header(name: string, size: number, mtime: number): Uint8Array {
  const block = Buffer.alloc(BLOCK);
  if (Buffer.byteLength(name) > 100) throw new Error(`An archive entry's name is over 100 bytes: ${name}`);
  if (size > MAX_SIZE) throw new Error(`An archive entry is over 8 GiB: ${name}`);
  block.write(name, 0);
  block.write(octal(0o644, 7), 100);
  block.write(octal(0, 7), 108);
  block.write(octal(0, 7), 116);
  block.write(octal(size, 11), 124);
  block.write(octal(Math.floor(mtime / 1000), 11), 136);
  block.write("0", 156);
  block.write("ustar\u000000", 257);
  block.write(`${checksum(block).toString(8).padStart(6, "0")}\0 `, 148);
  return block;
}

/** The archive of `entries`, as chunks: each one's header, its bytes padded to a block, then two empty blocks. */
export async function* tarChunks(
  entries: Iterable<Entry> | AsyncIterable<Entry>,
  mtime: number,
): AsyncGenerator<Uint8Array> {
  for await (const { name, bytes } of entries) {
    yield header(name, bytes.length, mtime);
    yield bytes;
    if (padding(bytes.length) > 0) yield new Uint8Array(padding(bytes.length));
  }
  yield new Uint8Array(BLOCK * 2);
}

/** Exact reads over a stream of chunks of any size. */
class Reader {
  private chunks: Uint8Array[] = [];
  private size = 0;

  constructor(private readonly source: AsyncIterator<Uint8Array>) {}

  /** The next `count` bytes, or null when the stream ended before any of them. */
  async read(count: number): Promise<Uint8Array | null> {
    while (this.size < count) {
      const next = await this.source.next();
      if (next.done) {
        if (this.size === 0) return null;
        throw new ArchiveError("cut short");
      }
      this.chunks.push(next.value);
      this.size += next.value.length;
    }
    const all = this.chunks.length === 1 ? (this.chunks[0] ?? new Uint8Array(0)) : Buffer.concat(this.chunks);
    const rest = all.subarray(count);
    this.chunks = rest.length > 0 ? [rest] : [];
    this.size = rest.length;
    return all.subarray(0, count);
  }

  /** Reads past `count` bytes a piece at a time, holding none of them. */
  async skip(count: number): Promise<void> {
    for (let left = count; left > 0; ) {
      const piece = Math.min(left, 1024 * 1024);
      if (!(await this.read(piece))) throw new ArchiveError("cut short");
      left -= piece;
    }
  }
}

const field = (block: Uint8Array, at: number, length: number) => {
  const bytes = block.subarray(at, at + length);
  const end = bytes.indexOf(0);
  return Buffer.from(end === -1 ? bytes : bytes.subarray(0, end)).toString("utf8");
};

/**
 * The regular files in an archive read from `chunks`, in order. `wanted` sees each one's name and size first: a file
 * it declines is read past without being held, and it may throw to stop the read. An archive must end with its empty
 * blocks, so one cut short is refused rather than read as whole.
 */
export async function* tarEntries(
  chunks: AsyncIterable<Uint8Array>,
  wanted: (name: string, size: number) => boolean,
): AsyncGenerator<Entry> {
  const reader = new Reader(chunks[Symbol.asyncIterator]());
  for (;;) {
    const block = await reader.read(BLOCK);
    if (!block) throw new ArchiveError("cut short");
    if (block.every((byte) => byte === 0)) return;
    const recorded = Number.parseInt(field(block, 148, 8).trim(), 8);
    if (recorded !== checksum(block)) throw new ArchiveError("a damaged header");
    const size = Number.parseInt(field(block, 124, 12).trim() || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new ArchiveError("a damaged header");
    const prefix = field(block, 257, 6) === "ustar" ? field(block, 345, 155) : "";
    const name = prefix ? `${prefix}/${field(block, 0, 100)}` : field(block, 0, 100);
    const type = block[156];
    const file = type === 0 || type === "0".charCodeAt(0);
    if (file && wanted(name, size)) {
      const bytes = size === 0 ? new Uint8Array(0) : await reader.read(size);
      if (!bytes) throw new ArchiveError("cut short");
      await reader.skip(padding(size));
      yield { name, bytes: new Uint8Array(bytes) };
    } else {
      await reader.skip(size + padding(size));
    }
  }
}
