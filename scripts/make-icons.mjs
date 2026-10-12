// Draws the journal's icon (launcher spec §3.6): the nav's blue square with a white candle. No dependencies:
// shapes on a 256 grid, 4×4 samples a pixel for smooth corners, PNG through zlib, and an ICO of PNGs.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "public");
const BLUE = [0x29, 0x62, 0xff];
const WHITE = [0xff, 0xff, 0xff];
// [x, y, width, height, corner radius] on a 256 grid.
const SQUARE = [0, 0, 256, 256, 40];
const WICK = [122, 40, 12, 176, 0];
const BODY = [92, 84, 72, 92, 6];

function inside(px, py, [x, y, w, h, r]) {
  if (px < x || py < y || px >= x + w || py >= y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

function colorAt(gx, gy) {
  if (inside(gx, gy, WICK) || inside(gx, gy, BODY)) return WHITE;
  return inside(gx, gy, SQUARE) ? BLUE : null;
}

function pixels(size) {
  const data = Buffer.alloc(size * size * 4);
  const scale = 256 / size;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sum = [0, 0, 0];
      let hits = 0;
      for (let sy = 0; sy < 4; sy += 1) {
        for (let sx = 0; sx < 4; sx += 1) {
          const color = colorAt((x + (sx + 0.5) / 4) * scale, (y + (sy + 0.5) / 4) * scale);
          if (!color) continue;
          hits += 1;
          for (let c = 0; c < 3; c += 1) sum[c] += color[c];
        }
      }
      const at = (y * size + x) * 4;
      for (let c = 0; c < 3; c += 1) data[at + c] = hits ? Math.round(sum[c] / hits) : 0;
      data[at + 3] = Math.round((hits / 16) * 255);
    }
  }
  return data;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function png(size) {
  const rgba = pixels(size);
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function ico(sizes) {
  const images = sizes.map(png);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const entries = sizes.map((size, i) => {
    const entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size;
    entry[1] = size === 256 ? 0 : size;
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(images[i].length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += images[i].length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images]);
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><title>Trading Journal</title><rect width="256" height="256" rx="40" fill="#2962ff"/><rect x="122" y="40" width="12" height="176" fill="#fff"/><rect x="92" y="84" width="72" height="92" rx="6" fill="#fff"/></svg>\n`;

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "icon.svg"), SVG);
writeFileSync(join(OUT, "icon-256.png"), png(256));
writeFileSync(join(OUT, "icon.ico"), ico([16, 32, 48, 256]));
console.log(`Icons written to ${OUT}`);
