import {writeFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
const size = 128;
const pixels = Buffer.alloc(size * (size * 4 + 1));
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const i = y * (size * 4 + 1) + 1 + x * 4;
  const round = Math.hypot(Math.max(0, 24 - Math.min(x, 127 - x)), Math.max(0, 24 - Math.min(y, 127 - y))) < 24;
  const seven = (y >= 31 && y <= 44 && x >= 33 && x <= 94) ||
    (y >= 43 && y <= 98 && Math.abs(x - (91 - (y - 43) * .63)) < 8);
  const inner = y > 14 && y < 113 && x > 14 && x < 113;
  const base = inner ? [136, 107, 197] : [124, 94, 185];
  pixels.set(seven ? [252, 249, 255, 255] : [...base, round ? 255 : 0], i);
}
function crc(data) { let c = 0xffffffff; for (const b of data) { c ^= b; for (let k=0;k<8;k++) c=(c>>>1)^((c&1)?0xedb88320:0); } return (c^0xffffffff)>>>0; }
function chunk(type, data) { const t=Buffer.from(type); const b=Buffer.alloc(data.length+12); b.writeUInt32BE(data.length); t.copy(b,4); data.copy(b,8); b.writeUInt32BE(crc(Buffer.concat([t,data])),b.length-4); return b; }
const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(size); ihdr.writeUInt32BE(size,4); ihdr[8]=8; ihdr[9]=6;
writeFileSync(new URL('../extension/icon128.png',import.meta.url),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]));
