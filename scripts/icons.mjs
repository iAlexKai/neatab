import {writeFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
// A white "N" on a rounded violet square. The store icon keeps 16 px of transparent padding at 128 px.
const MARGIN = {16: 0, 48: 2, 128: 16};
const STROKES = [[.36, .33, .36, .67], [.36, .33, .64, .67], [.64, .33, .64, .67]];
const SAMPLES = 4;

function segmentDistance(px, py, [ax, ay, bx, by]) {
  const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay));
}

function render(size) {
  const margin = MARGIN[size], inner = size - margin * 2, radius = inner * .23;
  const pixels = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let cover = 0, glyph = 0;
    for (let sy = 0; sy < SAMPLES; sy++) for (let sx = 0; sx < SAMPLES; sx++) {
      const px = x + (sx + .5) / SAMPLES - margin, py = y + (sy + .5) / SAMPLES - margin;
      const dx = Math.max(radius - px, px - (inner - radius), 0), dy = Math.max(radius - py, py - (inner - radius), 0);
      if (px < 0 || py < 0 || px > inner || py > inner || Math.hypot(dx, dy) > radius) continue;
      cover++;
      if (STROKES.some(s => segmentDistance(px / inner, py / inner, s) < .062)) glyph++;
    }
    const total = SAMPLES * SAMPLES, t = (y - margin) / inner;
    const base = [146 - 26 * t, 116 - 30 * t, 214 - 26 * t];
    const mix = cover ? glyph / cover : 0;
    const i = y * (size * 4 + 1) + 1 + x * 4;
    pixels.set([...base.map(c => Math.round(c + (255 - c) * mix)), Math.round(255 * cover / total)], i);
  }
  return png(size, pixels);
}

function crc(data) { let c = 0xffffffff; for (const b of data) { c ^= b; for (let k=0;k<8;k++) c=(c>>>1)^((c&1)?0xedb88320:0); } return (c^0xffffffff)>>>0; }
function chunk(type, data) { const t=Buffer.from(type); const b=Buffer.alloc(data.length+12); b.writeUInt32BE(data.length); t.copy(b,4); data.copy(b,8); b.writeUInt32BE(crc(Buffer.concat([t,data])),b.length-4); return b; }
function png(size, pixels) {
  const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(size); ihdr.writeUInt32BE(size,4); ihdr[8]=8; ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
for (const size of Object.keys(MARGIN).map(Number))
  writeFileSync(new URL(`../extension/icon${size}.png`, import.meta.url), render(size));
