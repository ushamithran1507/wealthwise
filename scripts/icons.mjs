// Draws the app icons (a misregistered cyan/magenta "W" over the Broadsheet
// thick-thin rule) as PNGs using only Node built-ins. Runs before every build.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const INK = [0x20, 0x1e, 0x1d], CYAN = [0x00, 0x88, 0xb0], MAGENTA = [0xd6, 0x00, 0x6c];
// The W as four strokes in a 512 grid.
const W = [[[120, 120], [190, 360]], [[190, 360], [256, 190]], [[256, 190], [322, 360]], [[322, 360], [392, 120]]];
const distSeg = (px, py, [[ax, ay], [bx, by]]) => {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
const inW = (x, y, ox, oy) => W.some(s => distSeg(x - ox, y - oy, s) < 30);

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function icon(size) {
  const ss = 3, raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const X = ((x + (sx + 0.5) / ss) / size) * 512, Y = ((y + (sy + 0.5) / ss) / size) * 512;
        let px = [255, 255, 255];
        const mul = c => { px = px.map((v, i) => Math.round(v * c[i] / 255)); };
        if (inW(X, Y, 10, 8)) mul(MAGENTA);
        if (inW(X, Y, 0, 0)) mul(CYAN);
        if (X >= 96 && X <= 416 && ((Y >= 400 && Y <= 414) || (Y >= 424 && Y <= 428))) px = INK;
        px.forEach((v, i) => { acc[i] += v; });
      }
      acc.forEach((v, i) => { raw[y * (size * 3 + 1) + 1 + x * 3 + i] = Math.round(v / (ss * ss)); });
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

for (const s of [192, 512]) writeFileSync(new URL(`../public/icon-${s}.png`, import.meta.url), icon(s));
